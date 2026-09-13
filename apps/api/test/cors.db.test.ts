import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readApiConfig } from '../src/config.ts';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let local: FastifyInstance;
let explicit: FastifyInstance;
let sameOrigin: FastifyInstance;
beforeAll(async () => {
  db = await freshDb();
  const options = { owner: db.owner, app: db.app, jwtSecret: 'cors-fixture-secret' };
  const cfg = readApiConfig({ DATABASE_URL: 'unused', DATABASE_URL_OWNER: 'unused', JWT_SECRET: options.jwtSecret });
  local = await buildServer({ ...options, corsOrigins: cfg.corsOrigins });
  explicit = await buildServer({ ...options, corsOrigins: ['https://erp.example.test'] });
  sameOrigin = await buildServer(options);
  await Promise.all([local.ready(), explicit.ready(), sameOrigin.ready()]);
});
afterAll(async () => {
  await Promise.all([local?.close(), explicit?.close(), sameOrigin?.close()]);
  await db?.close();
});

describe('public-release AC-8 CORS with real API authentication', () => {
  it('permits PATCH and DELETE preflights only for the configured local UI origins', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
      for (const method of ['PATCH', 'DELETE']) {
        const res = await local.inject({
          method: 'OPTIONS',
          url: '/api/partner',
          headers: {
            origin,
            'access-control-request-method': method,
            'access-control-request-headers': 'authorization,content-type,x-company-id',
          },
        });
        expect(res.statusCode).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-methods']).toContain(method);
        expect(res.headers['access-control-allow-headers']).toContain('x-company-id');
      }
    }
  });

  it('never reflects a foreign, null, deceptive suffix, or wrong-port origin', async () => {
    for (const origin of [
      'https://untrusted.example.test',
      'null',
      'http://localhost:5173.untrusted.example.test',
      'http://localhost:5174',
    ]) {
      const res = await local.inject({
        method: 'OPTIONS',
        url: '/api/partner',
        headers: { origin, 'access-control-request-method': 'PATCH' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      const simple = await local.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(simple.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('uses the explicit deployment allowlist without inheriting local defaults', async () => {
    for (const origin of ['https://erp.example.test', 'http://localhost:5173']) {
      const res = await explicit.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(
        origin === 'https://erp.example.test' ? origin : undefined,
      );
    }
  });

  it('defaults a directly built server to no cross-origin grants and preserves JWT authentication without Origin', async () => {
    const login = await sameOrigin.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@example.com', password: 'password' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['access-control-allow-origin']).toBeUndefined();
    const token = login.json<{ token: string }>().token;
    const me = await sameOrigin.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { id: db.adminUserId }, companyId: db.companyId });
    const foreign = await sameOrigin.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    const anonymous = await local.inject({ method: 'GET', url: '/meta', headers: { origin: 'http://localhost:5173' } });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
