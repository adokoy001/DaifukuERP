import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootstrapTenant, companyMemberships, defineAction, defineEntity, f, label, registerCrudActions, repo, tableResult } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';

defineAction({ name: 'access_probe.report', description: label('権限試験', 'Access probe'), input: z.object({}), output: tableResult, permission: { entity: Partner.name, op: 'read' }, exportEntities: [Partner.name], tx: 'none', handler: async (ctx) => ({ title: label('取引先', 'Partners'), columns: [{ key: 'name', label: label('名称', 'Name'), kind: 'text' as const }], rows: (await repo(ctx, Partner).list()).items.map((p) => ({ name: p.name })) }) });
const Store = defineEntity({ name: 'access_probe_store', label: label('担当店', 'Assigned store'), fields: { name: f.text({ required: true }) }, permissions: { roles: { chain_staff: ['read'], chain_manager: ['read', 'export'] } }, storeAccess: { kind: 'store', field: 'id' } });
registerCrudActions();
let db: TestDb, app: FastifyInstance, adminToken: string;
type User = { id: string; version: number; active: boolean; tenantAdmin: boolean; defaultCompanyId: string | null };
const password = 'access-test-password';

async function login(email: string, secret = password) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: secret } });
}
async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, token = adminToken, companyId?: string) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...(companyId ? { 'x-company-id': companyId } : {}) }, ...(payload !== undefined ? { payload: JSON.stringify(payload), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(companyId ? { 'x-company-id': companyId } : {}) } } : {}) });
}
async function create(email: string, tenantAdmin = false): Promise<User> {
  const r = await call('POST', '/admin/users', { email, name: email, password, tenantAdmin });
  expect(r.statusCode, r.body).toBe(200); return r.json<User>();
}
async function assign(userId: string, roles = ['admin'], expectedVersion = 0) {
  return call('PUT', `/admin/users/${userId}/companies/${db.companyId}`, { expectedVersion, roles, accessScope: 'all', storeIds: [] });
}
async function current(id: string): Promise<User> {
  const r = await call('GET', '/admin/access');
  const row = r.json<{ users: User[] }>().users.find((u) => u.id === id);
  if (!row) throw new Error('missing test user'); return row;
}
beforeAll(async () => { db = await freshDb(); app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'access-test-secret' }); await app.ready(); adminToken = (await login('admin@example.com', 'password')).json<{ token: string }>().token; });
afterAll(async () => { await app.close(); await db.close(); });

