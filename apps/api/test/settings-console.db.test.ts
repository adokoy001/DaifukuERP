// docs/specs/settings-console.md AC-4..AC-7 (ADR-0027): presentation and default in GET /meta/settings, DELETE (back to
// the module default, audited), the per-key history, and the same access boundary as PUT.
import {
  auditTrail,
  companies,
  companyMemberships,
  deleteSetting,
  getCompany,
  hashPassword,
  newId,
  registry,
  setSetting,
  settingHistory,
  users,
} from '@daifuku/kernel';
import { eq, sql } from 'drizzle-orm';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

const JWT_SECRET = 'test-secret';

let db: TestDb;
let app: FastifyInstance;
let adminToken: string;
let settingsToken: string;
let settingsUserId: string;
let salesToken: string;
let scopedToken: string;

interface JsonResponse {
  status: number;
  body: unknown;
}

interface SettingOut {
  key: string;
  category: string;
  order?: number;
  fields?: Record<
    string,
    { label: { ja: string; en: string }; widget?: string; valueLabels?: Record<string, unknown> }
  >;
  widget?: string;
  valueLabels?: Record<string, unknown>;
  defaultValue?: unknown;
  isDefault: boolean;
  value: unknown;
}

interface ChangeOut {
  id: string;
  at: string;
  op: string;
  actorType: string;
  actorId: string;
  actorName: string | null;
  onBehalfOf: string | null;
  onBehalfOfName: string | null;
  before: unknown;
  after: unknown;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<JsonResponse> {
  const t = opts.token === undefined ? adminToken : opts.token;
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as unknown };
}

const errorCode = (res: JsonResponse) => (res.body as { error?: { code?: string } }).error?.code;

async function login(email: string, password: string): Promise<string> {
  const res = await call('POST', '/auth/login', { body: { email, password }, token: null });
  return (res.body as { token: string }).token;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function member(
  email: string,
  name: string,
  roles: string[],
  scope: { accessScope?: 'all' | 'stores' | 'sites' } = {},
): Promise<{ id: string; token: string }> {
  const id = newId();
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: db.tenantId,
    email,
    name,
    passwordHash: await hashPassword('member-pw'),
    roles,
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle.insert(companyMemberships).values({
    tenantId: db.tenantId,
    userId: id,
    companyId: db.companyId,
    roles,
    accessScope: scope.accessScope ?? 'all',
  });
  return { id, token: await login(email, 'member-pw') };
}

async function settingsList(token?: string): Promise<SettingOut[]> {
  const res = await call('GET', '/meta/settings', token === undefined ? {} : { token });
  expect(res.status).toBe(200);
  return res.body as SettingOut[];
}

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: JWT_SECRET });
  await app.ready();
  adminToken = await login('admin@example.com', 'password');
  const settingsUser = await member('settings@example.com', '設定 担当', ['settings']);
  settingsUserId = settingsUser.id;
  settingsToken = settingsUser.token;
  salesToken = (await member('sales@example.com', 'Sales', ['sales'])).token;
  scopedToken = (await member('scoped@example.com', 'Scoped', ['admin', 'settings'], { accessScope: 'sites' })).token;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('settings-console AC-4: GET /meta/settings carries presentation and the default', () => {
  it('AC-4: category, order, fields, defaultValue and isDefault for an unset object setting', async () => {
    const accounts = (await settingsList()).find((s) => s.key === 'sales.accounts');
    expect(accounts).toMatchObject({
      category: 'sales',
      order: 20,
      defaultValue: { receivable: '1300', revenue: '4000', taxPayable: '2200' },
      isDefault: true,
      value: null,
    });
    expect(accounts?.fields?.revenue).toEqual({ label: { ja: '売上高', en: 'Revenue' }, widget: 'account-code' });
  });

  it('AC-4: scalar settings carry widget / valueLabels; a setting without a default has no defaultValue', async () => {
    const list = await settingsList();
    const byKey = new Map(list.map((s) => [s.key, s] as const));
    expect(byKey.get('inventory.default_warehouse')).toMatchObject({
      category: 'inventory',
      widget: 'warehouse-code',
      defaultValue: 'MAIN',
    });
    expect(byKey.get('contract.default_proration')?.valueLabels).toHaveProperty('daily');
    expect(byKey.get('sales.issuer')).not.toHaveProperty('defaultValue');
    expect(byKey.get('packs.applied')).toMatchObject({ category: 'system', isDefault: true });
    for (const s of list) expect(typeof s.isDefault).toBe('boolean');
  });

  it('AC-4/AC-11: a stored value the schema rejects reads as value null with isDefault false (the screen warns)', async () => {
    const stored = { receivable: '1300', revenue: 5, taxPayable: '2200' };
    await db.owner.drizzle
      .update(companies)
      .set({ settings: sql`${companies.settings} || ${JSON.stringify({ 'sales.accounts': stored })}::jsonb` })
      .where(eq(companies.id, db.companyId));
    try {
      const listed = (await settingsList(settingsToken)).find((s) => s.key === 'sales.accounts');
      expect(listed).toMatchObject({ value: null, isDefault: false, defaultValue: { revenue: '4000' } });
    } finally {
      await db.owner.drizzle
        .update(companies)
        .set({ settings: sql`${companies.settings} - 'sales.accounts'::text` })
        .where(eq(companies.id, db.companyId));
    }
    const restored = (await settingsList()).find((s) => s.key === 'sales.accounts');
    expect(restored).toMatchObject({ value: null, isDefault: true });
  });

  it('AC-4: after PUT the value is stored and isDefault is false (the settings role may read and write)', async () => {
    const put = await call('PUT', '/meta/settings/sales.accounts', {
      body: { value: { receivable: '1300', revenue: '4100', taxPayable: '2200' } },
      token: settingsToken,
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ key: 'sales.accounts', isDefault: false, value: { revenue: '4100' } });
    const listed = (await settingsList(settingsToken)).find((s) => s.key === 'sales.accounts');
    expect(listed).toMatchObject({ isDefault: false, value: { revenue: '4100' } });
  });
});

