// Employee receipt ownership must hold through binary REST, generated CRUD and live membership changes.
import { bootstrapTenant, companyMemberships, configureStorage, defineAction, hashPassword, label, LocalStorage, newId, repo, tableResult, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';
import { WorkforceReceipt } from '@daifuku/mod-workforce-evidence';
import { z } from 'zod';

defineAction({ name: 'receipt_probe.report', description: label('証憑の境界試験', 'Receipt boundary probe'), input: z.object({}), output: tableResult, permission: { entity: 'workforce_receipt', op: 'read' }, exportEntities: ['workforce_receipt'], siteAccess: true, mutates: false, tx: 'none', handler: async (ctx) => ({ title: label('証憑', 'Receipts'), columns: [{ key: 'id', label: label('ID', 'ID'), kind: 'text' as const }], rows: (await repo(ctx, WorkforceReceipt).list()).items.map((row) => ({ id: row.id })) }) });

let db: TestDb;
let app: FastifyInstance;
let storageRoot: string;
let admin: string;
let alice: string;
let bob: string;
let localManager: string;
let remoteManager: string;
let outsider: string;
let siteId: string;
let aliceId: string;
const PDF = Buffer.from('%PDF-1.7\nSynthetic receipt for integration testing.\n%%EOF');

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: InjectOptions['payload'], headers: Record<string, string> = {}) {
  return app.inject({ method, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
}
async function login(email: string, password = 'test-password') {
  const result = await call('POST', '/auth/login', '', { email, password });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.headers['cache-control']).toBe('private, no-store');
  return result.json<{ token: string }>().token;
}
async function user(name: string, roles: string[], sites: string[]) {
  const id = newId();
  const email = `${name}@example.com`;
  await db.owner.drizzle.insert(users).values({ id, tenantId: db.tenantId, email, name, passwordHash: hashPassword('test-password'), roles, defaultCompanyId: db.companyId });
  await db.owner.drizzle.insert(companyMemberships).values({ tenantId: db.tenantId, companyId: db.companyId, userId: id, roles, accessScope: 'sites', siteIds: sites });
  return { id, token: await login(email) };
}
async function expense(token = alice) {
  const result = await call('POST', '/actions/workforce.save_expense', token, { expectedVersion: 0, idempotencyKey: newId(), expenseDate: '2026-09-01', category: '交通費', description: '検証用の移動', amount: '1200', evidence: 'この申請の領収書添付' });
  expect(result.statusCode, result.body).toBe(200);
  return result.json<{ id: string; version: number }>();
}
async function upload(id: string, version: number, token = alice, bytes = PDF, extraField = '') {
  const boundary = `receipt-${newId()}`;
  const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n${version}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), bytes, Buffer.from(`\r\n${extraField ? `--${boundary}\r\nContent-Disposition: form-data; name="${extraField}"\r\n\r\nforged\r\n` : ''}--${boundary}--\r\n`)];
  return call('POST', `/api/workforce/expenses/${id}/receipts`, token, Buffer.concat(parts), { 'content-type': `multipart/form-data; boundary=${boundary}` });
}
async function command(action: string, token: string, input: InjectOptions['payload']) {
  const result = await call('POST', `/actions/workforce.${action}`, token, input);
  expect(result.statusCode, result.body).toBe(200);
  return result.json<{ id: string; version: number; status: string }>();
}

