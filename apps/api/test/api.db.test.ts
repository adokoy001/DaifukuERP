import { auditTrail, bootstrapTenant, companyMemberships, hashPassword, newId, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

const JWT_SECRET = 'test-secret';

let db: TestDb;
let app: FastifyInstance;
let token: string;
let logLines: Record<string, unknown>[] = [];
let salesUserId: string;
let salesToken: string;

interface JsonResponse {
  status: number;
  body: Record<string, unknown> & { error?: { code: string; message: string; hint: string; details?: Record<string, unknown> } };
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {}): Promise<JsonResponse> {
  const t = opts.token === undefined ? token : opts.token;
  const res = await app.inject({
    method,
    url,
    headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as JsonResponse['body'] };
}

async function login(email: string, password: string): Promise<JsonResponse> {
  return call('POST', '/auth/login', { body: { email, password }, token: null });
}

beforeAll(async () => {
  db = await freshDb();
  const stream = { write: (line: string) => void logLines.push(JSON.parse(line) as Record<string, unknown>) };
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: JWT_SECRET, logger: { level: 'info', stream } });
  await app.ready();
  token = (await login('admin@example.com', 'password')).body.token as string;
  salesUserId = newId();
  await db.owner.drizzle.insert(users).values({
    id: salesUserId,
    tenantId: db.tenantId,
    email: 'sales@example.com',
    name: 'Sales',
    passwordHash: hashPassword('sales-pw'),
    roles: ['sales'],
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle.insert(companyMemberships).values({ tenantId: db.tenantId, userId: salesUserId, companyId: db.companyId, roles: ['sales'] });
  salesToken = (await login('sales@example.com', 'sales-pw')).body.token as string;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('auth (AC-1, AC-2, AC-7)', () => {
  it('AC-1 login returns a 12h JWT and the user; bad credentials -> 401 standard error body', async () => {
    const ok = await login('admin@example.com', 'password');
    expect(ok.status).toBe(200);
    expect(ok.body.user).toEqual({ id: db.adminUserId, name: 'Admin', email: 'admin@example.com', roles: ['admin'], tenantId: db.tenantId, defaultCompanyId: db.companyId, tenantAdmin: true, accessScope: 'all', storeIds: [], siteIds: [] });
    const claims = app.jwt.verify<{ sub: string; tenantId: string; iat: number; exp: number }>(ok.body.token as string);
    expect(claims.sub).toBe(db.adminUserId);
    expect(claims.tenantId).toBe(db.tenantId);
    expect(claims.exp - claims.iat).toBe(12 * 3600);
    const bad = await login('admin@example.com', 'wrong');
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatchObject({ code: 'PERMISSION_DENIED', message: expect.stringContaining('invalid'), hint: expect.stringContaining('/auth/login') });
    const malformed = await call('POST', '/auth/login', { body: { email: 'x' }, token: null });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error?.details).toMatchObject({ issues: [{ path: 'password' }] });
  });

  it('AC-2 missing/invalid/foreign tokens -> 401; roles are re-loaded per request; company from header or default', async () => {
    expect((await call('GET', '/meta', { token: null })).status).toBe(401);
    expect((await call('GET', '/meta', { token: 'not-a-jwt' })).status).toBe(401);
    const forged = app.jwt.sign({ sub: newId(), tenantId: db.tenantId, sessionVersion: 1 });
    const unknownUser = await call('GET', '/meta', { token: forged });
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.error?.code).toBe('PERMISSION_DENIED');

    const me = await call('GET', '/auth/me', { token: salesToken });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { roles: ['sales'] }, companyId: db.companyId, actor: { type: 'user', id: salesUserId }, locale: 'ja' });
    // role change takes effect without a new token
    await db.owner.sql`update user_company_memberships set roles = '["sales","viewer"]'::jsonb where user_id = ${salesUserId}`;
    const after = await call('GET', '/auth/me', { token: salesToken });
    expect((after.body.user as { roles: string[] }).roles).toEqual(['sales', 'viewer']);
    await db.owner.sql`update user_company_memberships set roles = '["sales"]'::jsonb where user_id = ${salesUserId}`;

    const otherCompany = newId();
    await db.owner.sql`insert into companies (id, tenant_id, code, name) values (${otherCompany}, ${db.tenantId}, 'T2', 'Second Co')`;
    const withHeader = await call('GET', '/auth/me', { headers: { 'x-company-id': otherCompany, 'accept-language': 'en-US,en;q=0.9' } });
    expect(withHeader.body).toMatchObject({ companyId: otherCompany, locale: 'en' });
    // the second company has its own partner scope
    const inSecond = await call('GET', '/api/partner', { headers: { 'x-company-id': otherCompany } });
    expect(inSecond.body.total).toBe(0);
    for (const bad of ['nope', newId()]) {
      const badHeader = await call('GET', '/auth/me', { headers: { 'x-company-id': bad } });
      expect(badHeader.status).toBe(bad === 'nope' ? 400 : 403);
      if (bad === 'nope') expect(badHeader.body.error?.details).toMatchObject({ issues: [{ path: 'headers.x-company-id' }] });
      else expect(badHeader.body.error?.code).toBe('PERMISSION_DENIED');
    }
  });

  it('AC-7 x-agent-id makes the actor an agent acting on behalf of the user (visible in /auth/me and the audit log)', async () => {
    const me = await call('GET', '/auth/me', { headers: { 'x-agent-id': 'claude-1' } });
    expect(me.body.actor).toEqual({ type: 'agent', id: 'claude-1', onBehalfOf: db.adminUserId });
    const created = await call('POST', '/api/partner', { body: { name: 'By agent' }, headers: { 'x-agent-id': 'claude-1' } });
    expect(created.status).toBe(200);
    expect(created.body.createdBy).toBe(db.adminUserId);
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'partner', created.body.id as string));
    expect(trail[0]).toMatchObject({ op: 'create', actorType: 'agent', actorId: 'claude-1', onBehalfOf: db.adminUserId });
  });
});