describe('settings-console AC-5: DELETE /meta/settings/:key', () => {
  it('AC-5: removes the stored value, audits before -> null and answers like GET', async () => {
    await call('PUT', '/meta/settings/inventory.allow_negative_stock', { body: { value: true } });
    const before = await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId));
    const res = await call('DELETE', '/meta/settings/inventory.allow_negative_stock');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      key: 'inventory.allow_negative_stock',
      isDefault: true,
      value: null,
      defaultValue: false,
      category: 'inventory',
    });
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId));
    expect(trail).toHaveLength(before.length + 1);
    expect(trail[0]).toMatchObject({
      op: 'delete',
      before: { 'inventory.allow_negative_stock': true },
      after: { 'inventory.allow_negative_stock': null },
    });
    const company = await db.run({}, (ctx) => getCompany(ctx));
    expect(company.settings).not.toHaveProperty('inventory.allow_negative_stock');
  });

  it('AC-5: with no stored value nothing is written or audited and the same shape is returned', async () => {
    const before = await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId));
    const res = await call('DELETE', '/meta/settings/inventory.allow_negative_stock', { token: settingsToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'inventory.allow_negative_stock', isDefault: true });
    expect(await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId))).toHaveLength(before.length);
    expect(await db.run({}, (ctx) => deleteSetting(ctx, 'inventory.allow_negative_stock'))).toBe(false);
  });

  it('AC-5: an undeclared key is 404 with a hint; other stored settings are untouched', async () => {
    await call('PUT', '/meta/settings/contract.auto_submit', { body: { value: true } });
    const res = await call('DELETE', '/meta/settings/nope.nothing');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND', hint: expect.stringContaining('/meta/settings') } });
    const listed = (await settingsList()).find((s) => s.key === 'contract.auto_submit');
    expect(listed).toMatchObject({ value: true, isDefault: false });
  });
});

