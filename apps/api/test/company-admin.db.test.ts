// docs/specs/company-admin.md AC-1..AC-8 over HTTP with the full runtime (every module and pack registered by
// ../src/modules.ts): the new company receives the same module seeds as setup and db:reset, the picker lists it,
// company.profile is the first card of the company tab, and invoices print it when sales.issuer is unset.
import { auditLog, companyMemberships, COMPANY_PROFILE_KEY } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let adminToken: string;
let plainToken: string;
let created: { id: string; code: string; seededModules: string[] };
const password = 'company-admin-password';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(method: Method, url: string, payload?: unknown, token = adminToken, companyId?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (companyId) headers['x-company-id'] = companyId;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  return app.inject({
    method,
    url,
    headers,
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
}
async function total(entity: string, companyId: string): Promise<number> {
  const r = await call('GET', `/api/${entity}?limit=1`, undefined, adminToken, companyId);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ total: number }>().total;
}
async function login(email: string, secret: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: secret } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ token: string }>().token;
}

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'company-admin-test', logger: false });
  await app.ready();
  adminToken = await login('admin@example.com', 'password');
  // A company administrator (admin role in the company) who is not a tenant administrator.
  const user = await call('POST', '/admin/users', {
    email: 'company-only-admin@example.com',
    name: 'Company admin',
    password,
  });
  expect(user.statusCode, user.body).toBe(200);
  const assign = await call('PUT', `/admin/users/${user.json<{ id: string }>().id}/companies/${db.companyId}`, {
    expectedVersion: 0,
    roles: ['admin'],
    accessScope: 'all',
    storeIds: [],
  });
  expect(assign.statusCode, assign.body).toBe(200);
  plainToken = await login('company-only-admin@example.com', password);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('company-admin AC-1/AC-5: POST and GET /admin/companies', () => {
  it('AC-1: creates the company with every module seed (accounts, tax rates, fiscal year) and the admin membership', async () => {
    const r = await call('POST', '/admin/companies', { code: 'SECOND', name: '第二株式会社' });
    expect(r.statusCode, r.body).toBe(200);
    created = r.json();
    expect(created).toMatchObject({ code: 'SECOND', name: '第二株式会社', country: 'JP', currency: 'JPY' });
    expect(created.seededModules).toEqual(modules.filter((m) => m.seed).map((m) => m.name));
    expect(created.seededModules).toEqual(expect.arrayContaining(['tax', 'accounting', 'inventory', 'l10n_jp']));
    // The same seed path as setup / db:reset: the new company gets the chart of accounts, tax rates, a fiscal year
    // and the main warehouse; the bootstrap company (no seeds in this test) has none of them.
    expect(await total('account', created.id)).toBeGreaterThan(20);
    expect(await total('tax_rate', created.id)).toBeGreaterThan(0);
    expect(await total('fiscal_year', created.id)).toBe(1);
    expect(await total('warehouse', created.id)).toBeGreaterThan(0);
    expect(await total('account', db.companyId)).toBe(0);
    const [membership] = await db.owner.drizzle
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, created.id), eq(companyMemberships.userId, db.adminUserId)));
    expect(membership?.roles).toEqual(['admin']);
    const audit = await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.recordId, created.id), eq(auditLog.entity, 'company')));
    expect(audit.map((a) => [a.op, a.actorType, a.actorId])).toEqual([['create', 'user', db.adminUserId]]);
  });

  it('AC-5/AC-9: the list shows every company with membership, and the company picker offers the new one', async () => {
    const r = await call('GET', '/admin/companies');
    expect(r.statusCode, r.body).toBe(200);
    const items = r.json<{ items: { id: string; code: string; member: boolean; createdAt: string }[] }>().items;
    expect(items.map((c) => c.code)).toEqual(['SECOND', 'T1']);
    expect(items.every((c) => c.member && typeof c.createdAt === 'string')).toBe(true);
    const picker = await call('GET', '/auth/companies');
    expect(picker.json<{ items: { id: string }[] }>().items.map((c) => c.id)).toContain(created.id);
    const me = await call('GET', '/auth/me', undefined, adminToken, created.id);
    expect(me.json()).toMatchObject({ companyId: created.id, company: { name: '第二株式会社' } });
  });

  it('AC-3: a duplicate or malformed code is a 400 validation error', async () => {
    for (const body of [{ code: 'SECOND', name: 'dup' }, { code: 'bad code', name: 'x' }, { name: 'no code' }]) {
      const r = await call('POST', '/admin/companies', body);
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }
  });
});

