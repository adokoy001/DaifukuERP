import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { beginMfa, changeMfa, confirmMfa, stepUpIdentity, totp, type Logger } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { openAgentSession, refreshAgentContext } from '../src/session.ts';
let db: TestDb, codes: string[];
const key = Buffer.alloc(32, 7).toString('base64'),
  now = new Date(),
  log: Logger = { info() {}, warn() {}, error() {} };
beforeAll(async () => {
  db = await freshDb();
  const params = { companyId: null, now: () => now };
  const step = await db.run(params, (ctx) => stepUpIdentity(ctx, 1, 'password', undefined, key));
  const setup = await db.run(params, (ctx) => beginMfa(ctx, 1, step.stepUpToken, key));
  const confirmed = await confirmMfa(
    db.owner,
    { userId: db.adminUserId, tenantId: db.tenantId, sessionVersion: 1 },
    setup.setupToken,
    totp(setup.secret, Math.floor(now.getTime() / 30000)),
    key,
    now,
  );
  codes = confirmed.recoveryCodes;
});
afterAll(async () => {
  await db?.close();
});
describe('MCP honors MFA before issuing an agent context', () => {
  it('denies password-only login, verifies one-time recovery and rejects stale or unverified contexts', async () => {
    const login = { email: 'admin@example.com', password: 'password', agentId: 'mfa-agent', companyId: db.companyId };
    expect(await openAgentSession(db.owner, login, log)).toBeNull();
    const session = await openAgentSession(db.owner, { ...login, mfaCode: codes[0], identityEncryptionKey: key }, log);
    expect(session?.params.mfaVerified).toBe(true);
    if (!session) throw new Error('Expected a verified session');
    expect(
      await openAgentSession(db.owner, { ...login, mfaCode: codes[0], identityEncryptionKey: key }, log),
    ).toBeNull();
    await expect(refreshAgentContext(db.owner, { ...session.params, mfaVerified: false })).rejects.toMatchObject({
      httpStatus: 401,
    });
    await expect(refreshAgentContext(db.owner, session.params)).resolves.toHaveProperty('mfaVerified', true);
    const step = await db.run({ companyId: null }, (ctx) => stepUpIdentity(ctx, 2, 'password', codes[1], key));
    await db.run({ companyId: null }, (ctx) => changeMfa(ctx, 2, step.stepUpToken, 'disable'));
    await expect(refreshAgentContext(db.owner, session.params)).rejects.toMatchObject({ httpStatus: 401 });
  });
  it('does not exhaust login capacity when a client successfully reconnects repeatedly', async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      const session = await openAgentSession(
        db.owner,
        { email: 'admin@example.com', password: 'password', agentId: 'reconnect-agent', companyId: db.companyId },
        log,
      );
      expect(session?.params.actor.type).toBe('agent');
    }
  });
});