describe('settings-console AC-6: GET /meta/settings/:key/audit', () => {
  it('AC-6: changes of that key only, newest first, with time, actor name, before and after values', async () => {
    await call('PUT', '/meta/settings/sales.accounts', {
      body: { value: { receivable: '1300', revenue: '4200', taxPayable: '2200' } },
    });
    await call('DELETE', '/meta/settings/sales.accounts', { token: settingsToken });
    await call('PUT', '/meta/settings/tax.rounding', { body: { value: { mode: 'up', unit: 'invoice' } } });
    const res = await call('GET', '/meta/settings/sales.accounts/audit', { token: settingsToken });
    expect(res.status).toBe(200);
    const changes = res.body as ChangeOut[];
    expect(changes.map((c) => c.op)).toEqual(['delete', 'update', 'update']);
    expect(changes[0]).toMatchObject({
      actorType: 'user',
      actorId: settingsUserId,
      actorName: '設定 担当',
      before: { revenue: '4200' },
      after: null,
    });
    expect(changes[1]).toMatchObject({ actorName: 'Admin', before: { revenue: '4100' }, after: { revenue: '4200' } });
    expect(changes[2]).toMatchObject({ before: null, after: { revenue: '4100' } });
    expect(Number.isNaN(Date.parse(changes[0]?.at ?? ''))).toBe(false);
    expect(Date.parse(changes[0]?.at ?? '')).toBeGreaterThanOrEqual(Date.parse(changes[2]?.at ?? ''));
  });

  it('AC-6: at most 20 entries (the latest)', async () => {
    for (let n = 1; n <= 22; n++)
      await call('PUT', '/meta/settings/inventory.default_warehouse', { body: { value: `W${n}` } });
    const changes = (await call('GET', '/meta/settings/inventory.default_warehouse/audit')).body as ChangeOut[];
    expect(changes).toHaveLength(20);
    expect(changes[0]).toMatchObject({ before: 'W21', after: 'W22' });
    expect(changes[19]).toMatchObject({ before: 'W2', after: 'W3' });
  });

  it('AC-6: an agent id (free text from x-agent-id) is never shown as a user name; the user it acted for is', async () => {
    const res = await call('PUT', '/meta/settings/inventory.auto_issue_on_sales', {
      body: { value: false },
      token: settingsToken,
      headers: { 'x-agent-id': db.adminUserId },
    });
    expect(res.status).toBe(200);
    const changes = (await call('GET', '/meta/settings/inventory.auto_issue_on_sales/audit')).body as ChangeOut[];
    expect(changes[0]).toMatchObject({
      actorType: 'agent',
      actorId: db.adminUserId,
      actorName: null,
      onBehalfOf: settingsUserId,
      onBehalfOfName: '設定 担当',
      after: false,
    });
    await call('DELETE', '/meta/settings/inventory.auto_issue_on_sales');
  });

  it('AC-6: overlapping writes wait for the company row, so each audited before is the previous after', async () => {
    const key = 'inventory.default_warehouse';
    const schema = registry.setting(key).schema;
    // A write that holds its transaction open while a second write of the same key starts.
    const slowSet = db.run({}, async (ctx) => {
      await setSetting(ctx, key, schema, 'RACE-A');
      await sleep(400);
    });
    await sleep(100);
    await Promise.all([slowSet, db.run({}, (ctx) => setSetting(ctx, key, schema, 'RACE-B'))]);
    const slowDelete = db.run({}, async (ctx) => {
      await deleteSetting(ctx, key);
      await sleep(400);
    });
    await sleep(100);
    await Promise.all([slowDelete, db.run({}, (ctx) => setSetting(ctx, key, schema, 'RACE-C'))]);
    const history = await db.run({}, (ctx) => settingHistory(ctx, key, 5));
    expect(history.slice(0, 4).map((c) => [c.op, c.before, c.after])).toEqual([
      ['update', null, 'RACE-C'],
      ['delete', 'RACE-B', null],
      ['update', 'RACE-A', 'RACE-B'],
      ['update', history[3]?.before ?? null, 'RACE-A'],
    ]);
    for (let i = 0; i + 1 < history.length; i++) expect(history[i]?.before).toEqual(history[i + 1]?.after);
  });

  it('AC-6: an undeclared key is 404; a key that never changed has an empty history', async () => {
    expect((await call('GET', '/meta/settings/nope.nothing/audit')).status).toBe(404);
    const empty = await call('GET', '/meta/settings/purchase.accounts/audit');
    expect(empty).toMatchObject({ status: 200, body: [] });
  });
});