describe('company-admin AC-4: PATCH /admin/companies/:id', () => {
  it('AC-4: renames and changes the country; code and currency stay immutable', async () => {
    const r = await call('PATCH', `/admin/companies/${created.id}`, { name: '第二商事株式会社', country: 'JP' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ name: '第二商事株式会社', code: 'SECOND' });
    const fixed = await call('PATCH', `/admin/companies/${created.id}`, { code: 'THIRD' });
    expect(fixed.statusCode).toBe(400);
    expect(fixed.json()).toMatchObject({ error: { code: 'VALIDATION', details: { issues: [{ path: 'code' }] } } });
    const missing = await call('PATCH', `/admin/companies/${db.tenantId}`, { name: 'x' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('company-admin AC-2: only tenant administrators', () => {
  it('AC-2: a company admin who is not a tenant administrator gets 403 for list, create and update', async () => {
    expect((await call('GET', '/admin/companies', undefined, plainToken)).statusCode).toBe(403);
    expect((await call('POST', '/admin/companies', { code: 'NOPE', name: 'x' }, plainToken)).statusCode).toBe(403);
    expect((await call('PATCH', `/admin/companies/${created.id}`, { name: 'x' }, plainToken)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/companies' })).statusCode).toBe(401);
  });
});

describe('company-admin AC-6/AC-8: company.profile in the settings console', () => {
  it('AC-8: company.profile is the first setting of the company tab with labels for every field', async () => {
    const r = await call('GET', '/meta/settings', undefined, adminToken, created.id);
    expect(r.statusCode, r.body).toBe(200);
    const list = r.json<{ key: string; category: string; order?: number; fields?: Record<string, unknown> }[]>();
    const company = list.filter((s) => s.category === 'company');
    expect(company.map((s) => s.key)[0]).toBe(COMPANY_PROFILE_KEY);
    expect(Object.keys(company[0]?.fields ?? {})).toHaveLength(9);
  });

  it('AC-6: PUT validates the registration number', async () => {
    const bad = await call(
      'PUT',
      `/meta/settings/${COMPANY_PROFILE_KEY}`,
      { value: { invoiceRegistrationNo: 'T12' } },
      adminToken,
      created.id,
    );
    expect(bad.statusCode).toBe(400);
  });
});

describe('company-admin AC-7: invoice issuer from company.profile', () => {
  async function renderDraft(companyId: string): Promise<string> {
    const partners = await call('GET', '/api/partner?limit=10', undefined, adminToken, companyId);
    const partner = partners.json<{ items: { id: string; isCustomer: boolean }[] }>().items.find((p) => p.isCustomer);
    expect(partner).toBeDefined();
    const inv = await call(
      'POST',
      '/actions/sales_invoice.create',
      {
        partnerId: partner?.id,
        date: '2026-10-30',
        lines: { sales_invoice_line: [{ description: '発行者確認', unitPrice: '1000', taxCategory: 'standard' }] },
      },
      adminToken,
      companyId,
    );
    expect(inv.statusCode, inv.body).toBe(200);
    const html = await call(
      'POST',
      '/actions/sales.render_invoice_html',
      { id: inv.json<{ id: string }>().id },
      adminToken,
      companyId,
    );
    expect(html.statusCode, html.body).toBe(200);
    return html.json<{ html: string }>().html;
  }

  it('AC-7: with sales.issuer unset the invoice prints the profile; a set sales.issuer wins', async () => {
    const before = await renderDraft(created.id);
    expect(before).toContain('第二商事株式会社'); // company name when the profile has no legal name
    const profile = {
      legalName: '株式会社第二商事',
      invoiceRegistrationNo: 'T1111111111111',
      postalCode: '100-0005',
      address: '東京都千代田区丸の内1-1',
      phone: '03-1111-2222',
      email: 'billing@example.com',
    };
    const put = await call('PUT', `/meta/settings/${COMPANY_PROFILE_KEY}`, { value: profile }, adminToken, created.id);
    expect(put.statusCode, put.body).toBe(200);
    const fromProfile = await renderDraft(created.id);
    for (const text of Object.values(profile)) expect(fromProfile).toContain(text);
    const issuer = await call(
      'PUT',
      '/meta/settings/sales.issuer',
      { value: { name: '請求専用名義株式会社', invoiceRegistrationNo: 'T2222222222222' } },
      adminToken,
      created.id,
    );
    expect(issuer.statusCode, issuer.body).toBe(200);
    const fromIssuer = await renderDraft(created.id);
    expect(fromIssuer).toContain('請求専用名義株式会社');
    expect(fromIssuer).toContain('T2222222222222');
    expect(fromIssuer).not.toContain('T1111111111111');
  });
});