describe('tenant administration and fresh company authorization', () => {
  it('creates users, assigns an initial company, and only exposes explicitly assigned companies', async () => {
    const user = await create('one-company@example.com');
    expect(user).toMatchObject({ active: true, tenantAdmin: false, defaultCompanyId: null, version: 1 });
    expect((await assign(user.id, ['viewer'])).statusCode).toBe(200);
    const token = (await login('one-company@example.com')).json<{ token: string }>().token;
    const list = await call('GET', '/auth/companies', undefined, token);
    expect(list.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([db.companyId]);
    expect((await current(user.id)).defaultCompanyId).toBe(db.companyId);
    const other = await bootstrapTenant(db.owner, { tenantName: 'Other', companyCode: 'O', companyName: 'Other', adminEmail: 'other@example.com', adminName: 'Other', adminPassword: password });
    expect((await call('GET', '/api/partner', undefined, token, other.companyId)).statusCode).toBe(403);
    expect((await call('GET', '/auth/companies', undefined, token, other.companyId)).statusCode).toBe(400);
    expect((await call('PATCH', `/admin/users/${other.userId}`, { expectedVersion: 1, name: 'Wrong tenant' })).statusCode).toBe(404);
    expect((await call('GET', '/admin/access/audit?userId=' + other.userId)).statusCode).toBe(404);
  });
  it('company admin cannot manage users or self-elevate to tenant admin', async () => {
    const user = await create('company-admin@example.com');
    expect((await assign(user.id)).statusCode).toBe(200);
    const token = (await login('company-admin@example.com')).json<{ token: string }>().token;
    expect((await call('GET', '/admin/access', undefined, token)).statusCode).toBe(403);
    expect((await call('PATCH', `/admin/users/${user.id}`, { expectedVersion: 2, tenantAdmin: true }, token)).statusCode).toBe(403);
    expect((await call('GET', '/auth/me', undefined, token)).json()).toMatchObject({ user: { roles: ['admin'], tenantAdmin: false } });
  });
  it('uses current memberships for report export and rejects stale membership versions', async () => {
    const user = await create('export@example.com');
    expect((await assign(user.id)).statusCode).toBe(200);
    const token = (await login('export@example.com')).json<{ token: string }>().token;
    expect((await call('POST', '/actions/access_probe.report/export', {}, token)).statusCode).toBe(200);
    expect((await assign(user.id, ['viewer'], 1)).statusCode).toBe(200);
    expect((await assign(user.id, ['admin'], 1)).statusCode).toBe(409);
    expect((await call('POST', '/actions/access_probe.report', {}, token)).statusCode).toBe(200);
    expect((await call('POST', '/actions/access_probe.report/export', {}, token)).statusCode).toBe(403);
    const meta = (await call('GET', '/meta', undefined, token)).json<{ actions: { name: string; canExport: boolean }[] }>();
    expect(meta.actions.find((a) => a.name === 'access_probe.report')?.canExport).toBe(false);
    expect((await call('DELETE', `/admin/users/${user.id}/companies/${db.companyId}`, { expectedVersion: 2 })).statusCode).toBe(200);
    expect((await call('GET', '/api/partner', undefined, token, db.companyId)).statusCode).toBe(403);
    expect((await current(user.id)).defaultCompanyId).toBeNull();
    const recover = await call('GET', '/auth/companies', undefined, token, db.companyId);
    expect(recover.statusCode).toBe(200);
    expect(recover.json()).toEqual({ items: [], companyId: null });
  });
  it('disabling/reactivating or resetting a password cannot revive old tokens; audit has no secrets', async () => {
    const user = await create('session@example.com'); await assign(user.id, ['viewer']);
    const token = (await login('session@example.com')).json<{ token: string }>().token;
    let version = (await current(user.id)).version;
    expect((await call('PATCH', `/admin/users/${user.id}`, { expectedVersion: version, active: false })).statusCode).toBe(200);
    expect((await call('GET', '/auth/me', undefined, token)).statusCode).toBe(401);
    version += 1;
    expect((await call('PATCH', `/admin/users/${user.id}`, { expectedVersion: version, active: true })).statusCode).toBe(200);
    expect((await call('GET', '/auth/me', undefined, token)).statusCode).toBe(401);
    const currentToken = (await login('session@example.com')).json<{ token: string }>().token;
    version += 1;
    expect((await call('PATCH', `/admin/users/${user.id}`, { expectedVersion: version, password: 'a-new-secret-password' })).statusCode).toBe(200);
    expect((await call('GET', '/auth/me', undefined, currentToken)).statusCode).toBe(401);
    expect((await login('session@example.com')).statusCode).toBe(401);
    expect((await login('session@example.com', 'a-new-secret-password')).statusCode).toBe(200);
    const audit = await call('GET', `/admin/access/audit?userId=${user.id}`);
    expect(audit.statusCode).toBe(200);
    expect(audit.body).not.toContain(password); expect(audit.body).not.toContain('scrypt'); expect(audit.body).not.toContain('a-new-secret-password');
    expect(audit.body).toContain('passwordChanged');
  });
  it('validates store assignments and resolves the store boundary again on each HTTP call', async () => {
    const storeA = await db.run({}, (ctx) => repo(ctx, Store).create({ name: 'Visible A' }));
    const storeB = await db.run({}, (ctx) => repo(ctx, Store).create({ name: 'Hidden B' }));
    const user = await create('store-staff@example.com');
    const url = `/admin/users/${user.id}/companies/${db.companyId}`;
    expect((await call('PUT', url, { expectedVersion: 0, roles: ['chain_staff'], accessScope: 'stores', storeIds: [] })).statusCode).toBe(400);
    expect((await call('PUT', url, { expectedVersion: 0, roles: ['admin'], accessScope: 'stores', storeIds: [storeA.id] })).statusCode).toBe(400);
    expect((await call('PUT', url, { expectedVersion: 0, roles: ['chain_staff'], accessScope: 'stores', storeIds: [storeA.id] })).statusCode).toBe(200);
    const token = (await login('store-staff@example.com')).json<{ token: string }>().token;
    const listed = await call('GET', '/api/access_probe_store', undefined, token);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: { name: string }[] }>().items.map((s) => s.name)).toEqual(['Visible A']);
    expect((await call('GET', `/api/access_probe_store/${storeB.id}`, undefined, token)).statusCode).toBe(404);
    expect((await call('GET', '/api/partner', undefined, token)).statusCode).toBe(403);
    expect((await call('GET', '/meta/entities/partner', undefined, token)).statusCode).toBe(403);
    expect((await call('PUT', url, { expectedVersion: 1, roles: ['chain_staff'], accessScope: 'stores', storeIds: [storeB.id] })).statusCode).toBe(200);
    const changed = await call('GET', '/api/access_probe_store', undefined, token);
    expect(changed.json<{ items: { name: string }[] }>().items.map((s) => s.name)).toEqual(['Hidden B']);
  });
  it('does not honor legacy roles and prevents self access changes', async () => {
    const user = await create('legacy@example.com');
    await db.owner.sql`update users set roles = '["admin"]'::jsonb where id = ${user.id}`;
    const token = (await login('legacy@example.com')).json<{ token: string }>().token;
    expect((await call('GET', '/auth/me', undefined, token)).json()).toMatchObject({ user: { roles: [], tenantAdmin: false } });
    const self = await current(db.adminUserId);
    expect((await call('PATCH', `/admin/users/${self.id}`, { expectedVersion: self.version, tenantAdmin: false })).statusCode).toBe(403);
    expect((await call('PATCH', `/admin/users/${self.id}`, { expectedVersion: self.version, active: false })).statusCode).toBe(403);
    expect((await assign(self.id, ['viewer'], 1)).statusCode).toBe(403);
  });
  it('serializes concurrent administrator removal and leaves one active administrator', async () => {
    const other = await create('second-admin@example.com', true);
    const token = (await login('second-admin@example.com')).json<{ token: string }>().token;
    const self = await current(db.adminUserId);
    const results = await Promise.all([
      call('PATCH', `/admin/users/${other.id}`, { expectedVersion: other.version, tenantAdmin: false }),
      call('PATCH', `/admin/users/${self.id}`, { expectedVersion: self.version, tenantAdmin: false }, token),
    ]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const rows = await db.owner.sql`select id from users where tenant_id = ${db.tenantId} and active = 1 and tenant_admin = 1`;
    expect(rows).toHaveLength(1);
    const memberships = await db.owner.drizzle.select().from(companyMemberships);
    expect(memberships.length).toBeGreaterThan(0);
  });
});
