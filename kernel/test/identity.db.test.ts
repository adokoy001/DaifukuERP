import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, users, companyMemberships } from '../src/db/system-tables.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { authenticate } from '../src/auth.ts';
import {
  beginMfa,
  beginMfaLogin,
  changeMfa,
  completeMfaLogin,
  confirmMfa,
  identitySecurity,
  stepUpIdentity,
} from '../src/identity/mfa.ts';
import { completeIdentityToken, inviteIdentity, requestIdentityReset } from '../src/identity/invitations.ts';
import { deliverIdentityMail, queueIdentityMail } from '../src/identity/mail.ts';
import { identityRateLimit } from '../src/identity/common.ts';
import { identityChallenges, identityFactors, identityMail } from '../src/db/identity-tables.ts';
import { totp, tokenHash, unseal } from '../src/identity/crypto.ts';
let db: TestDb;
const key = Buffer.alloc(32, 7).toString('base64');
const now = new Date('2026-09-12T09:00:00Z');
const params = { companyId: null, now: () => now };
const config = { encryptionKey: key, webUrl: 'https://erp.example.com', mailConfigured: false };
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.close();
});
const user = async () => (await db.owner.drizzle.select().from(users).where(eq(users.id, db.adminUserId)))[0];
const current = async () => ({
  userId: db.adminUserId,
  tenantId: db.tenantId,
  sessionVersion: (await user())?.sessionVersion ?? 0,
});
const stepup = async (code?: string) =>
  db.run(params, async (ctx) => stepUpIdentity(ctx, (await current()).sessionVersion, 'password', code, key));
