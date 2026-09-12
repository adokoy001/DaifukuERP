import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { assertAccessAdmin, parseAccess, writeAccessAudit } from '../access-admin-common.ts';
import { hashPassword } from '../auth.ts';
import type { Context } from '../context.ts';
import { withContext, type Database } from '../db/client.ts';
import { identityChallenges } from '../db/identity-tables.ts';
import { companyMemberships, users } from '../db/system-tables.ts';
import { StateError } from '../errors.ts';
import { newId } from '../ids.ts';
import { authAudit, consumeStepUp, identityDenied, issueChallenge, lockIdentity, revokeIdentity, useChallenge } from './common.ts';
import { queueIdentityMail } from './mail.ts';
export interface MailIdentityOptions { encryptionKey: string; webUrl: string; mailConfigured: boolean }
function messageLink(config: MailIdentityOptions, path: string, token: string): string { const url = new URL(path, config.webUrl); url.hash = new URLSearchParams({ token }).toString(); return url.toString(); }
export async function inviteIdentity(ctx: Context, sessionVersion: number, input: { email: string; name: string; stepUpToken: string }, config: MailIdentityOptions) {
  await assertAccessAdmin(ctx, true); await lockIdentity(ctx, sessionVersion); await consumeStepUp(ctx, input.stepUpToken, sessionVersion);
  const email = input.email.trim().toLowerCase();
  const [existing] = await ctx.db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.email, email))).limit(1).for('update');
  let user;
  if (existing) {
    const memberships = await ctx.db.select().from(companyMemberships).where(and(eq(companyMemberships.tenantId, ctx.tenantId), eq(companyMemberships.userId, existing.id))).limit(1);
    const invites = await ctx.db.select({ id: identityChallenges.id }).from(identityChallenges).where(and(eq(identityChallenges.tenantId, ctx.tenantId), eq(identityChallenges.userId, existing.id), eq(identityChallenges.purpose, 'invitation'))).limit(1);
    if (!invites.length || existing.active !== 0 || existing.passwordHash || existing.tenantAdmin || memberships.length) throw new StateError('This account cannot be invited.', 'Use existing account management; invitations cannot reset or reactivate an established account.');
    await revokeIdentity(ctx, existing); user = { ...existing, version: existing.version + 1, sessionVersion: existing.sessionVersion + 1 };
  } else {
    const [created] = await ctx.db.insert(users).values({ id: newId(), tenantId: ctx.tenantId, email, name: input.name, active: 0 }).returning();
    if (!created) throw identityDenied(); user = created;
  }
  const token = await issueChallenge(ctx, 'invitation', user.id, { sessionVersion: user.sessionVersion }, 86400);
  await queueIdentityMail(ctx, config.encryptionKey, { to: email, subject: 'Daifuku invitation', text: `You have been invited to Daifuku. Set your password within 24 hours: ${messageLink(config, '/accept-invitation', token)}\nIf unexpected, ignore this message.` }, new Date(ctx.now().getTime() + 86400000));
  await writeAccessAudit(ctx, null, 'identity', user.id, 'invitation_queued', null, { pending: true });
  return { ok: true as const, userId: user.id, delivery: config.mailConfigured ? 'queued' as const : 'unconfigured' as const };
}
export async function requestIdentityReset(owner: Database, email: string, tenantId: string | undefined, config: MailIdentityOptions, now = new Date()): Promise<void> {
  const rows = await owner.drizzle.select().from(users).where(and(eq(users.email, email.trim().toLowerCase()), eq(users.active, 1), tenantId ? eq(users.tenantId, tenantId) : undefined)).limit(2);
  const user = rows[0]; if (rows.length !== 1 || !user) return;
  await withContext(owner, { tenantId: user.tenantId, companyId: null, actor: { type: 'user', id: user.id }, roles: [], now: () => now }, async (ctx) => {
    const current = await lockIdentity(ctx, user.sessionVersion);
    const token = await issueChallenge(ctx, 'password_reset', user.id, { sessionVersion: current.sessionVersion }, 1800);
    await queueIdentityMail(ctx, config.encryptionKey, { to: current.email, subject: 'Daifuku password reset', text: `Reset your password within 30 minutes: ${messageLink(config, '/reset-password', token)}\nIf you did not request this, ignore it. MFA remains enabled.` }, new Date(now.getTime() + 1800000));
  });
}
export async function completeIdentityToken(owner: Database, token: string, purpose: 'invitation' | 'password_reset', password: string, now?: Date) {
  parseAccess(z.object({ password: z.string().min(12).max(200) }), { password });
  return useChallenge(owner, token, purpose, async (ctx, challenge) => {
    if (!challenge.userId || typeof challenge.payload.sessionVersion !== 'number') throw identityDenied();
    const user = await lockIdentity(ctx, challenge.payload.sessionVersion, challenge.userId, purpose === 'invitation' ? 0 : 1);
    if (purpose === 'invitation' && (user.passwordHash || user.tenantAdmin)) throw identityDenied();
    await ctx.db.update(users).set({ passwordHash: hashPassword(password), active: 1, sessionVersion: user.sessionVersion + 1, version: user.version + 1 }).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, user.id)));
    await authAudit(ctx, user.id, purpose === 'invitation' ? 'invitation_accepted' : 'password_reset');
    return { ok: true as const };
  }, now);
}