beforeAll(async () => {
  db = await freshDb();
  storageRoot = await mkdtemp(join(tmpdir(), 'daifuku-workforce-receipts-'));
  configureStorage(new LocalStorage(storageRoot));
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'workforce-receipt-test-secret' });
  await app.ready();
  admin = await login('admin@example.com', 'password');
  const site = await call('POST', '/api/workforce_site', admin, { code: 'A', name: '東拠点' });
  expect(site.statusCode, site.body).toBe(200);
  siteId = site.json<{ id: string }>().id;
  const west = await call('POST', '/api/workforce_site', admin, { code: 'B', name: '西拠点' });
  expect(west.statusCode, west.body).toBe(200);
  const a = await user('alice', ['workforce_employee'], [siteId]);
  aliceId = a.id; alice = a.token;
  const b = await user('bob', ['workforce_employee'], [siteId]); bob = b.token;
  const manager = await user('manager-east', ['workforce_manager'], [siteId]);
  localManager = manager.token;
  remoteManager = (await user('manager-west', ['workforce_manager'], [west.json<{ id: string }>().id])).token;
  for (const [code, person] of [['A', a], ['B', b], ['M', manager]] as const) await command('register_employee', admin, { userId: person.id, siteId, code, name: code, hiredOn: '2026-01-01' });
  await bootstrapTenant(db.owner, { tenantName: 'Outside tenant', companyCode: 'OUT', companyName: 'Outside company', adminEmail: 'outside@example.com', adminName: 'Outside', adminPassword: 'test-password' });
  outsider = await login('outside@example.com');
});
afterAll(async () => { await app?.close(); await db?.close(); });

