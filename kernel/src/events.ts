// Transactional outbox: emit inside the transaction, deliver after commit (ADR-0001, ADR-0008).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Context } from './context.ts';
import { companies, outbox } from './db/system-tables.ts';
import { registry } from './registry.ts';
import { makeContext } from './db/client.ts';
import { withSavepoint } from './transactions.ts';
import { appliedPackNames } from './pack-scope.ts';

export { insertOutbox } from './event-insert.ts';

export interface DeliveryResult {
  delivered: number;
  failed: number;
}

/**
 * Delivers pending outbox rows for the context's tenant to registered subscribers.
 * Idempotency is the subscriber's job (ADR-0001). Call from the worker with a system context.
 */
export async function deliverPending(ctx: Context, limit = 100): Promise<DeliveryResult> {
  const rows = await ctx.db
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.tenantId, ctx.tenantId),
        ctx.companyId ? eq(outbox.companyId, ctx.companyId) : undefined,
        isNull(outbox.publishedAt),
      ),
    )
    .orderBy(asc(outbox.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)))
    .for('update', { skipLocked: true });
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const handlers = registry.subscribersFor(row.topic);
    try {
      const company = row.companyId
        ? await ctx.db
            .select({ settings: companies.settings })
            .from(companies)
            .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, row.companyId)))
            .limit(1)
        : [];
      const eventCtx = makeContext(ctx.db, {
        appliedPacks: appliedPackNames(company[0]?.settings),
        tenantId: ctx.tenantId,
        companyId: row.companyId,
        actor: ctx.actor,
        roles: ctx.roles,
        requestId: ctx.requestId,
        locale: ctx.locale,
        log: ctx.log,
        now: ctx.now,
      });
      await withSavepoint(eventCtx, async (inner) => {
        for (const h of handlers) await h(inner, row.payload, { topic: row.topic, id: row.id });
        await inner.db
          .update(outbox)
          .set({ publishedAt: inner.now(), attempts: row.attempts + 1, lastError: null })
          .where(eq(outbox.id, row.id));
      });
      delivered++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      await ctx.db
        .update(outbox)
        .set({ attempts: sql`${outbox.attempts} + 1`, lastError: message.slice(0, 2000) })
        .where(eq(outbox.id, row.id));
      ctx.log.error('outbox delivery failed', { id: row.id, topic: row.topic, message });
    }
  }
  return { delivered, failed };
}
