import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { actorUser, writeAccessAudit } from '../access-admin-common.ts';
import type { Context } from '../context.ts';
import { withContext, type Database } from '../db/client.ts';
import { identityChallenges } from '../db/identity-tables.ts';
import { users } from '../db/system-tables.ts';
import { DaifukuError } from '../errors.ts';
import { newId } from '../ids.ts';
import { opaqueToken, tokenHash } from './crypto.ts';
import { withIdentityAttempt } from './rate-limit.ts';
export { identityRateLimit, withIdentityAttempt } from './rate-limit.ts';
export const identityDenied = (): DaifukuError =>
  new DaifukuError(
    'PERMISSION_DENIED',
    'Identity verification failed or expired.',
    'Restart verification and use a current credential.',
    undefined,
    401,
  );
export async function lockIdentity(ctx: Context, sessionVersion?: number, userId = actorUser(ctx), active = true) {
  if (ctx.actor.type === 'system') throw identityDenied();
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, userId)))
    .limit(1)
    .for('update');
  if (!user || user.active !== active || (sessionVersion !== undefined && user.sessionVersion !== sessionVersion))
    throw identityDenied();
  return user;
}
export const authAudit = (ctx: Context, userId: string, op: string) =>
  writeAccessAudit(ctx, null, 'identity', userId, op, null, { completed: true });
export async function revokeIdentity(ctx: Context, user: typeof users.$inferSelect): Promise<void> {
  await ctx.db
    .update(users)
    .set({ sessionVersion: user.sessionVersion + 1, version: user.version + 1 })
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, user.id)));
}
export async function issueChallenge(
  ctx: Context,
  purpose: string,
  userId: string | null,
  payload: Record<string, unknown>,
  seconds: number,
): Promise<string> {
  const token = opaqueToken();
  await ctx.db.insert(identityChallenges).values({
    id: newId(),
    tenantId: ctx.tenantId,
    userId,
    purpose,
    tokenHash: tokenHash(token),
    payload,
    expiresAt: new Date(ctx.now().getTime() + seconds * 1000),
  });
  return token;
}
/** Charge before the business transaction: a failed credential cannot roll back its attempt counter. */
export async function useChallenge<T>(
  owner: Database,
  token: string,
  purpose: string,
  work: (ctx: Context, row: typeof identityChallenges.$inferSelect) => Promise<T>,
  now = new Date(),
): Promise<T> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw identityDenied();
  const hash = tokenHash(token);
  const [charged] = await owner.drizzle
    .update(identityChallenges)
    .set({ attempts: sql`${identityChallenges.attempts} + 1` })
    .where(
      and(
        eq(identityChallenges.tokenHash, hash),
        eq(identityChallenges.purpose, purpose),
        isNull(identityChallenges.consumedAt),
        gt(identityChallenges.expiresAt, now),
        lt(identityChallenges.attempts, 5),
      ),
    )
    .returning();
  if (!charged) throw identityDenied();
  const limits =
    purpose === 'mfa_login' && charged.userId
      ? [{ key: `factor:${charged.tenantId}:${charged.userId}`, limit: 10 }]
      : [];
  return withIdentityAttempt(
    owner,
    limits,
    () =>
      withContext(
        owner,
        {
          tenantId: charged.tenantId,
          companyId: null,
          actor: { type: 'user', id: charged.userId ?? 'identity-challenge' },
          roles: [],
          now: () => now,
        },
        async (ctx) => {
          const [row] = await ctx.db
            .select()
            .from(identityChallenges)
            .where(and(eq(identityChallenges.tenantId, charged.tenantId), eq(identityChallenges.id, charged.id)))
            .limit(1)
            .for('update');
          if (!row || row.consumedAt || row.expiresAt <= now) throw identityDenied();
          const result = await work(ctx, row);
          await ctx.db.update(identityChallenges).set({ consumedAt: now }).where(eq(identityChallenges.id, row.id));
          return result;
        },
      ),
    now,
  );
}
/** Transactional token use for step-up, already inside an authenticated identity transaction. */
export async function consumeStepUp(ctx: Context, token: string, sessionVersion: number): Promise<void> {
  const [row] = await ctx.db
    .select()
    .from(identityChallenges)
    .where(
      and(
        eq(identityChallenges.tenantId, ctx.tenantId),
        eq(identityChallenges.userId, actorUser(ctx)),
        eq(identityChallenges.purpose, 'stepup'),
        eq(identityChallenges.tokenHash, tokenHash(token)),
      ),
    )
    .limit(1)
    .for('update');
  if (!row || row.consumedAt || row.expiresAt <= ctx.now() || row.payload.sessionVersion !== sessionVersion)
    throw identityDenied();
  await ctx.db.update(identityChallenges).set({ consumedAt: ctx.now() }).where(eq(identityChallenges.id, row.id));
}