describe('settings-console AC-7: the same boundary as PUT', () => {
  it('AC-7: a member without admin or settings is refused list, save, delete and history', async () => {
    for (const [method, url, body] of [
      ['GET', '/meta/settings', undefined],
      ['PUT', '/meta/settings/sales.accounts', { value: { receivable: '1', revenue: '2', taxPayable: '3' } }],
      ['DELETE', '/meta/settings/contract.auto_submit', undefined],
      ['GET', '/meta/settings/sales.accounts/audit', undefined],
    ] as const) {
      const res = await call(method, url, { token: salesToken, ...(body ? { body } : {}) });
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(errorCode(res)).toBe('PERMISSION_DENIED');
    }
  });

  it('AC-7: a site-scoped member is refused even with the admin and settings roles', async () => {
    for (const [method, url, body] of [
      ['GET', '/meta/settings', undefined],
      ['PUT', '/meta/settings/contract.auto_submit', { value: false }],
      ['DELETE', '/meta/settings/contract.auto_submit', undefined],
      ['GET', '/meta/settings/contract.auto_submit/audit', undefined],
    ] as const) {
      const res = await call(method, url, { token: scopedToken, ...(body ? { body } : {}) });
      expect(res.status, `${method} ${url}`).toBe(403);
    }
    const listed = (await settingsList()).find((s) => s.key === 'contract.auto_submit');
    expect(listed).toMatchObject({ value: true, isDefault: false });
  });

  it('AC-7: the kernel ports refuse store-scoped contexts and plain roles (not only the routes)', async () => {
    await expect(
      db.run({ roles: ['admin'], accessScope: 'stores' }, (ctx) => deleteSetting(ctx, 'contract.auto_submit')),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run({ roles: ['sales'] }, (ctx) => settingHistory(ctx, 'contract.auto_submit')),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run({ roles: ['settings'] }, (ctx) => settingHistory(ctx, 'contract.auto_submit')),
    ).resolves.toEqual(expect.any(Array));
  });

  it('AC-7: history and reset stay inside the company; a member of another company is refused', async () => {
    const other = newId();
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${other}, ${db.tenantId}, 'SET-B', 'B社')`;
    const both = await member('settings-both@example.com', '両社 設定', ['settings']);
    await db.owner.drizzle
      .insert(companyMemberships)
      .values({ tenantId: db.tenantId, userId: both.id, companyId: other, roles: ['settings'], accessScope: 'all' });
    const inB = { 'x-company-id': other };
    const put = await call('PUT', '/meta/settings/contract.default_proration', {
      body: { value: 'none' },
      token: both.token,
      headers: inB,
    });
    expect(put.status).toBe(200);
    const auditB = await call('GET', '/meta/settings/contract.default_proration/audit', {
      token: both.token,
      headers: inB,
    });
    expect(auditB.status).toBe(200);
    expect(auditB.body as ChangeOut[]).toHaveLength(1);
    const auditA = await call('GET', '/meta/settings/contract.default_proration/audit', { token: both.token });
    expect(auditA).toMatchObject({ status: 200, body: [] });
    expect((await settingsList(both.token)).find((s) => s.key === 'contract.default_proration')).toMatchObject({
      isDefault: true,
    });
    // A settings member of company A only cannot read or reset company B's setting.
    for (const method of ['GET', 'DELETE'] as const) {
      const url = `/meta/settings/contract.default_proration${method === 'GET' ? '/audit' : ''}`;
      const res = await call(method, url, { token: settingsToken, headers: inB });
      expect(res.status, `${method} ${url}`).toBe(403);
    }
    const stillB = await call('GET', '/meta/settings/contract.default_proration/audit', {
      token: both.token,
      headers: inB,
    });
    expect(stillB.body as ChangeOut[]).toHaveLength(1);
  });

  it('AC-7: unauthenticated calls are 401', async () => {
    expect((await call('DELETE', '/meta/settings/contract.auto_submit', { token: null })).status).toBe(401);
    expect((await call('GET', '/meta/settings/contract.auto_submit/audit', { token: null })).status).toBe(401);
  });

  it('the new routes are documented in /openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const doc = res.json() as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.paths['/meta/settings/{key}'] ?? {})).toEqual(expect.arrayContaining(['put', 'delete']));
    expect(doc.paths).toHaveProperty(['/meta/settings/{key}/audit']);
  });
});
