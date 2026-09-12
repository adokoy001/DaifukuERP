import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, type TestDb } from '../src/testing.ts';
import { users } from '../src/db/system-tables.ts';
import { identityLimits } from '../src/db/identity-tables.ts';
import { beginMfa, beginMfaLogin, completeMfaLogin, confirmMfa, stepUpIdentity } from '../src/identity/mfa.ts';
import { identityRateLimit, withIdentityAttempt } from '../src/identity/rate-limit.ts';
import { tokenHash, totp } from '../src/identity/crypto.ts';
let db: TestDb;
const now = new Date('2026-09-12T09:00:00Z'), key = Buffer.alloc(32, 8).toString('base64');
beforeAll(async () => { db = await freshDb(); }); afterAll(async () => { await db?.close(); });
const count = async (key: string) => (await db.owner.drizzle.select().from(identityLimits).where(eq(identityLimits.key, tokenHash(key))))[0]?.attempts;
describe('failure reservations outside identity transactions', () => {
  it('does not erase a concurrent failure when a successful request completes', async () => {
    const budget = [{ key: 'concurrent-identity', limit: 2 }];
    const entered = Promise.withResolvers<void>(), complete = Promise.withResolvers<void>();
    const successful = withIdentityAttempt(db.owner, budget, async () => { entered.resolve(); await complete.promise; return 'valid'; }, now);
    await entered.promise;
    await expect(withIdentityAttempt(db.owner, budget, async () => { throw new Error('wrong credential'); }, now)).rejects.toThrow('wrong credential');
    await expect(withIdentityAttempt(db.owner, budget, async () => 'must not run', now)).rejects.toMatchObject({ httpStatus: 429 });
    expect(await count('concurrent-identity')).toBe(2);
    complete.resolve(); expect(await successful).toBe('valid'); expect(await count('concurrent-identity')).toBe(1);
    await expect(withIdentityAttempt(db.owner, budget, async () => { throw new Error('second failure'); }, now)).rejects.toThrow('second failure');
    expect(await count('concurrent-identity')).toBe(2);
  });
  it('refunds earlier reservations if another budget rejects before verification runs', async () => {
    await identityRateLimit(db.owner, 'blocked-identity', 1, 60, now);
    let called = false;
    await expect(withIdentityAttempt(db.owner, [{ key: 'shared-nat', limit: 2 }, { key: 'blocked-identity', limit: 1, seconds: 60 }], async () => { called = true; }, now)).rejects.toMatchObject({ httpStatus: 429 });
    expect(called).toBe(false); expect(await count('shared-nat')).toBe(0); expect(await count('blocked-identity')).toBe(1);
  });
  it('cannot refund or rewind a later window when an earlier successful request finishes', async () => {
    const budget = [{ key: 'window-identity', limit: 1, seconds: 60 }];
    const entered = Promise.withResolvers<void>(), complete = Promise.withResolvers<void>();
    const pending = withIdentityAttempt(db.owner, budget, async () => { entered.resolve(); await complete.promise; }, now);
    await entered.promise;
    const next = new Date(now.getTime() + 60000);
    await identityRateLimit(db.owner, 'window-identity', 1, 60, next);
    complete.resolve(); await pending; expect(await count('window-identity')).toBe(1);
    await expect(identityRateLimit(db.owner, 'window-identity', 1, 60, now)).rejects.toMatchObject({ httpStatus: 429 });
    await expect(identityRateLimit(db.owner, 'window-identity', 1, 60, next)).rejects.toMatchObject({ httpStatus: 429 });
    await expect(identityRateLimit(db.owner, 'window-identity', 1, 60, new Date(next.getTime() + 60000))).resolves.toBeUndefined();
  });
  it('limits MFA failures per identity even when the password holder repeatedly obtains fresh challenges', async () => {
    const [user] = await db.owner.drizzle.select().from(users).where(eq(users.id, db.adminUserId)); if (!user) throw new Error('Missing synthetic user');
    const params = { companyId: null, now: () => now }, original = { userId: db.adminUserId, tenantId: db.tenantId, sessionVersion: user.sessionVersion };
    const setup = await db.run(params, async (ctx) => { const step = await stepUpIdentity(ctx, original.sessionVersion, 'password', undefined, key); return beginMfa(ctx, original.sessionVersion, step.stepUpToken, key); });
    const enabled = await confirmMfa(db.owner, original, setup.setupToken, totp(setup.secret, Math.floor(now.getTime() / 30000)), key, now);
    const identity = { ...original, sessionVersion: original.sessionVersion + 1 };
    for (let attempt = 0; attempt < 10; attempt++) {
      const challenge = await db.run(params, (ctx) => beginMfaLogin(ctx, identity));
      await expect(completeMfaLogin(db.owner, challenge.challengeToken, 'bad', key, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    const challenge = await db.run(params, (ctx) => beginMfaLogin(ctx, identity));
    await expect(completeMfaLogin(db.owner, challenge.challengeToken, enabled.recoveryCodes[0] ?? '', key, now)).rejects.toMatchObject({ httpStatus: 429 });
    const next = new Date(now.getTime() + 301000);
    await expect(completeMfaLogin(db.owner, challenge.challengeToken, enabled.recoveryCodes[0] ?? '', key, next)).rejects.toMatchObject({ httpStatus: 401 });
    const fresh = await db.run({ companyId: null, now: () => next }, (ctx) => beginMfaLogin(ctx, identity));
    await expect(completeMfaLogin(db.owner, fresh.challengeToken, enabled.recoveryCodes[0] ?? '', key, next)).resolves.toMatchObject(identity);
  });
});
