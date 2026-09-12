import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { identityLimits } from '../db/identity-tables.ts';
import { DaifukuError } from '../errors.ts';
import { tokenHash } from './crypto.ts';
export interface IdentityAttemptLimit { key: string; limit: number; seconds?: number }
interface Reservation { key: string; start: Date }
const limited = () => new DaifukuError('PERMISSION_DENIED', 'Too many verification attempts.', 'Wait before trying again.', undefined, 429);
async function reserve(owner: Database, input: IdentityAttemptLimit, now: Date): Promise<Reservation> {
  const seconds = input.seconds ?? 300, key = tokenHash(input.key), start = new Date(Math.floor(now.getTime() / (seconds * 1000)) * seconds * 1000);
  const [row] = await owner.drizzle.insert(identityLimits).values({ key, windowStart: start }).onConflictDoUpdate({
    target: identityLimits.key,
    set: { windowStart: start, attempts: sql`case when ${identityLimits.windowStart} = ${start.toISOString()} then ${identityLimits.attempts} + 1 else 1 end` },
    setWhere: sql`${identityLimits.windowStart} < ${start.toISOString()} or (${identityLimits.windowStart} = ${start.toISOString()} and ${identityLimits.attempts} < ${input.limit})`,
  }).returning();
  if (!row) throw limited();
  return { key, start };
}
async function release(owner: Database, reservations: Reservation[]): Promise<void> {
  for (const reservation of reservations) await owner.drizzle.update(identityLimits).set({ attempts: sql`greatest(0, ${identityLimits.attempts} - 1)` }).where(and(eq(identityLimits.key, reservation.key), eq(identityLimits.windowStart, reservation.start)));
}
/** Issuance quota: successful requests also consume capacity (mail and OIDC transaction creation). */
export async function identityRateLimit(owner: Database, key: string, limit = 10, seconds = 300, now = new Date()): Promise<void> {
  await reserve(owner, { key, limit, seconds }, now);
}
/** Reserve before verification. Failure persists outside its transaction; success refunds only its own slot. */
export async function withIdentityAttempt<T>(owner: Database, limits: IdentityAttemptLimit[], work: () => Promise<T>, now = new Date()): Promise<T> {
  const reservations: Reservation[] = [];
  try { for (const limit of limits) reservations.push(await reserve(owner, limit, now)); }
  catch (error) { await release(owner, reservations); throw error; }
  const result = await work();
  await release(owner, reservations);
  return result;
}
