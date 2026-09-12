import { and, eq } from 'drizzle-orm';
import type { Context } from '../context.ts';
import { identityLinks } from '../db/identity-tables.ts';
import { newId } from '../ids.ts';
import { authAudit, consumeStepUp, identityDenied, lockIdentity, revokeIdentity } from './common.ts';
import type { IdentitySession } from './mfa.ts';
export async function linkedIdentity(ctx: Context, provider: { id: string; issuer: string }, subject: string): Promise<IdentitySession> {
  const [link] = await ctx.db.select().from(identityLinks).where(and(eq(identityLinks.tenantId, ctx.tenantId), eq(identityLinks.providerId, provider.id), eq(identityLinks.issuer, provider.issuer), eq(identityLinks.subject, subject))).limit(1);
  if (!link) throw identityDenied();
  const user = await lockIdentity(ctx, undefined, link.userId);
  return { userId: user.id, tenantId: ctx.tenantId, sessionVersion: user.sessionVersion };
}
export async function linkIdentity(ctx: Context, provider: { id: string; issuer: string }, subject: string, sessionVersion: number): Promise<{ linked: true }> {
  const user = await lockIdentity(ctx, sessionVersion);
  if (!user.passwordHash) throw identityDenied();
  const existing = await ctx.db.select().from(identityLinks).where(and(eq(identityLinks.tenantId, ctx.tenantId), eq(identityLinks.issuer, provider.issuer), eq(identityLinks.subject, subject))).limit(1);
  if (existing.length) throw identityDenied();
  await ctx.db.insert(identityLinks).values({ id: newId(), tenantId: ctx.tenantId, userId: user.id, providerId: provider.id, issuer: provider.issuer, subject });
  await revokeIdentity(ctx, user); await authAudit(ctx, user.id, 'oidc_linked'); return { linked: true };
}
export async function unlinkIdentity(ctx: Context, sessionVersion: number, providerId: string, stepUpToken: string) {
  const user = await lockIdentity(ctx, sessionVersion); await consumeStepUp(ctx, stepUpToken, sessionVersion);
  if (!user.passwordHash) throw identityDenied();
  const deleted = await ctx.db.delete(identityLinks).where(and(eq(identityLinks.tenantId, ctx.tenantId), eq(identityLinks.userId, user.id), eq(identityLinks.providerId, providerId))).returning({ id: identityLinks.id });
  if (!deleted.length) throw identityDenied();
  await revokeIdentity(ctx, user); await authAudit(ctx, user.id, 'oidc_unlinked'); return { ok: true as const };
}
