// Transaction ports for modules (ADR-0016). No SQL dependencies escape the kernel.
import { sql } from 'drizzle-orm';
import type { Context } from './context.ts';
import { makeContext } from './db/client.ts';
import { inheritContext } from './write-capability.ts';

/** Serialize a business key, including absent rows, until the outer transaction ends. */
export async function withLock<T>(ctx: Context, key: string, work: () => Promise<T>): Promise<T> {
  await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:${ctx.companyId ?? ''}:${key}`}, 0))`);
  return work();
}

/** Roll back a failed unit before its caller records a failure and continues the transaction. */
export async function withSavepoint<T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => work(inheritContext(ctx, makeContext(tx, ctx))));
}
