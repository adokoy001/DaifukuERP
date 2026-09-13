// Write-only outbox primitive. Context construction does not depend on the delivery worker.
import type { Context } from './context.ts';
import { outbox } from './db/system-tables.ts';
import { newId } from './ids.ts';

export async function insertOutbox(ctx: Context, topic: string, payload: unknown): Promise<void> {
  await ctx.db.insert(outbox).values({
    id: newId(),
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    topic,
    payload: payload as Record<string, unknown>,
  });
}