describe('workforce receipt privacy and workflow (workforce-platform AC-2, AC-5, AC-7)', () => {
  it('stores original bytes, increments the expense version and serves private downloads', async () => {
    const row = await expense();
    const result = await upload(row.id, row.version);
    expect(result.statusCode, result.body).toBe(200);
    const uploaded = result.json<{ receipt: { id: string; expenseId: string; sha256: string }; expenseVersion: number }>();
    expect(uploaded.expenseVersion).toBe(row.version + 1);
    expect(uploaded.receipt).toMatchObject({ expenseId: row.id, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(uploaded.receipt).not.toHaveProperty('storageKey');
    const listed = await call('GET', `/api/workforce/expenses/${row.id}/receipts`, alice);
    expect(listed.json()).toMatchObject({ items: [uploaded.receipt] });
    for (const token of [alice, localManager, admin]) {
      const downloaded = await call('GET', `/api/workforce/receipts/${uploaded.receipt.id}/download`, token);
      expect(downloaded.statusCode, downloaded.body).toBe(200);
      expect(downloaded.rawPayload).toEqual(PDF);
      expect(downloaded.headers).toMatchObject({ 'content-type': 'application/pdf', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
      expect(downloaded.headers['content-disposition']).toContain('attachment;');
    }
    const duplicate = await upload(row.id, uploaded.expenseVersion);
    expect(duplicate.statusCode).toBe(409);
    const stale = await upload(row.id, row.version, alice, Buffer.from('%PDF-another'));
    expect(stale.statusCode).toBe(409);
  });

  it('omits the internal storage key from authorized generic reads, exports and audit snapshots', async () => {
    const row = await expense();
    const uploaded = await upload(row.id, row.version);
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    const { receipt } = uploaded.json<{ receipt: { id: string } }>();
    const [stored] = await db.owner.sql`select storage_key from workforce_receipt where id = ${receipt.id}`;
    expect(stored?.storage_key).toBeTypeOf('string');
    for (const token of [alice, localManager, admin]) {
      for (const path of [`/api/workforce_receipt/${receipt.id}`, `/api/workforce_receipt?where=${encodeURIComponent(JSON.stringify({ id: receipt.id }))}`, `/api/workforce_receipt/${receipt.id}/audit`]) {
        const result = await call('GET', path, token);
        expect(result.statusCode, result.body).toBe(200);
        expect(result.body).toContain(receipt.id);
        expect(result.body).not.toContain('storageKey');
        expect(result.body).not.toContain(String(stored?.storage_key));
      }
      for (const [name, input] of [['get', { id: receipt.id }], ['list', { where: { id: receipt.id } }]] as const) {
        const result = await call('POST', `/actions/workforce_receipt.${name}`, token, input);
        expect(result.statusCode, result.body).toBe(200);
        expect(result.body).toContain(receipt.id);
        expect(result.body).not.toContain('storageKey');
        expect(result.body).not.toContain(String(stored?.storage_key));
      }
      const exported = await call('POST', '/actions/receipt_probe.report/export', token, {});
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.body).toContain(receipt.id);
      expect(exported.body).not.toContain('storageKey');
      expect(exported.body).not.toContain(String(stored?.storage_key));
    }
  });

  it('denies other employees, other sites and other tenants on REST, actions, export and bytes', async () => {
    const row = await expense();
    const result = await upload(row.id, row.version);
    const { receipt } = result.json<{ receipt: { id: string } }>();
    for (const token of [bob, remoteManager, outsider]) {
      for (const path of [`/api/workforce/expenses/${row.id}/receipts`, `/api/workforce/receipts/${receipt.id}/download`, `/api/workforce_receipt/${receipt.id}`]) {
        const denied = await call('GET', path, token);
        expect([403, 404], denied.body).toContain(denied.statusCode);
        expect(denied.headers['cache-control']).toBe('private, no-store');
      }
      expect([403, 404]).toContain((await upload(row.id, row.version + 1, token)).statusCode);
      const action = await call('POST', '/actions/workforce_receipt.get', token, { id: receipt.id });
      expect([403, 404], action.body).toContain(action.statusCode);
      const list = await call('GET', '/api/workforce_receipt', token);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json<{ items: unknown[] }>().items).toEqual([]);
      const exported = await call('POST', '/actions/receipt_probe.report/export', token, {});
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.json<{ rows: unknown[] }>().rows).toEqual([]);
    }
    expect((await call('GET', `/api/workforce/receipts/${receipt.id}/download`, '')).statusCode).toBe(401);
    expect((await upload(row.id, row.version + 1, localManager)).statusCode).toBe(403);
  });

  it('freezes submitted evidence, rejects self approval and accepts additions only after return', async () => {
    const row = await expense();
    const uploaded = await upload(row.id, row.version);
    const { expenseVersion } = uploaded.json<{ expenseVersion: number }>();
    const submitted = await command('submit_expense', alice, { expenseId: row.id, expectedVersion: expenseVersion });
    expect((await upload(row.id, submitted.version, alice, Buffer.from('%PDF-new'))).statusCode).toBe(409);
    expect((await call('POST', '/actions/workforce.review_expense', alice, { expenseId: row.id, expectedVersion: submitted.version, decision: 'approve', reason: 'self' })).statusCode).toBe(403);
    const returned = await command('review_expense', localManager, { expenseId: row.id, expectedVersion: submitted.version, decision: 'return', reason: '追加の証憑が必要' });
    expect((await upload(row.id, returned.version, alice, Buffer.from('%PDF-corrected'))).statusCode).toBe(200);
  });

  it('rejects forged metadata, generic deletion, active content and unexpected multipart fields', async () => {
    const row = await expense();
    const forged = await call('POST', '/api/workforce_receipt', admin, { expenseId: row.id, userId: aliceId, siteId, employeeId: newId(), filename: 'fake.pdf', contentType: 'application/pdf', size: 1, storageKey: 'another/key', sha256: 'a'.repeat(64) });
    expect(forged.statusCode).toBe(403);
    expect((await upload(row.id, row.version, alice, Buffer.from('<script>alert(1)</script>'))).statusCode).toBe(400);
    expect((await upload(row.id, row.version, alice, PDF, 'userId')).statusCode).toBe(400);
    expect((await upload(row.id, Number.MAX_SAFE_INTEGER + 1)).statusCode).toBe(400);
    const result = await upload(row.id, row.version);
    const { receipt } = result.json<{ receipt: { id: string } }>();
    expect((await call('DELETE', `/api/workforce_receipt/${receipt.id}`, admin)).statusCode).toBe(409);
    expect((await call('PATCH', `/api/workforce_receipt/${receipt.id}`, admin, { filename: 'changed.pdf' })).statusCode).toBe(403);
  });

  it('rechecks current site membership without accepting scope headers or old JWT claims', async () => {
    const row = await expense();
    const result = await upload(row.id, row.version);
    const { receipt } = result.json<{ receipt: { id: string } }>();
    const me = await call('GET', '/auth/me', alice);
    expect(me.json()).toMatchObject({ user: { accessScope: 'sites', siteIds: [siteId] } });
    await db.owner.sql`update user_company_memberships set site_ids = '[]'::jsonb where user_id = ${aliceId}`;
    try {
      const denied = await call('GET', `/api/workforce/receipts/${receipt.id}/download`, alice, undefined, { 'x-site-ids': siteId, 'x-access-scope': 'all' });
      expect(denied.statusCode).toBe(404);
      expect((await call('GET', '/meta/settings', alice)).statusCode).toBe(403);
    } finally { await db.owner.sql`update user_company_memberships set site_ids = ${JSON.stringify([siteId])}::jsonb where user_id = ${aliceId}`; }
  });

  it('lets a linked manager attach their own claim but never approve it themselves', async () => {
    const row = await expense(localManager);
    const uploaded = await upload(row.id, row.version, localManager);
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    const submitted = await command('submit_expense', localManager, { expenseId: row.id, expectedVersion: uploaded.json<{ expenseVersion: number }>().expenseVersion });
    const denied = await call('POST', '/actions/workforce.review_expense', localManager, { expenseId: row.id, expectedVersion: submitted.version, decision: 'approve', reason: 'Self review must fail' });
    expect(denied.statusCode).toBe(403);
  });

  it('serializes a simultaneous upload and submission against the same expense version', async () => {
    const row = await expense();
    const results = await Promise.all([
      upload(row.id, row.version),
      call('POST', '/actions/workforce.submit_expense', alice, { expenseId: row.id, expectedVersion: row.version }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const parent = await call('GET', `/api/workforce_expense/${row.id}`, alice);
    const current = parent.json<{ version: number; status: string }>();
    expect(current.version).toBe(row.version + 1);
    const attachments = await call('GET', `/api/workforce/expenses/${row.id}/receipts`, alice);
    expect(attachments.json<{ items: unknown[] }>().items).toHaveLength(current.status === 'draft' ? 1 : 0);
  });

  it('limits each expense to ten distinct files without modifying its version on rejection', async () => {
    const row = await expense();
    let version = row.version;
    for (let i = 0; i < 10; i++) {
      const result = await upload(row.id, version, alice, Buffer.from(`%PDF-limit-${i}`));
      expect(result.statusCode, result.body).toBe(200);
      version = result.json<{ expenseVersion: number }>().expenseVersion;
    }
    expect((await upload(row.id, version, alice, Buffer.from('%PDF-eleventh'))).statusCode).toBe(409);
    const parent = await call('GET', `/api/workforce_expense/${row.id}`, alice);
    expect(parent.json<{ version: number }>().version).toBe(version);
    const attachments = await call('GET', `/api/workforce/expenses/${row.id}/receipts`, alice);
    expect(attachments.json<{ items: unknown[] }>().items).toHaveLength(10);
  });

  it('detects corrupted stored bytes before download', async () => {
    const row = await expense();
    const result = await upload(row.id, row.version, alice, Buffer.from('%PDF-integrity-only'));
    const { receipt } = result.json<{ receipt: { id: string } }>();
    const [stored] = await db.owner.sql`select storage_key from workforce_receipt where id = ${receipt.id}`;
    expect(stored?.storage_key).toBeTypeOf('string');
    await writeFile(join(storageRoot, String(stored?.storage_key)), Buffer.from('corrupted'));
    const downloaded = await call('GET', `/api/workforce/receipts/${receipt.id}/download`, alice);
    expect(downloaded.statusCode).toBe(409);
    expect(downloaded.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
  });
});
