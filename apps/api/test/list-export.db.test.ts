// docs/specs/list-workbench.md AC-7..AC-9 over HTTP: the list's CSV rows come from the derived `<entity>.export_rows`
// action through the existing fresh-authorization route POST /actions/:name/export.
import { auditLog, companyMemberships, hashPassword, newId, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let adminToken: string;
let salesToken: string;

async function call(method: 'GET' | 'POST', url: string, token: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  return (res.json() as { token: string }).token;
}

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'test-secret', logger: false });
  await app.ready();
  adminToken = await login('admin@example.com', 'password');
  const salesUserId = newId();
  await db.owner.drizzle.insert(users).values({
    id: salesUserId,
    tenantId: db.tenantId,
    email: 'sales-export@example.com',
    name: 'Sales',
    passwordHash: await hashPassword('sales-pw'),
    roles: ['sales'],
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, userId: salesUserId, companyId: db.companyId, roles: ['sales'] });
  salesToken = await login('sales-export@example.com', 'sales-pw');
  for (const [code, name] of [
    ['LX-1', 'リスト出力 一'],
    ['LX-2', '=HYPERLINK("http://example.invalid")'],
    ['LX-3', 'リスト出力 三'],
  ])
    expect((await call('POST', '/api/partner', adminToken, { code, name, isCustomer: code !== 'LX-3' })).status).toBe(
      200,
    );
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('list-workbench AC-7..AC-9: POST /actions/<entity>.export_rows/export', () => {
  it('AC-8: a role without the export operation gets 403 and no export_rows action in /meta', async () => {
    const denied = await call('POST', '/actions/partner.export_rows/export', salesToken, {});
    expect(denied.status).toBe(403);
    expect((denied.body.error as { code: string }).code).toBe('PERMISSION_DENIED');
    const meta = await call('GET', '/meta', salesToken);
    const actions = meta.body.actions as { name: string }[];
    expect(actions.some((a) => a.name === 'partner.list')).toBe(true);
    expect(actions.some((a) => a.name === 'partner.export_rows')).toBe(false);
    const adminMeta = await call('GET', '/meta', adminToken);
    const exportAction = (adminMeta.body.actions as { name: string; canExport: boolean; generic: boolean }[]).find(
      (a) => a.name === 'partner.export_rows',
    );
    expect(exportAction).toMatchObject({ canExport: true, generic: true, mutates: false, resultKind: 'table' });
  });

  it('AC-7: the current criteria, order and columns come back as a TableResult with raw cell text', async () => {
    const res = await call('POST', '/actions/partner.export_rows/export', adminToken, {
      where: { code: { $in: ['LX-1', 'LX-2', 'LX-3'] }, isCustomer: true },
      orderBy: [{ field: 'code', dir: 'desc' }],
      columns: ['code', 'name', 'isCustomer'],
    });
    expect(res.status).toBe(200);
    expect((res.body.columns as { key: string }[]).map((c) => c.key)).toEqual(['code', 'name', 'isCustomer']);
    expect(res.body.rows).toEqual([
      { code: 'LX-2', name: '=HYPERLINK("http://example.invalid")', isCustomer: true },
      { code: 'LX-1', name: 'リスト出力 一', isCustomer: true },
    ]);
    expect(res.body.meta).toMatchObject({ entity: 'partner', total: 2, rowCount: 2, truncated: false });
  });

  it('AC-9: the export is audited with the entity, criteria and row count', async () => {
    const where = { code: 'LX-3' };
    expect((await call('POST', '/actions/partner.export_rows/export', adminToken, { where })).status).toBe(200);
    const rows = await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'partner.export_rows'), eq(auditLog.op, 'export')));
    const entry = rows.find((r) => JSON.stringify(r.after).includes('"where":{"code":"LX-3"}'));
    expect(entry).toMatchObject({ entity: 'partner', tenantId: db.tenantId, companyId: db.companyId });
    expect((entry?.after as { export: Record<string, unknown> }).export).toMatchObject({ where, rows: 1, total: 1 });
  });
});
