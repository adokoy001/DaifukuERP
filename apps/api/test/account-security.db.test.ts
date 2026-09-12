import { changeOwnPassword, companyMemberships, hashPassword, newId, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

const PASSWORD = 'original-private-password';
const NEW_PASSWORD = 'changed-private-password';
let db: TestDb;
let app: FastifyInstance;
const logs: string[] = [];

async function createAccount(withCompany = true) {
  const id = newId();
  const email = `${id}@example.com`;
  await db.owner.drizzle.insert(users).values({ id, tenantId: db.tenantId, email, name: 'Staff', passwordHash: hashPassword(PASSWORD), roles: [], defaultCompanyId: withCompany ? db.companyId : null });
  if (withCompany) await db.owner.drizzle.insert(companyMemberships).values({ tenantId: db.tenantId, userId: id, companyId: db.companyId, roles: ['viewer'] });
  const login = await loginAs(email, PASSWORD);
  expect(login.statusCode).toBe(200);
  return { id, email, token: login.json<{ token: string }>().token };
}

function loginAs(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
}
function post(url: string, token: string, payload: InjectOptions['payload'] = {}, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}`, ...headers } });
}
function me(token: string) {
  return app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } });
}
beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'test-account-security', logger: { stream: { write: (line: string) => void logs.push(line) } } });
  await app.ready();
});
afterAll(async () => { await app.close(); await db.close(); });

describe('quality-foundation AC-2/3: self-service account lifecycle', () => {
  it('lets ordinary staff change their password, invalidates REST sessions, and records only safe audit flags', async () => {
    const account = await createAccount();
    const secondToken = (await loginAs(account.email, PASSWORD)).json<{ token: string }>().token;
    const changed = await post('/auth/password', account.token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ ok: true });
    expect(changed.headers['cache-control']).toBe('private, no-store');
    for (const token of [account.token, secondToken]) expect((await me(token)).statusCode).toBe(401);
    expect((await loginAs(account.email, PASSWORD)).statusCode).toBe(401);
    expect((await loginAs(account.email, NEW_PASSWORD)).statusCode).toBe(200);
    const rows = await db.owner.sql`select company_id, before, after, actor_id from audit_log where record_id = ${account.id} and op = 'password_change'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company_id: null, before: null, after: { passwordChanged: true, sessionsRevoked: true }, actor_id: account.id });
    for (const secret of [PASSWORD, NEW_PASSWORD, 'scrypt$']) {
      expect(JSON.stringify(rows)).not.toContain(secret);
      expect(logs.join('')).not.toContain(secret);
    }
  });

  it('rejects incorrect current password, weak/identical new values and foreign account fields without revocation', async () => {
    const account = await createAccount();
    const cases = [
      { currentPassword: 'wrong-password', newPassword: NEW_PASSWORD },
      { currentPassword: PASSWORD, newPassword: 'short' },
      { currentPassword: PASSWORD, newPassword: PASSWORD },
      { currentPassword: PASSWORD, newPassword: 'x'.repeat(201) },
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, userId: db.adminUserId },
    ];
    for (const payload of cases) {
      const res = await post('/auth/password', account.token, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }
    expect((await me(account.token)).statusCode).toBe(200);
    expect((await loginAs(account.email, PASSWORD)).statusCode).toBe(200);
    const audits = await db.owner.sql`select id from audit_log where record_id = ${account.id}`;
    expect(audits).toHaveLength(0);
  });

  it('supports no-company accounts and ignores stale company selections for security operations', async () => {
    const account = await createAccount(false);
    expect((await me(account.token)).json()).toMatchObject({ companyId: null });
    const changed = await post('/auth/password', account.token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { 'x-company-id': newId() });
    expect(changed.statusCode).toBe(200);
    const token = (await loginAs(account.email, NEW_PASSWORD)).json<{ token: string }>().token;
    const revoked = await post('/auth/logout-all', token, {}, { 'x-company-id': 'stale-company-selection' });
    expect(revoked.statusCode).toBe(200);
    expect((await me(token)).statusCode).toBe(401);
  });

  it('revokes all existing REST sessions without changing the password', async () => {
    const account = await createAccount();
    const other = await createAccount();
    const secondToken = (await loginAs(account.email, PASSWORD)).json<{ token: string }>().token;
    const response = await post('/auth/logout-all', account.token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    for (const token of [account.token, secondToken]) expect((await me(token)).statusCode).toBe(401);
    expect((await me(other.token)).statusCode).toBe(200);
    expect((await loginAs(account.email, PASSWORD)).statusCode).toBe(200);
    expect((await post('/auth/logout-all', account.token)).statusCode).toBe(401);
    const rows = await db.owner.sql`select company_id, before, after from audit_log where record_id = ${account.id} and op = 'sessions_revoke'`;
    expect(rows).toEqual([{ company_id: null, before: null, after: { sessionsRevoked: true } }]);
  });

  it('requires authentication and rejects extra revoke targets', async () => {
    for (const url of ['/auth/password', '/auth/logout-all']) expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
    const account = await createAccount();
    expect((await post('/auth/logout-all', account.token, { userId: db.adminUserId })).statusCode).toBe(400);
    expect((await me(account.token)).statusCode).toBe(200);
  });

  it('serializes concurrent password changes and rejects a stale session after the row lock', async () => {
    const account = await createAccount();
    const sessionVersion = app.jwt.verify<{ sessionVersion: number }>(account.token).sessionVersion;
    const params = { actor: { type: 'user' as const, id: account.id }, roles: ['viewer'], companyId: null };
    const results = await Promise.allSettled([
      db.run(params, (ctx) => changeOwnPassword(ctx, sessionVersion, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })),
      db.run(params, (ctx) => changeOwnPassword(ctx, sessionVersion, { currentPassword: PASSWORD, newPassword: 'other-concurrent-password' })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { httpStatus: 401 } });
    expect((await me(account.token)).statusCode).toBe(401);
    const rows = await db.owner.sql`select id from audit_log where record_id = ${account.id} and op = 'password_change'`;
    expect(rows).toHaveLength(1);
  });
});