describe('meta and actions (AC-3, AC-4)', () => {
  it('AC-3 GET /meta returns appMeta for the caller; GET /meta/entities/:name returns entityMeta; unknown -> 404', async () => {
    const meta = await call('GET', '/meta');
    expect(meta.status).toBe(200);
    const entities = meta.body.entities as { name: string; ops: string[] }[];
    expect(entities.map((e) => e.name)).toContain('partner');
    expect((meta.body.actions as unknown[]).length).toBeGreaterThanOrEqual(6);
    expect(meta.body.roles).toEqual(['admin']);
    const asSales = await call('GET', '/meta', { token: salesToken });
    expect((asSales.body.entities as { ops: string[] }[])[0]?.ops).toEqual(['read', 'create', 'update']);
    const partner = await call('GET', '/meta/entities/partner');
    expect(partner.body).toMatchObject({ name: 'partner', module: 'partner', displayField: 'name', views: { search: ['name', 'nameKana', 'code'] } });
    expect((partner.body.fields as unknown[]).length).toBe(23); // the 23 fields of the spec table
    const missing = await call('GET', '/meta/entities/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('NOT_FOUND');
  });

  it('AC-4 POST /actions/:name runs the action in a context; validation/permission/unknown errors keep the standard shape', async () => {
    const created = await call('POST', '/actions/partner.create', { body: { name: 'Via action', closingDay: 20, paymentMonthOffset: 1, paymentDay: 10 } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ name: 'Via action', taxStatus: 'registered', isActive: true });
    const due = await call('POST', '/actions/partner.compute_due_date', { body: { partnerId: created.body.id, invoiceDate: '2026-09-21' } });
    expect(due.body).toEqual({ partnerId: created.body.id, invoiceDate: '2026-09-21', closingDate: '2026-10-20', dueDate: '2026-11-10' });
    const invalid = await call('POST', '/actions/partner.create', { body: { name: 'x', invoiceRegistrationNo: 'T1' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'invoiceRegistrationNo' }] } });
    const denied = await call('POST', '/actions/partner.delete', { body: { id: created.body.id }, token: salesToken });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('PERMISSION_DENIED');
    const unknown = await call('POST', '/actions/partner.nope', { body: {} });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatchObject({ code: 'NOT_FOUND', hint: expect.stringContaining('/meta') });
    const list = await call('POST', '/actions/partner.list', { body: { where: { name: 'Via action' } } });
    expect(list.body.total).toBe(1);
  });
});

