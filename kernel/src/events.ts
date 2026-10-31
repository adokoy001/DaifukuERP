// Transactional outbox: emit inside the transaction, deliver after commit (ADR-0001, ADR-0008, ADR-0037).
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import type { Context } from './context.ts';
import { companies, outbox } from './db/system-tables.ts';
import { registry } from './registry.ts';
import { makeContext } from './db/client.ts';
import { withSavepoint } from './transactions.ts';
import { appliedPackNames } from './pack-scope.ts';
import {
  MAX_DELIVERY_ATTEMPTS,
  retryDelaySeconds,
  routeEvent,
  safeDiagnostic,
  safeDiagnosticFields,
} from './event-delivery.ts';

export { insertOutbox } from './event-insert.ts';

export interface DeliveryResult {
  delivered: number;
  failed: number;
  /** Rows that reached the retry limit in this call (dead_at set). */
  dead: number;
  /** Delivery rows (webhook / email) created for the delivered events. */
  routed: number;
}

/**
 * Delivers due outbox rows for the context's tenant to registered subscribers, then routes each delivered event to its
 * webhook / email delivery rows in the same savepoint (docs/specs/event-delivery.md AC-4..AC-7). Idempotency is the
 * subscriber's job (ADR-0001). A failure rolls the event back, counts an attempt, schedules the next try (60 s doubling
 * to 1 h) and, at the 8th attempt, marks the row dead. Call from the worker with a system context; concurrent callers
 * skip each other's rows (FOR UPDATE SKIP LOCKED).
 */
export async function deliverPending(ctx: Context, limit = 100): Promise<DeliveryResult> {
  const now = ctx.now();
  const rows = await ctx.db
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.tenantId, ctx.tenantId),
        ctx.companyId ? eq(outbox.companyId, ctx.companyId) : undefined,
        isNull(outbox.publishedAt),
        isNull(outbox.deadAt),
        or(isNull(outbox.nextAttemptAt), lte(outbox.nextAttemptAt, now)),
      ),
    )
    .orderBy(asc(outbox.createdAt), asc(outbox.id))
    .limit(Math.max(1, Math.min(limit, 500)))
    .for('update', { skipLocked: true });
  let delivered = 0;
  let failed = 0;
  let dead = 0;
  let routed = 0;
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
      const settings = company[0]?.settings as Record<string, unknown> | undefined;
      const eventCtx = makeContext(ctx.db, {
        appliedPacks: appliedPackNames(settings),
        tenantId: ctx.tenantId,
        companyId: row.companyId,
        actor: ctx.actor,
        roles: ctx.roles,
        requestId: ctx.requestId,
        locale: ctx.locale,
        log: ctx.log,
        now: ctx.now,
      });
      routed += await withSavepoint(eventCtx, async (inner) => {
        for (const h of handlers) await h(inner, row.payload, { topic: row.topic, id: row.id });
        const created = await routeEvent(inner, row, settings);
        await inner.db
          .update(outbox)
          .set({ publishedAt: inner.now(), attempts: row.attempts + 1, lastError: null, nextAttemptAt: null })
          .where(eq(outbox.id, row.id));
        return created;
      });
      delivered++;
    } catch (e) {
      failed++;
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
      if (exhausted) dead++;
      await ctx.db
        .update(outbox)
        .set({
          attempts,
          lastError: safeDiagnostic(e),
          nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryDelaySeconds(attempts) * 1000),
          deadAt: exhausted ? now : null,
        })
        .where(eq(outbox.id, row.id));
      // Diagnostics only (docs/conventions/errors.md): never the raw message, which may carry SQL and bound values.
      ctx.log.error('outbox delivery failed', {
        id: row.id,
        topic: row.topic,
        attempts,
        ...(exhausted ? { dead: true } : {}),
        ...safeDiagnosticFields(e),
      });
    }
  }
  return { delivered, failed, dead, routed };
}
