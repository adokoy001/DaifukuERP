import { and, eq } from 'drizzle-orm';
import { verifyPassword } from '../auth.ts';
import type { Context } from '../context.ts';
import type { Database } from '../db/client.ts';
import { identityFactors, identityLinks } from '../db/identity-tables.ts';
import { users } from '../db/system-tables.ts';
import { StateError, ValidationError } from '../errors.ts';
import {
  authAudit,
  consumeStepUp,
  identityDenied,
  issueChallenge,
  lockIdentity,
  revokeIdentity,
  useChallenge,
} from './common.ts';
import { matchingTotpStep, recoveryCodes, seal, tokenHash, totpSecret, unseal } from './crypto.ts';
export interface IdentitySession {
  userId: string;
  tenantId: string;
  sessionVersion: number;
}
const session = (user: typeof users.$inferSelect): IdentitySession => ({
  userId: user.id,
  tenantId: user.tenantId,
  sessionVersion: user.sessionVersion,
});
const invalidCode = () =>
  new ValidationError('Verification code is incorrect or already used.', [
    { path: 'code', message: 'Use a current unused authenticator or recovery code.' },
  ]);
const aad = (tenantId: string, userId: string, purpose = 'totp') => `${tenantId}:${userId}:${purpose}`;
export async function verifyFactor(
  ctx: Context,
  user: typeof users.$inferSelect,
  code: string,
  key: string,
): Promise<void> {
  const [factor] = await ctx.db
    .select()
    .from(identityFactors)
    .where(and(eq(identityFactors.tenantId, ctx.tenantId), eq(identityFactors.userId, user.id)))
    .limit(1)
    .for('update');
  if (!factor || !user.mfaEnabled) throw identityDenied();
  const hash = tokenHash(code);
  const recovery = factor.recoveryHashes.includes(hash);
  const step = recovery
    ? null
    : matchingTotpStep(unseal(factor.secretCipher, key, aad(ctx.tenantId, user.id)), code, ctx.now(), factor.lastStep);
  if (!recovery && step === null) throw invalidCode();
  await ctx.db
    .update(identityFactors)
    .set(
      recovery
        ? { recoveryHashes: factor.recoveryHashes.filter((item) => item !== hash) }
        : { lastStep: step ?? factor.lastStep },
    )
    .where(eq(identityFactors.userId, user.id));
  if (recovery) await authAudit(ctx, user.id, 'mfa_recovery_used');
}
export async function identitySecurity(ctx: Context, sessionVersion: number) {
  const user = await lockIdentity(ctx, sessionVersion);
  const [factor] = await ctx.db.select().from(identityFactors).where(eq(identityFactors.userId, user.id));
  const identities = await ctx.db
    .select({ providerId: identityLinks.providerId, issuer: identityLinks.issuer })
    .from(identityLinks)
    .where(and(eq(identityLinks.tenantId, ctx.tenantId), eq(identityLinks.userId, user.id)));
  return { mfaEnabled: user.mfaEnabled, recoveryCodesRemaining: factor?.recoveryHashes.length ?? 0, identities };
}
export async function stepUpIdentity(
  ctx: Context,
  sessionVersion: number,
  password: string,
  code: string | undefined,
  key: string,
) {
  const user = await lockIdentity(ctx, sessionVersion);
  if (!(await verifyPassword(password, user.passwordHash)))
    throw new ValidationError('The current password is incorrect.', [
      { path: 'currentPassword', message: 'Enter your current password.' },
    ]);
  if (user.mfaEnabled) await verifyFactor(ctx, user, code ?? '', key);
  return { stepUpToken: await issueChallenge(ctx, 'stepup', user.id, { sessionVersion }, 300), expiresIn: 300 };
}
export async function beginMfa(ctx: Context, sessionVersion: number, stepUpToken: string, key: string) {
  const user = await lockIdentity(ctx, sessionVersion);
  await consumeStepUp(ctx, stepUpToken, sessionVersion);
  if (user.mfaEnabled)
    throw new StateError(
      'MFA is already enabled.',
      'Keep the existing authenticator or disable it with current verification first.',
    );
  const secret = totpSecret();
  const secretCipher = seal(secret, key, aad(ctx.tenantId, user.id, 'setup'));
  const setupToken = await issueChallenge(ctx, 'mfa_setup', user.id, { sessionVersion, secretCipher }, 600);
  const label = encodeURIComponent(`Daifuku:${user.email}`);
  return {
    setupToken,
    secret,
    otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=Daifuku&algorithm=SHA1&digits=6&period=30`,
    expiresIn: 600,
  };
}
export async function confirmMfa(
  owner: Database,
  current: IdentitySession,
  setupToken: string,
  code: string,
  key: string,
  now?: Date,
) {
  return useChallenge(
    owner,
    setupToken,
    'mfa_setup',
    async (ctx, challenge) => {
      if (
        challenge.userId !== current.userId ||
        challenge.tenantId !== current.tenantId ||
        challenge.payload.sessionVersion !== current.sessionVersion
      )
        throw identityDenied();
      const user = await lockIdentity(ctx, current.sessionVersion);
      if (user.mfaEnabled || typeof challenge.payload.secretCipher !== 'string') throw identityDenied();
      const secret = unseal(challenge.payload.secretCipher, key, aad(ctx.tenantId, user.id, 'setup'));
      const step = matchingTotpStep(secret, code, ctx.now());
      if (step === null) throw invalidCode();
      const codes = recoveryCodes();
      await ctx.db.insert(identityFactors).values({
        tenantId: ctx.tenantId,
        userId: user.id,
        secretCipher: seal(secret, key, aad(ctx.tenantId, user.id)),
        lastStep: step,
        recoveryHashes: codes.map(tokenHash),
      });
      await ctx.db.update(users).set({ mfaEnabled: true }).where(eq(users.id, user.id));
      await revokeIdentity(ctx, user);
      await authAudit(ctx, user.id, 'mfa_enabled');
      return { ok: true as const, recoveryCodes: codes };
    },
    now,
  );
}
export async function changeMfa(
  ctx: Context,
  sessionVersion: number,
  stepUpToken: string,
  mode: 'disable' | 'recovery',
) {
  const user = await lockIdentity(ctx, sessionVersion);
  await consumeStepUp(ctx, stepUpToken, sessionVersion);
  if (!user.mfaEnabled) throw identityDenied();
  const codes = mode === 'recovery' ? recoveryCodes() : [];
  if (mode === 'disable') {
    await ctx.db.delete(identityFactors).where(eq(identityFactors.userId, user.id));
    await ctx.db.update(users).set({ mfaEnabled: false }).where(eq(users.id, user.id));
  } else
    await ctx.db
      .update(identityFactors)
      .set({ recoveryHashes: codes.map(tokenHash) })
      .where(eq(identityFactors.userId, user.id));
  await revokeIdentity(ctx, user);
  await authAudit(ctx, user.id, mode === 'disable' ? 'mfa_disabled' : 'mfa_recovery_regenerated');
  return mode === 'disable' ? { ok: true as const } : { ok: true as const, recoveryCodes: codes };
}
export async function beginMfaLogin(ctx: Context, identity: IdentitySession) {
  const user = await lockIdentity(ctx, identity.sessionVersion, identity.userId);
  if (!user.mfaEnabled) throw identityDenied();
  return {
    mfaRequired: true as const,
    challengeToken: await issueChallenge(ctx, 'mfa_login', user.id, { sessionVersion: user.sessionVersion }, 300),
    expiresIn: 300,
  };
}
export async function completeMfaLogin(
  owner: Database,
  token: string,
  code: string,
  key: string,
  now?: Date,
): Promise<IdentitySession> {
  return useChallenge(
    owner,
    token,
    'mfa_login',
    async (ctx, challenge) => {
      if (!challenge.userId || typeof challenge.payload.sessionVersion !== 'number') throw identityDenied();
      const user = await lockIdentity(ctx, challenge.payload.sessionVersion);
      await verifyFactor(ctx, user, code, key);
      await authAudit(ctx, user.id, 'mfa_login');
      return session(user);
    },
    now,
  );
}
