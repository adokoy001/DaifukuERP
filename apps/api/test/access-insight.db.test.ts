// docs/specs/access-insight.md AC-1..AC-5, AC-8, AC-10..AC-18 over HTTP with the full runtime (every module and pack
// registered by ../src/modules.ts): GET /admin/permissions matches can() for every entity, role and operation and
// canRunAction() for every action; GET /admin/audit filters by period, user (the person and an AI acting for them),
// entity, op and record id, pages with a cursor, keeps company A, company B and the tenant scope apart, refuses
// non-admins, store-limited admins and the tenant scope for a company admin, validates after the access check, shows
// the partner CSV export audit, hides outputHidden fields of an old row and the rows of an unapplied pack entity or of
// a name the runtime does not know, and answers 400 for values Postgres would refuse; store, site and relay notes
// equal can() for every entity;
// GET /admin/audit/options lists a removed member as former without e-mails. Audit rows use the real clock, so the
// period is today (Asia/Tokyo) and the six days before it.
import {
  auditLog,
  can,
  canRunAction,
  companies,
  companyMemberships,
  makeContext,
  newId,
  registry,
  todayLocal,
  type AuditSearchOptions,
  type AuditSearchResult,
  type Db,
  type PermissionMatrix,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let adminToken: string;
let companyB: string;
const password = 'access-insight-password';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const today = todayLocal(new Date(), 'Asia/Tokyo');
const weekAgo = (() => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
})();
const period = `from=${weekAgo}&to=${today}`;

function headers(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}
async function send(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  token: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: { ...headers(token, extra), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}
async function ok<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  token: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const r = await send(method, url, token, body, extra);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBe(200);
  return r.json<T>();
}
async function login(email: string, secret = password): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: secret } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ token: string }>().token;
}
async function user(key: string, companyId: string | null, roles: string[]) {
  const created = await ok<{ id: string }>('POST', '/admin/users', adminToken, {
    email: `ai-${key}@example.com`,
    name: `利用者 ${key}`,
    password,
  });
  ids[key] = created.id;
  if (companyId)
    await ok('PUT', `/admin/users/${created.id}/companies/${companyId}`, adminToken, {
      expectedVersion: 0,
      roles,
      accessScope: 'all',
      storeIds: [],
    });
  return created.id;
}
const audit = (token: string, query: string, extra: Record<string, string> = {}) =>
  send('GET', `/admin/audit?${period}${query ? `&${query}` : ''}`, token, undefined, extra);