describe('REST sugar (AC-5)', () => {
  let id: string;

  it('POST/GET/PATCH/DELETE map to the generic actions', async () => {
    const created = await call('POST', '/api/partner', { body: { name: 'REST 商店', code: 'R-1', nameKana: 'れすと' } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ code: 'R-1', nameKana: 'ﾚｽﾄ', version: 1 });
    id = created.body.id as string;
    const got = await call('GET', `/api/partner/${id}`);
    expect(got.body.id).toBe(id);
    const patched = await call('PATCH', `/api/partner/${id}`, { body: { isCustomer: true } });
    expect(patched.body).toMatchObject({ isCustomer: true, version: 2 });
    const wrapped = await call('PATCH', `/api/partner/${id}`, { body: { patch: { notes: 'n' }, expectedVersion: 2 } });
    expect(wrapped.body).toMatchObject({ notes: 'n', version: 3 });
    const stale = await call('PATCH', `/api/partner/${id}`, { body: { patch: { notes: 'z' }, expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('CONFLICT');
    const dup = await call('POST', '/api/partner', { body: { name: 'dup', code: 'R-1' } });
    expect(dup.status).toBe(409);
    const badId = await call('GET', '/api/partner/not-a-uuid');
    expect(badId.status).toBe(400);
    expect(badId.body.error?.details).toMatchObject({ issues: [{ path: 'id' }] });
    const missing = await call('GET', `/api/partner/${newId()}`);
    expect(missing.status).toBe(404);
    const noEntity = await call('GET', '/api/nope');
    expect(noEntity.status).toBe(404);
    expect(noEntity.body.error?.message).toContain('nope');
  });

  it('GET /api/:entity supports search, where (json), orderBy (field:dir), limit and offset', async () => {
    await call('POST', '/api/partner', { body: { name: 'Zeta', code: 'Z-1', isSupplier: true } });
    await call('POST', '/api/partner', { body: { name: 'Alpha', code: 'A-1', isSupplier: true } });
    const search = await call('GET', '/api/partner?search=REST');
    expect((search.body.items as { code: string }[]).map((i) => i.code)).toEqual(['R-1']);
    const where = await call('GET', `/api/partner?where=${encodeURIComponent(JSON.stringify({ isSupplier: true }))}&orderBy=name:asc`);
    expect((where.body.items as { code: string }[]).map((i) => i.code)).toEqual(['A-1', 'Z-1']);
    const paged = await call('GET', '/api/partner?orderBy=name:desc&limit=1&offset=1');
    expect(paged.body).toMatchObject({ limit: 1, offset: 1 });
    expect((paged.body.items as unknown[]).length).toBe(1);
    const badWhere = await call('GET', '/api/partner?where=nope');
    expect(badWhere.status).toBe(400);
    const badOrder = await call('GET', '/api/partner?orderBy=name:sideways');
    expect(badOrder.status).toBe(400);
    const badLimit = await call('GET', '/api/partner?limit=0');
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error?.details).toMatchObject({ issues: [{ path: 'limit' }] });
  });

  it('GET /api/:entity/:id/audit returns the trail (newest first) only to callers who may read the record', async () => {
    const audit = await call('GET', `/api/partner/${id}/audit`);
    expect(audit.status).toBe(200);
    expect((audit.body as unknown as { op: string }[]).map((e) => e.op)).toEqual(['update', 'update', 'create']);
    const viewerless = await call('GET', `/api/partner/${id}/audit`, { token: null });
    expect(viewerless.status).toBe(401);
    const deleted = await call('DELETE', `/api/partner/${id}`);
    expect(deleted.body).toEqual({ ok: true });
    expect((await call('GET', `/api/partner/${id}`)).status).toBe(404);
    const lifecycle = await call('POST', `/api/partner/${id}/submit`);
    expect(lifecycle.status).toBe(404); // partner is not a document: partner.submit does not exist
    const badOp = await call('POST', `/api/partner/${id}/approve`);
    expect(badOp.status).toBe(400);
  });
});

describe('OpenAPI and request log (AC-6, AC-8)', () => {
  it('AC-6 /openapi.json documents every action with its zod schemas; /docs serves Swagger UI', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { openapi: string; paths: Record<string, { post?: { requestBody: { content: Record<string, { schema: { properties: Record<string, unknown>; required?: string[] } }> }; responses: Record<string, unknown> } }> };
    expect(doc.openapi).toBe('3.1.0');
    const paths = Object.keys(doc.paths);
    for (const p of ['/auth/login', '/meta', '/actions/partner.list', '/actions/partner.create', '/actions/partner.compute_due_date', '/api/{entity}', '/api/{entity}/{id}/audit']) {
      expect(paths).toContain(p);
    }
    expect(paths).not.toContain('/actions/{name}');
    const create = doc.paths['/actions/partner.create']?.post;
    const body = create?.requestBody.content['application/json']?.schema;
    expect(body?.required).toEqual(['name']);
    expect(Object.keys(body?.properties ?? {})).toEqual(expect.arrayContaining(['name', 'nameKana', 'closingDay', 'taxStatus', 'ext']));
    expect(body?.properties.taxStatus).toMatchObject({ enum: ['registered', 'exempt'] });
    expect(create?.responses['200']).toBeDefined();
    const ui = await app.inject({ method: 'GET', url: '/docs/' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
  });

  it('AC-8 exactly one JSON log line per request with requestId, method, url, status, ms and actor', async () => {
    logLines = [];
    await call('GET', '/meta', { headers: { 'x-request-id': 'req-abc' } });
    await call('GET', '/auth/me', { headers: { 'x-agent-id': 'bot-9' } });
    await call('GET', '/meta', { token: null });
    const lines = logLines.filter((l) => l.msg === 'request');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ requestId: 'req-abc', method: 'GET', url: '/meta', status: 200, actor: { type: 'user', id: db.adminUserId } });
    expect(typeof lines[0]?.ms).toBe('number');
    expect(lines[1]).toMatchObject({ url: '/auth/me', actor: { type: 'agent', id: 'bot-9', onBehalfOf: db.adminUserId } });
    expect(lines[2]).toMatchObject({ status: 401, actor: { type: 'anonymous', id: null } });
  });
});

describe('context wiring', () => {
  it('requests run in the app (RLS) connection: a second tenant cannot see the first tenant’s partners through the API', async () => {
    const boot = await bootstrapTenant(db.owner, {
      tenantName: 'Other',
      companyCode: 'O1',
      companyName: 'Other Co',
      adminEmail: 'other@example.com',
      adminName: 'Other',
      adminPassword: 'other-pw',
    });
    const otherToken = (await login('other@example.com', 'other-pw')).body.token as string;
    const list = await call('GET', '/api/partner', { token: otherToken });
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
    expect(boot.tenantId).not.toBe(db.tenantId);
    const mine = await call('GET', '/api/partner');
    expect(mine.body.total as number).toBeGreaterThan(0);
  });
});

describe('kernel-phase15: internal actions, /auth/me company, meta contract (AC-3, AC-9, AC-11)', () => {
  const INTERNAL = ['sales.record_payment', 'purchase.record_payment'];

  it('AC-9 record_payment (internal) is absent from /meta actions, /openapi.json and POST /actions/*; other module actions stay', async () => {
    const actions = ((await call('GET', '/meta')).body.actions as { name: string }[]).map((a) => a.name);
    expect(actions).toEqual(expect.arrayContaining(['sales.ar_aging', 'purchase.ap_aging', 'sales_invoice.create']));
    for (const name of INTERNAL) expect(actions).not.toContain(name);
    const doc = (await app.inject({ method: 'GET', url: '/openapi.json' })).json() as { paths: Record<string, unknown> };
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(expect.arrayContaining(['/actions/sales.ar_aging', '/actions/purchase.ap_aging']));
    for (const name of INTERNAL) {
      expect(paths).not.toContain(`/actions/${name}`);
      // the catch-all route must not reach runAction for it either
      const res = await call('POST', `/actions/${name}`, { body: { invoiceId: newId(), amount: '1', date: '2026-09-11' } });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', hint: expect.stringContaining('internal') });
    }
  });

  it('AC-11 /auth/me includes the effective company { id, name, currency } (header or default); null without a company', async () => {
    const me = await call('GET', '/auth/me');
    expect(me.body.company).toEqual({ id: db.companyId, name: 'テスト株式会社', currency: 'JPY' });
    const usd = newId();
    await db.owner.sql`insert into companies (id, tenant_id, code, name, currency) values (${usd}, ${db.tenantId}, 'US1', 'US Branch', 'USD')`;
    const withHeader = await call('GET', '/auth/me', { headers: { 'x-company-id': usd } });
    expect(withHeader.body).toMatchObject({ companyId: usd, company: { id: usd, name: 'US Branch', currency: 'USD' } });
    expect(withHeader.body.company).not.toHaveProperty('settings');
    const lonerId = newId();
    await db.owner.drizzle.insert(users).values({ id: lonerId, tenantId: db.tenantId, email: 'nocompany@example.com', name: 'No Company', passwordHash: hashPassword('nc-pw'), roles: ['viewer'], defaultCompanyId: null });
    const lonerToken = (await login('nocompany@example.com', 'nc-pw')).body.token as string;
    const loner = await call('GET', '/auth/me', { token: lonerToken });
    expect(loner.status).toBe(200);
    expect(loner.body).toMatchObject({ companyId: null, company: null });
  });

  it('AC-11 / AC-3 /meta FieldMeta: money scale follows the company currency, quantities keep theirs; extFields is [] without registrations', async () => {
    const inv = await call('GET', '/meta/entities/sales_invoice');
    expect(inv.body.extFields).toEqual([]);
    const fieldsOf = (body: Record<string, unknown>) => new Map((body.fields as { name: string; scale?: number; money?: boolean }[]).map((x) => [x.name, x] as const));
    expect(fieldsOf(inv.body).get('total')).toMatchObject({ kind: 'decimal', money: true, scale: 0 });
    const line = fieldsOf((await call('GET', '/meta/entities/sales_invoice_line')).body);
    expect(line.get('amount')).toMatchObject({ money: true, scale: 0 });
    expect(line.get('quantity')).toMatchObject({ scale: 6 });
    expect(line.get('quantity')?.money).toBeUndefined();
    const usd = (await db.owner.sql`select id from companies where tenant_id = ${db.tenantId} and currency = 'USD' limit 1`)[0]?.id as string;
    const inUsd = await call('GET', '/meta/entities/sales_invoice', { headers: { 'x-company-id': usd } });
    expect(fieldsOf(inUsd.body).get('total')).toMatchObject({ money: true, scale: 2 });
    const appWide = (await call('GET', '/meta', { headers: { 'x-company-id': usd } })).body.entities as { name: string; fields: { name: string; scale?: number }[]; extFields: unknown[] }[];
    const invMeta = appWide.find((e) => e.name === 'sales_invoice');
    expect(invMeta?.fields.find((x) => x.name === 'balance')?.scale).toBe(2);
    expect(invMeta?.extFields).toEqual([]);
  });
});
