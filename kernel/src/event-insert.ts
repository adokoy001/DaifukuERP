// Write-only outbox primitive. Context construction does not depend on the delivery worker.
import type { Context } from './context.ts';
import { outbox } from './db/system-tables.ts';
import { DaifukuError } from './errors.ts';
import { newId } from './ids.ts';

/**
 * Topic prefixes only the kernel writes (docs/specs/event-delivery.md AC-7, ADR-0037). An outbox row records no emitting
 * actor, and routing turns `inbox.count_changed` into mail to the user named in its payload, so `ctx.emit` refuses these
 * topics: the inbox watch writes them through insertOutbox in the user's own Context.
 */
export const RESERVED_TOPIC_PREFIXES: readonly string[] = ['inbox.'];

export async function insertOutbox(ctx: Context, topic: string, payload: unknown): Promise<void> {
  await ctx.db.insert(outbox).values({
    id: newId(),
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    topic,
    payload: payload as Record<string, unknown>,
    // One clock for activation and retry comparisons (docs/specs/event-delivery.md AC-6): the context's, not now().
    createdAt: ctx.now(),
  });
}

/** `ctx.emit`: insertOutbox for every topic except the kernel-reserved ones (403). */
export async function emitOutbox(ctx: Context, topic: string, payload: unknown): Promise<void> {
  if (RESERVED_TOPIC_PREFIXES.some((prefix) => topic.startsWith(prefix)))
    throw new DaifukuError(
      'PERMISSION_DENIED',
      `topic "${topic}" is reserved for the kernel`,
      'Inbox topics are written by the kernel inbox watch only (docs/specs/event-delivery.md AC-7). Emit a topic of your own entity instead.',
      { topic },
      403,
    );
  await insertOutbox(ctx, topic, payload);
}