const auditOk = async (token: string, query: string, extra: Record<string, string> = {}) => {
  const r = await audit(token, query, extra);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<AuditSearchResult>();
};

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'access-insight-test', logger: false });
  await app.ready();
  adminToken = await login('admin@example.com', 'password');
  companyB = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'AI-B', name: 'B 社' });
  await user('sales', db.companyId, ['sales']);
  await user('adminA', db.companyId, ['admin']);
  await user('adminB', companyB, ['admin']);
  await user('storeAdmin', null, []);
  // A store-limited membership cannot be assigned with the admin role through the API; the database row models a
  // legacy or hand-edited one so the refusal is still tested.
  await db.owner.drizzle.insert(companyMemberships).values({
    tenantId: db.tenantId,
    userId: ids.storeAdmin as string,
    companyId: db.companyId,
    roles: ['admin'],
    accessScope: 'stores',
    storeIds: [newId()],
  });
  for (const key of ['sales', 'adminA', 'adminB', 'storeAdmin']) tokens[key] = await login(`ai-${key}@example.com`);
  // Business activity in company A: the sales user creates and updates a partner, an AI agent creates one for the
  // tenant administrator, and the administrator exports partners to CSV.
  const partner = await ok<{ id: string; version: number }>('POST', '/api/partner', tokens.sales as string, {
    code: 'AI-P1',
    name: '監査テスト商事',
    isCustomer: true,
  });
  ids.partner = partner.id;
  await ok('PATCH', `/api/partner/${partner.id}`, tokens.sales as string, {
    patch: { name: '監査テスト商事（改）' },
    expectedVersion: partner.version,
  });
  await ok(
    'POST',
    '/api/partner',
    adminToken,
    { code: 'AI-P2', name: 'AI 代理の取引先' },
    { 'x-agent-id': 'claude-agent' },
  );
  await ok('POST', '/actions/partner.export_rows', adminToken, {
    columns: ['code', 'name'],
    where: { isCustomer: true },
  });
  // Company B has its own row.
  await ok(
    'POST',
    '/api/partner',
    tokens.adminB as string,
    { code: 'AI-B1', name: 'B 社の取引先' },
    { 'x-company-id': companyB },
  );
}, 180_000);
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('GET /admin/permissions (access-insight AC-1..AC-5)', () => {
  it('AC-1/AC-2: every registry entity once; every cell equals can() for that role alone', async () => {
    const m = await ok<PermissionMatrix>('GET', '/admin/permissions', adminToken);
    expect(m.entities.map((e) => e.name).sort()).toEqual(
      registry
        .allEntities()
        .map((e) => e.name)
        .sort(),
    );
    expect(m.roles[0]?.name).toBe('admin');
    let compared = 0;
    for (const e of m.entities) {
      const def = registry.entity(e.name);
      for (const role of m.roles.map((r) => r.name).filter((r) => r !== 'admin'))
        for (const op of e.ops) {
          const allowed = can({ roles: [role], accessScope: 'all', appliedPacks: e.pack ? [e.pack] : [] }, def, op);
          if ((e.grants[role]?.includes(op) ?? false) !== allowed) throw new Error(`${e.name} ${role} ${op}`);
          compared += 1;
        }
    }
    expect(compared).toBeGreaterThan(5_000);
    const payment = m.entities.find((e) => e.name === 'payment');
    expect(payment?.rowRules.find((r) => r.roles.includes('sales'))?.summary).toEqual({
      ja: '区分 = 入金',
      en: 'Direction = Receipt',
    });
    expect(m.kernel.find((c) => c.id === 'company_settings')?.roles).toEqual(['admin', 'settings']);
  });

  it('AC-3(c)/(d): store, site and site-device notes equal can() with that scope or a relay actor, for every entity', async () => {
    const m = await ok<PermissionMatrix>('GET', '/admin/permissions', adminToken);
    const mismatches: string[] = [];
    let compared = 0;
    for (const e of m.entities) {
      const def = registry.entity(e.name);
      const appliedPacks = e.pack ? [e.pack] : [];
      const cases = (['stores', 'sites'] as const).flatMap((scope) =>
        m.roles.flatMap((r) => e.ops.map((op) => ({ scope, role: r.name, op }))),
      );
      for (const { scope, role, op } of cases) {
        const note = scope === 'stores' ? e.stores : e.sites;
        const allowed = can({ roles: [role], accessScope: scope, appliedPacks }, def, op);
        if ((note.effective[role]?.includes(op) ?? false) !== allowed)
          mismatches.push(`${e.name} ${scope} ${role} ${op}`);
      }
      compared += cases.length;
      const relayActor = {
        roles: ['relay'],
        accessScope: 'all' as const,
        appliedPacks,
        actor: { type: 'relay' as const, id: 'gw' },
      };
      for (const op of e.ops)
        if ((e.relay?.effective.includes(op) ?? false) !== can(relayActor, def, op))
          mismatches.push(`${e.name} relay ${op}`);
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(10_000);
    expect(m.entities.some((e) => e.relay && e.relay.effective.length > 0)).toBe(true);
    expect(m.entities.some((e) => e.stores.policy?.kind === 'parent' || e.sites.policy?.kind === 'parent')).toBe(true);
  });

  it('AC-4: every exposed non-generic action and role equals canRunAction() with every pack applied', async () => {
    const m = await ok<PermissionMatrix>('GET', '/admin/permissions', adminToken);
    const packs = registry.packs().map((p) => p.name);
    expect(m.actions.length).toBeGreaterThan(20);
    for (const a of m.actions) {
      const def = registry.action(a.name);
      expect(def.generic || def.internal, a.name).toBe(false);
      for (const role of m.roles.map((r) => r.name)) {
        const ctx = makeContext({} as unknown as Db, {
          tenantId: db.tenantId,
          companyId: db.companyId,
          actor: { type: 'user', id: newId() },
          roles: [role],
          accessScope: 'all',
          appliedPacks: packs,
        });
        if (a.runnable.includes(role) !== canRunAction(ctx, def)) throw new Error(`${a.name} ${role}`);
      }
    }
  });

  it('AC-5: sales, a store-limited admin and a company it does not belong to are refused; an agent for an admin is allowed', async () => {
    expect((await send('GET', '/admin/permissions', tokens.sales as string)).statusCode).toBe(403);
    expect((await send('GET', '/admin/permissions', tokens.storeAdmin as string)).statusCode).toBe(403);
    expect(
      (await send('GET', '/admin/permissions', tokens.adminB as string, undefined, { 'x-company-id': db.companyId }))
        .statusCode,
    ).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/permissions' })).statusCode).toBe(401);
    expect(
      (await send('GET', '/admin/permissions', adminToken, undefined, { 'x-agent-id': 'claude-agent' })).statusCode,
    ).toBe(200);
    expect((await send('GET', '/admin/permissions', tokens.adminA as string)).statusCode).toBe(200);
  });
});

describe('GET /admin/audit (access-insight AC-8..AC-15)', () => {
  it('AC-8: the user filter finds the person, and the person an AI agent acted for, with names', async () => {
    const sales = await auditOk(adminToken, `userId=${ids.sales}`);
    expect(sales.items.map((i) => [i.entity, i.op]).sort()).toEqual([
      ['partner', 'create'],
      ['partner', 'update'],
    ]);
    expect(sales.items.every((i) => i.actorName === '利用者 sales')).toBe(true);
    const viaAgent = await auditOk(adminToken, `userId=${db.adminUserId}&entity=partner&op=create`);
    expect(viaAgent.items).toHaveLength(1);
    expect(viaAgent.items[0]).toMatchObject({
      actorType: 'agent',
      actorId: 'claude-agent',
      onBehalfOf: db.adminUserId,
    });
    expect(viaAgent.items[0]?.onBehalfOfName).toBeTruthy();
  });

  it('AC-14: the partner CSV export audit is shown with op=export (rows, columns, criteria)', async () => {
    const { items } = await auditOk(adminToken, 'entity=partner&op=export');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: 'partner.export_rows', op: 'export', actorId: db.adminUserId });
    expect((items[0]?.after as { export: unknown }).export).toMatchObject({
      columns: ['code', 'name'],
      where: { isCustomer: true },
      rows: 1,
      total: 1,
      truncated: false,
    });
  });

  it('AC-8/AC-9: record id with entity, limit and the cursor through every page', async () => {
    const one = await auditOk(adminToken, `entity=partner&recordId=${ids.partner}`);
    expect(one.items.map((i) => i.op)).toEqual(['update', 'create']);
    const all = (await auditOk(adminToken, 'limit=100')).items.map((i) => i.id);
    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page: AuditSearchResult = await auditOk(adminToken, `limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.items.length).toBeLessThanOrEqual(2);
      paged.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(paged).toEqual(all);
    expect(all.length).toBeGreaterThan(4);
  });

  it('AC-12: company admins of A and B see only their own company; B cannot select A', async () => {
    const a = await auditOk(tokens.adminA as string, 'entity=partner');
    expect(a.items.some((i) => (i.after as { code?: string } | null)?.code === 'AI-B1')).toBe(false);
    expect(a.items.length).toBeGreaterThan(0);
    const b = await auditOk(tokens.adminB as string, 'entity=partner', { 'x-company-id': companyB });
    expect(b.items.map((i) => (i.after as { code?: string }).code)).toEqual(['AI-B1']);
    expect((await audit(tokens.adminB as string, '', { 'x-company-id': db.companyId })).statusCode).toBe(403);
    // The record id of company A's partner finds nothing from company B.
    expect(
      (await auditOk(tokens.adminB as string, `entity=partner&recordId=${ids.partner}`, { 'x-company-id': companyB }))
        .items,
    ).toEqual([]);
  });

  it('AC-10/AC-11: scope=tenant gives the tenant administrator the user administration rows; a company admin gets 403', async () => {
    const tenant = await auditOk(adminToken, 'scope=tenant&entity=access_user&op=create');
    expect(tenant.items.map((i) => i.recordId)).toEqual(expect.arrayContaining([ids.sales, ids.adminA]));
    expect(tenant.items.every((i) => i.entity === 'access_user')).toBe(true);
    expect((await auditOk(adminToken, 'entity=access_user')).items).toEqual([]);
    expect((await audit(tokens.adminA as string, 'scope=tenant')).statusCode).toBe(403);
  });

  it('AC-11/AC-15: non-admins and store-limited admins get 403 even for a malformed query; admins get 400 per field', async () => {
    for (const token of [tokens.sales as string, tokens.storeAdmin as string]) {
      expect((await audit(token, '')).statusCode).toBe(403);
      expect((await send('GET', '/admin/audit?from=bad&limit=0', token)).statusCode).toBe(403);
      expect((await send('GET', '/admin/audit/options', token)).statusCode).toBe(403);
    }
    const bad = await send('GET', '/admin/audit?from=2026-02-30&to=2026-03-01&limit=0&recordId=x&nope=1', adminToken);
    expect(bad.statusCode).toBe(400);
    const paths = bad
      .json<{ error: { details: { issues: { path: string }[] } } }>()
      .error.details.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['from', 'limit', 'recordId']));
    expect((await send('GET', '/admin/audit?from=2024-01-01&to=2025-01-01', adminToken)).statusCode).toBe(400);
    expect((await send('GET', '/admin/audit?from=2024-01-01&to=2024-12-31', adminToken)).statusCode).toBe(200);
    // Values Postgres would refuse are 400 before any query: a period starting in year 0001 (its +09:00 start is in
    // year 0) and forged cursors with a rolled-over day or year 0.
    const cursorAt = (at: string) => Buffer.from(JSON.stringify([at, newId()])).toString('base64url');
    for (const url of [
      '/admin/audit?from=0001-01-01&to=0001-01-02',
      `/admin/audit?${period}&cursor=${cursorAt('2026-02-30T00:00:00.000000Z')}`,
      `/admin/audit?${period}&cursor=${cursorAt('0000-01-01T00:00:00.000000Z')}`,
    ]) {
      const r = await send('GET', url, adminToken);
      expect(r.statusCode, `${url}: ${r.body}`).toBe(400);
    }
    expect((await send('GET', '/admin/audit?from=9999-12-31&to=9999-12-31', adminToken)).statusCode).toBe(200);
  });

  it('AC-13: an old row of a runtime entity keeps no outputHidden field (workforce receipt storageKey)', async () => {
    await db.owner.drizzle.insert(auditLog).values({
      id: newId(),
      tenantId: db.tenantId,
      companyId: db.companyId,
      entity: 'workforce_receipt',
      recordId: newId(),
      op: 'create',
      actorType: 'user',
      actorId: db.adminUserId,
      at: new Date(),
      before: null,
      after: { filename: 'receipt.pdf', storageKey: 'leaked-storage-key', size: 10 },
    });
    const r = await audit(adminToken, 'entity=workforce_receipt');
    expect(r.statusCode).toBe(200);
    expect(r.json<AuditSearchResult>().items[0]?.after).toEqual({ filename: 'receipt.pdf', size: 10 });
    expect(r.body).not.toContain('leaked-storage-key');
  });

  it('AC-13: rows of an unapplied pack entity are left out, and filtering on that entity is refused', async () => {
    const pack = registry.packs().find((p) => (p.entities ?? []).length > 0);
    const entity = pack?.entities?.[0]?.name;
    expect(entity, 'a loaded pack with an entity').toBeDefined();
    await db.owner.drizzle.insert(auditLog).values({
      id: newId(),
      tenantId: db.tenantId,
      companyId: db.companyId,
      entity: entity as string,
      recordId: newId(),
      op: 'create',
      actorType: 'user',
      actorId: db.adminUserId,
      at: new Date(),
      after: { marker: 'unapplied-pack-row' },
    });
    const r = await audit(adminToken, 'limit=100');
    expect(r.body).not.toContain('unapplied-pack-row');
    expect((await audit(adminToken, `entity=${entity}`)).statusCode).toBe(403);
  });

  it('AC-13: rows of a name this runtime does not know (a pack switched off with DAIFUKU_PACKS) are never returned', async () => {
    expect(registry.hasEntity('switched_off_pack_item')).toBe(false);
    await db.owner.drizzle.insert(auditLog).values({
      id: newId(),
      tenantId: db.tenantId,
      companyId: db.companyId,
      entity: 'switched_off_pack_item',
      recordId: newId(),
      op: 'create',
      actorType: 'user',
      actorId: db.adminUserId,
      at: new Date(),
      after: { storageKey: 'switched-off-pack-secret' },
    });
    expect((await audit(adminToken, 'limit=100')).body).not.toContain('switched-off-pack-secret');
    expect((await audit(adminToken, 'limit=100&op=create')).body).not.toContain('switched-off-pack-secret');
    expect((await audit(adminToken, 'entity=switched_off_pack_item')).statusCode).toBe(403);
    // Kernel audit subjects stay visible.
    expect((await auditOk(adminToken, 'entity=company_membership')).items.length).toBeGreaterThan(0);
  });
});

describe('GET /admin/audit/options and read-only use (access-insight AC-16..AC-18)', () => {
  it('AC-17: company options carry no e-mail; a removed member is listed as former and still searchable', async () => {
    await ok('DELETE', `/admin/users/${ids.sales}/companies/${db.companyId}`, adminToken, { expectedVersion: 1 });
    const options = await ok<AuditSearchOptions>('GET', '/admin/audit/options', adminToken);
    expect(options.users.find((u) => u.id === ids.sales)).toEqual({
      id: ids.sales,
      name: '利用者 sales',
      active: true,
      kind: 'former',
    });
    expect(options.users.find((u) => u.id === ids.adminA)?.kind).toBe('member');
    expect(options.users.find((u) => u.id === ids.adminB)).toBeUndefined();
    expect(JSON.stringify(options.users)).not.toContain('@example.com');
    expect(options.subjects.map((s) => s.name)).toEqual(expect.arrayContaining(['partner', 'company_membership']));
    expect(options.ops.map((o) => o.name)).toEqual(expect.arrayContaining(['export', 'supersede', 'paired']));
    expect((await auditOk(adminToken, `userId=${ids.sales}`)).items).toHaveLength(2);
    const tenant = await ok<AuditSearchOptions>('GET', '/admin/audit/options?scope=tenant', adminToken);
    expect(tenant.users.find((u) => u.id === ids.sales)?.email).toBe('ai-sales@example.com');
    expect((await send('GET', '/admin/audit/options?scope=tenant', tokens.adminA as string)).statusCode).toBe(403);
  });

  it('AC-16: searching writes nothing to the audit log', async () => {
    const count = async () => Number((await db.owner.sql`select count(*)::int as n from audit_log`)[0]?.n);
    const before = await count();
    await auditOk(adminToken, 'limit=100');
    await ok('GET', '/admin/audit/options', adminToken);
    await ok('GET', '/admin/permissions', adminToken);
    expect(await count()).toBe(before);
  });

  it('AC-18: the three audit search indexes exist', async () => {
    const rows = await db.owner.sql`select indexname from pg_indexes where tablename = 'audit_log' order by 1`;
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining(['audit_log_company_at_idx', 'audit_log_actor_at_idx', 'audit_log_on_behalf_at_idx']),
    );
    expect(rows.map((r) => r.indexname)).toEqual(expect.arrayContaining(['audit_log_at_idx', 'audit_log_record_idx']));
  });
});
