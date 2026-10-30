// docs/specs/list-workbench.md AC-7..AC-9 over HTTP: the list's CSV rows come from the derived `<entity>.export_rows`
// action through the existing fresh-authorization route POST /actions/:name/export.
import {
  auditLog,
  companyMemberships,
  defineAction,
  hashPassword,
  label,
  newId,
  registry,
  repo,
  runAction,
  tableResult,
  users,
  withContext,
  type ContextParams,
  type TableResult,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildServer } from '../src/server.ts';

// A test-only report that answers with the isolation level of the request transaction it runs in, so the route wiring
// of POST /actions/:name/export (repeatable read) and POST /actions/:name (unchanged) is measured, not assumed.
defineAction({
  name: 'list_export_probe.isolation',
  description: label('試験用: 要求トランザクションの分離レベル', 'Test: isolation level of the request transaction'),
  input: z.object({}),
  output: tableResult,
  permission: 'authenticated',
  exportEntities: ['partner'],
  tx: 'none',
  handler: async (ctx) => {
    const shown = JSON.stringify(await ctx.db.execute(sql`SHOW transaction_isolation`));
    const level = ['repeatable read', 'read committed', 'serializable'].find((l) => shown.includes(l)) ?? shown;
    return {
      title: label('分離レベル', 'Isolation level'),
      columns: [{ key: 'level', label: label('分離レベル', 'Isolation level'), kind: 'text' as const }],
      rows: [{ level }],
    };
  },
});

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

  it('AC-7: POST /actions/:name/export runs in repeatable read; POST /actions/:name stays read committed', async () => {
    const exported = await call('POST', '/actions/list_export_probe.isolation/export', adminToken, {});
    expect(exported.status).toBe(200);
    expect(exported.body.rows).toEqual([{ level: 'repeatable read' }]);
    const plain = await call('POST', '/actions/list_export_probe.isolation', adminToken, {});
    expect(plain.status).toBe(200);
    expect(plain.body.rows).toEqual([{ level: 'read committed' }]);
  });

  it('AC-7: the export runs in one repeatable-read snapshot that can still write its audit row', async () => {
    // POST /actions/:name/export opens its request transaction with { snapshot: true } (routes/actions.ts).
    const params: ContextParams = {
      tenantId: db.tenantId,
      companyId: db.companyId,
      actor: { type: 'user', id: db.adminUserId },
      roles: ['admin'],
    };
    const partner = registry.entity('partner');
    const where = { code: 'LX-SNAP' };
    await withContext(
      db.app,
      params,
      async (ctx) => {
        const level = await ctx.db.execute(sql`SHOW transaction_isolation`);
        expect(JSON.stringify(level)).toContain('repeatable read');
        expect(await repo(ctx, partner).count(where)).toBe(0);
        await db.run({}, (writer) => repo(writer, partner).create({ code: 'LX-SNAP', name: 'スナップショット中' }));
        const result = (await runAction(ctx, 'partner.export_rows', { where })) as TableResult;
        expect(result.rows).toEqual([]);
        expect(result.meta).toMatchObject({ total: 0 });
      },
      { snapshot: true },
    );
    expect(await db.run({}, (ctx) => repo(ctx, partner).count(where))).toBe(1);
    const audited = await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'partner.export_rows'), eq(auditLog.op, 'export')));
    expect(audited.some((r) => JSON.stringify(r.after).includes('"where":{"code":"LX-SNAP"}'))).toBe(true);
  });
});
