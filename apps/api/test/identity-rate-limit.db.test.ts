import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';
let db: TestDb, app: FastifyInstance;
const login = (password = 'password', email = 'admin@example.com', ip = '192.0.2.1') =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { email, password }, remoteAddress: ip });
beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({
    owner: db.owner,
    app: db.app,
    jwtSecret: 'synthetic-rate-limit-jwt-secret',
    identity: {
      encryptionKey: Buffer.alloc(32, 9).toString('base64'),
      webUrl: 'https://erp.example.com',
      providers: [],
    },
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});
describe('authentication budgets for shared networks', () => {
  it('keeps successful repeated login and authenticated/provider reads available behind one NAT', async () => {
    for (let index = 0; index < 15; index++) {
      const response = await login();
      expect(response.statusCode, response.body).toBe(200);
    }
    const token = (await login()).json<{ token: string }>().token;
    for (let index = 0; index < 105; index++) {
      expect(
        (
          await app.inject({
            url: '/auth/me',
            remoteAddress: '192.0.2.1',
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(200);
      expect((await app.inject({ url: '/auth/oidc/providers', remoteAddress: '192.0.2.1' })).statusCode).toBe(200);
    }
    expect((await login()).statusCode).toBe(200);
  });
  it('retains failed login limits across IPs and does not charge another identity or read-only provider listing', async () => {
    for (let index = 0; index < 10; index++)
      expect((await login('wrong', 'absent@example.com', `192.0.2.${index + 10}`)).statusCode).toBe(401);
    expect((await login('wrong', 'absent@example.com', '192.0.2.99')).statusCode).toBe(429);
    expect((await login()).statusCode).toBe(200);
    expect((await app.inject({ url: '/auth/oidc/providers', remoteAddress: '192.0.2.99' })).statusCode).toBe(200);
  });
  it('limits password spraying per IP without disabling other networks or provider discovery', async () => {
    // Keep every attempt in one quota window; real scrypt and its callback timers remain asynchronous.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let index = 0; index < 100; index++)
        expect((await login('wrong', `spray-${index}@example.com`, '192.0.2.200')).statusCode).toBe(401);
      expect((await login('password', 'admin@example.com', '192.0.2.200')).statusCode).toBe(429);
      expect((await login('password', 'admin@example.com', '192.0.2.201')).statusCode).toBe(200);
      expect((await app.inject({ url: '/auth/oidc/providers', remoteAddress: '192.0.2.200' })).statusCode).toBe(200);
      // Keep all 100 real KDF verifications: the stronger profile intentionally costs more than the old default.
    } finally {
      vi.useRealTimers();
    }
  }, 120000);
  it('bounds administrator invitation issuance separately from successful authentication', async () => {
    const token = (await login()).json<{ token: string }>().token;
    const headers = { authorization: `Bearer ${token}` };
    for (let index = 0; index < 31; index++) {
      const step = await app.inject({
        method: 'POST',
        url: '/auth/step-up',
        headers,
        payload: { currentPassword: 'password' },
      });
      expect(step.statusCode, step.body).toBe(200);
      const response = await app.inject({
        method: 'POST',
        url: '/auth/invitations',
        headers,
        payload: {
          email: `invited-${index}@example.test`,
          name: 'Synthetic invitee',
          stepUpToken: step.json<{ stepUpToken: string }>().stepUpToken,
        },
      });
      expect(response.statusCode, response.body).toBe(index < 30 ? 200 : 429);
    }
    expect((await login()).statusCode).toBe(200);
    expect((await app.inject({ url: '/auth/security', headers })).statusCode).toBe(200);
  });
  it('does not accumulate successful step-up proofs as failures', async () => {
    const token = (await login()).json<{ token: string }>().token;
    for (let index = 0; index < 12; index++) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/step-up',
        headers: { authorization: `Bearer ${token}` },
        payload: { currentPassword: 'password' },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
  });
});