const login = async () => db.run(params, (ctx) => current().then((identity) => beginMfaLogin(ctx, identity)));
async function mailToken(kind: 'password_reset' | 'invitation') {
  const rows = await db.owner.drizzle.select().from(identityMail).orderBy(identityMail.createdAt);
  for (const row of [...rows].reverse()) {
    if (!row.payloadCipher) continue;
    const payload = JSON.parse(unseal(row.payloadCipher, key, `${row.tenantId}:${row.id}:mail`)) as { text: string };
    const matched = payload.text.match(/https:\/\/erp\.example\.com\/[^\s]+/);
    if (matched && matched[0].includes(kind === 'invitation' ? 'accept-invitation' : 'reset-password'))
      return { token: new URLSearchParams(new URL(matched[0]).hash.slice(1)).get('token') ?? '', row };
  }
  throw new Error('Missing synthetic mail');
}
describe('MFA and one-use identity state', () => {
  let secret = '';
  let codes: string[] = [];
  it('requires current verification, confirms a secret, revokes sessions and stores no raw recovery codes', async () => {
    await expect(stepup('000000')).resolves.toHaveProperty('stepUpToken');
    const step = await stepup();
    const identity = await current();
    const setup = await db.run(params, (ctx) => beginMfa(ctx, identity.sessionVersion, step.stepUpToken, key));
    secret = setup.secret;
    expect((await db.run(params, (ctx) => identitySecurity(ctx, identity.sessionVersion))).mfaEnabled).toBe(false);
    await expect(confirmMfa(db.owner, identity, setup.setupToken, 'bad', key, now)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const result = await confirmMfa(
      db.owner,
      identity,
      setup.setupToken,
      totp(secret, Math.floor(now.getTime() / 30000)),
      key,
      now,
    );
    codes = result.recoveryCodes;
    expect((await user())?.sessionVersion).toBe(identity.sessionVersion + 1);
    expect((await user())?.mfaEnabled).toBe(1);
    const [factor] = await db.owner.drizzle.select().from(identityFactors);
    expect(factor?.secretCipher).not.toContain(secret);
    expect(factor?.recoveryHashes).toEqual(codes.map(tokenHash));
    await expect(confirmMfa(db.owner, identity, setup.setupToken, 'bad', key, now)).rejects.toMatchObject({
      httpStatus: 401,
    });
  });
  it('persists failed challenge attempts, then rejects even a valid recovery code after five failures', async () => {
    const challenge = await login();
    for (let i = 0; i < 5; i++)
      await expect(completeMfaLogin(db.owner, challenge.challengeToken, 'bad', key, now)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    await expect(completeMfaLogin(db.owner, challenge.challengeToken, codes[0] ?? '', key, now)).rejects.toMatchObject({
      httpStatus: 401,
    });
    const [stored] = await db.owner.drizzle
      .select()
      .from(identityChallenges)
      .where(eq(identityChallenges.tokenHash, tokenHash(challenge.challengeToken)));
    expect(stored?.attempts).toBe(5);
  });
  it('uses a recovery code once under racing independent login challenges and excludes reused TOTP', async () => {
    const first = await login();
    const second = await login();
    const results = await Promise.allSettled(
      [first, second].map((challenge) =>
        completeMfaLogin(db.owner, challenge.challengeToken, codes[0] ?? '', key, now),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const again = await login();
    await expect(completeMfaLogin(db.owner, again.challengeToken, codes[0] ?? '', key, now)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      completeMfaLogin(db.owner, again.challengeToken, totp(secret, Math.floor(now.getTime() / 30000)), key, now),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('requires MFA for step-up and invalidates an earlier challenge on factor removal', async () => {
    await expect(stepup()).rejects.toMatchObject({ code: 'VALIDATION' });
    const challenge = await login();
    const step = await stepup(codes[1]);
    await db.run(params, async (ctx) => changeMfa(ctx, (await current()).sessionVersion, step.stepUpToken, 'disable'));
    await expect(completeMfaLogin(db.owner, challenge.challengeToken, codes[2] ?? '', key, now)).rejects.toMatchObject({
      httpStatus: 401,
    });
    expect((await user())?.mfaEnabled).toBe(0);
    const audit = JSON.stringify(await db.owner.drizzle.select().from(auditLog));
    for (const value of [secret, ...codes]) expect(audit).not.toContain(value);
  });
});
describe('invitation, reset and encrypted delivery', () => {
  it('creates only a pending unprivileged account and activates it using a single-use invitation', async () => {
    const step = await stepup();
    const invited = await db.run(params, async (ctx) =>
      inviteIdentity(
        ctx,
        (await current()).sessionVersion,
        { email: 'new@example.com', name: 'New user', stepUpToken: step.stepUpToken },
        config,
      ),
    );
    expect(invited.delivery).toBe('unconfigured');
    expect(await authenticate(db.owner, 'new@example.com', 'anything')).toBeNull();
    const { token } = await mailToken('invitation');
    await expect(
      completeIdentityToken(db.owner, token, 'password_reset', 'new-password-value', now),
    ).rejects.toMatchObject({ httpStatus: 401 });
    const attempts = await Promise.allSettled(
      [1, 2].map(() => completeIdentityToken(db.owner, token, 'invitation', 'new-password-value', now)),
    );
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const principal = await authenticate(db.owner, 'new@example.com', 'new-password-value');
    expect(principal).toMatchObject({ tenantAdmin: false, defaultCompanyId: null, roles: [] });
    expect(
      await db.owner.drizzle.select().from(companyMemberships).where(eq(companyMemberships.userId, invited.userId)),
    ).toEqual([]);
  });
  it('reinvites only its original pending account and invalidates the old invitation generation', async () => {
    const firstStep = await stepup();
    const identity = await current();
    const invite = (stepUpToken: string) =>
      db.run(params, (ctx) =>
        inviteIdentity(
          ctx,
          identity.sessionVersion,
          { email: 'pending@example.com', name: 'Pending', stepUpToken },
          config,
        ),
      );
    const first = await invite(firstStep.stepUpToken);
    const oldToken = (await mailToken('invitation')).token;
    const second = await invite((await stepup()).stepUpToken);
    expect(second.userId).toBe(first.userId);
    const newToken = (await mailToken('invitation')).token;
    expect(newToken).not.toBe(oldToken);
    await expect(
      completeIdentityToken(db.owner, oldToken, 'invitation', 'new-password-value', now),
    ).rejects.toMatchObject({ httpStatus: 401 });
    await completeIdentityToken(db.owner, newToken, 'invitation', 'new-password-value', now);
    await expect(invite((await stepup()).stepUpToken)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('enforces a shared rate window under concurrent requests and releases it in the next window', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => identityRateLimit(db.owner, 'synthetic-identity-limit', 2, 60, now)),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(2);
    await expect(
      identityRateLimit(db.owner, 'synthetic-identity-limit', 2, 60, new Date(now.getTime() + 61000)),
    ).resolves.toBeUndefined();
  });
  it('does not enqueue nonexistent users, prevents weak/newly expired token use and revokes prior sessions', async () => {
    const before = (await db.owner.drizzle.select().from(identityMail)).length;
    await requestIdentityReset(db.owner, 'absent@example.com', undefined, config, now);
    expect((await db.owner.drizzle.select().from(identityMail)).length).toBe(before);
    const identity = await current();
    await requestIdentityReset(db.owner, 'admin@example.com', db.tenantId, config, now);
    const { token } = await mailToken('password_reset');
    await expect(completeIdentityToken(db.owner, token, 'password_reset', 'short', now)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      completeIdentityToken(db.owner, token, 'password_reset', 'new-password-value', new Date(now.getTime() + 1800001)),
    ).rejects.toMatchObject({ httpStatus: 401 });
    await completeIdentityToken(db.owner, token, 'password_reset', 'new-password-value', now);
    expect((await user())?.sessionVersion).toBe(identity.sessionVersion + 1);
    expect(await authenticate(db.owner, 'admin@example.com', 'password')).toBeNull();
    const raw = JSON.stringify(await db.owner.drizzle.select().from(identityMail));
    expect(raw).not.toContain(token);
    expect(raw).not.toContain('admin@example.com');
  });
  it('leaves unconfigured delivery pending, retries safely, and never leaks transport errors', async () => {
    const initial = await db.owner.drizzle.select().from(identityMail);
    expect(await deliverIdentityMail(db.owner, key, undefined, 20, now)).toMatchObject({ sent: 0, configured: false });
    expect(await db.owner.drizzle.select().from(identityMail)).toEqual(initial);
    const failure = {
      send: async () => {
        throw new Error('smtp://private-password@example.com token');
      },
    };
    const result = await deliverIdentityMail(db.owner, key, failure, 20, now);
    expect(result.failed).toBeGreaterThan(0);
    const failed = await db.owner.drizzle.select().from(identityMail);
    expect(JSON.stringify(failed)).not.toContain('private-password');
    const messages: string[] = [];
    const transport = {
      send: async (message: { messageId: string }) => {
        messages.push(message.messageId);
      },
    };
    const delivered = await Promise.all(
      [1, 2].map(() => deliverIdentityMail(db.owner, key, transport, 20, new Date(now.getTime() + 61000))),
    );
    expect(delivered.reduce((n, item) => n + item.sent, 0)).toBe(failed.length);
    expect(new Set(messages).size).toBe(messages.length);
    expect(
      await db.owner.drizzle
        .select()
        .from(identityMail)
        .where(and(eq(identityMail.status, 'delivered'), eq(identityMail.payloadCipher, ''))),
    ).toHaveLength(failed.length);
  });
  it('removes encrypted recipient and token payload after the final failed attempt', async () => {
    const id = await db.run(params, (ctx) =>
      queueIdentityMail(
        ctx,
        key,
        { to: 'failed@example.test', subject: 'Synthetic failure', text: 'synthetic one-time link' },
        new Date(now.getTime() + 3600000),
      ),
    );
    await db.owner.drizzle.update(identityMail).set({ attempts: 4 }).where(eq(identityMail.id, id));
    await deliverIdentityMail(
      db.owner,
      key,
      {
        send: async () => {
          throw new Error('synthetic transport failure');
        },
      },
      20,
      now,
    );
    const [row] = await db.owner.drizzle.select().from(identityMail).where(eq(identityMail.id, id));
    expect(row).toMatchObject({
      attempts: 5,
      status: 'failed',
      payloadCipher: '',
      lastError: 'delivery_failed',
      leaseUntil: null,
    });
  });
});
