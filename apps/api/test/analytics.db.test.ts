import {
  bootstrapTenant,
  companyMemberships,
  hashPassword,
  newId,
  registry,
  repo,
  runAction,
  users,
  withContext,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { seedWorkforce, WorkforceSite } from '@daifuku/mod-workforce';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';
import type { AnalyticsSnapshot } from '../src/analytics/snapshot.ts';

let db: TestDb,
  app: FastifyInstance,
  admin: string,
  employee: string,
  manager: string,
  managerId: string,
  siteId: string,
  otherSiteId: string;
const from = '2026-09-01',
  to = '2026-09-30';
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const snapshot = (token: string, dataset = 'workforce_expense', state = 'all', extra: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/analytics/snapshot',
    headers: { ...headers(token), ...extra },
    payload: { dataset, from, to, state },
  });
async function login(email: string, password = 'password'): Promise<string> {
  const result = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(result.statusCode).toBe(200);
  return (result.json() as { token: string }).token;
}

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'analytics-test-secret' });
  await app.ready();
  admin = await login('admin@example.com');
  await db.run({}, async (ctx) => {
    await seedWorkforce(ctx);
    siteId = (await repo(ctx, WorkforceSite).create({ code: 'AN-A', name: '分析 第一拠点' })).id;
    otherSiteId = (await repo(ctx, WorkforceSite).create({ code: 'AN-B', name: '分析 第二拠点' })).id;
  });
  for (let index = 0; index < 4; index++) {
    const id = newId(),
      role = index === 3 ? 'workforce_manager' : 'workforce_employee',
      site = index === 2 ? otherSiteId : siteId;
    const email = `analytics-${index}@example.com`;
    await db.owner.drizzle.insert(users).values({
      id,
      tenantId: db.tenantId,
      email,
      name: `Analytics ${index}`,
      passwordHash: await hashPassword('password'),
      roles: [role],
      defaultCompanyId: db.companyId,
    });
    await db.owner.drizzle.insert(companyMemberships).values({
      tenantId: db.tenantId,
      companyId: db.companyId,
      userId: id,
      roles: [role],
      accessScope: 'sites',
      siteIds: [site],
    });
    await db.run({}, (ctx) =>
      runAction(ctx, 'workforce.register_employee', {
        userId: id,
        siteId: site,
        code: `AN-${index}`,
        name: '同姓同名',
        hiredOn: '2026-01-01',
      }),
    );
    const params: Partial<ContextParams> = {
      actor: { type: 'user', id },
      roles: [role],
      accessScope: 'sites',
      siteIds: [site],
      now: () => new Date('2026-09-13T00:00:00Z'),
    };
    if (index < 3)
      await db.run(params, (ctx) =>
        runAction(ctx, 'workforce.save_expense', {
          expectedVersion: 0,
          idempotencyKey: newId(),
          expenseDate: '2026-09-10',
          category: '交通費',
          description: '非公開の詳細',
          amount: String((index + 1) * 1000),
          evidence: '非公開の証憑参照',
        }),
      );
    if (index === 0) employee = await login(email);
    if (index === 3) {
      manager = await login(email);
      managerId = id;
    }
  }
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('authorized browser analytics HTTP', () => {
  it('requires authentication and excludes arbitrary or unauthorized datasets and query input', async () => {
    expect((await app.inject({ method: 'GET', url: '/analytics/catalog' })).statusCode).toBe(401);
    const catalog = await app.inject({ method: 'GET', url: '/analytics/catalog', headers: headers(employee) });
    expect(catalog.headers['cache-control']).toContain('no-store');
    expect((catalog.json() as { datasets: { id: string }[] }).datasets.map((row) => row.id)).not.toContain(
      'bank_statement',
    );
    expect((await snapshot(employee, 'bank_statement')).statusCode).toBe(403);
    expect((await snapshot(admin, 'users')).statusCode).toBe(403);
    expect((await snapshot(admin, 'workforce_expense', 'invented')).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/analytics/snapshot',
          headers: headers(admin),
          payload: { dataset: 'workforce_expense', from, to, state: 'all', where: {} },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('keeps employee self scope, site scope and field projection with distinct reference identities', async () => {
    const own = await snapshot(employee),
      site = await snapshot(manager),
      all = await snapshot(admin);
    expect(own.statusCode).toBe(200);
    expect(site.statusCode).toBe(200);
    expect(all.statusCode).toBe(200);
    const selfRows = own.json<AnalyticsSnapshot>(),
      siteRows = site.json<AnalyticsSnapshot>(),
      allRows = all.json<AnalyticsSnapshot>();
    expect(selfRows.rows.map((row) => row.amount)).toEqual(['1000']);
    expect(siteRows.rows.map((row) => row.amount).sort()).toEqual(['1000', '2000']);
    expect(allRows.rows).toHaveLength(3);
    expect(new Set(siteRows.rows.map((row) => row.employeeId)).size).toBe(2);
    expect(siteRows.rows.every((row) => String(row.employeeId).startsWith('同姓同名 ['))).toBe(true);
    expect(JSON.stringify(allRows)).not.toMatch(/非公開|idempotencyKey|requestSnapshot|userId|description|evidence/);
    expect(allRows.meta).toMatchObject({ from, to, state: 'all', rowCount: 3, limit: 50000, complete: true });
    expect((await snapshot(admin, 'workforce_expense', 'approved')).json<AnalyticsSnapshot>().rows).toEqual([]);
  });

  it('reloads site assignments on the next request and changes the cache scope key', async () => {
    const before = (await snapshot(manager)).json<AnalyticsSnapshot>();
    await db.owner
      .sql`update user_company_memberships set site_ids = ${JSON.stringify([otherSiteId])}::jsonb where user_id = ${managerId}`;
    try {
      const response = await snapshot(manager);
      expect(response.statusCode).toBe(200);
      const after = response.json<AnalyticsSnapshot>();
      expect(after.rows.map((row) => row.amount)).toEqual(['3000']);
      expect(after.scopeKey).not.toBe(before.scopeKey);
    } finally {
      await db.owner
        .sql`update user_company_memberships set site_ids = ${JSON.stringify([siteId])}::jsonb where user_id = ${managerId}`;
    }
  });

  it('keeps company and tenant boundaries even for administrators', async () => {
    const company = newId();
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${company}, ${db.tenantId}, 'AN-OTHER', 'Other company')`;
    expect(
      (await snapshot(admin, 'workforce_expense', 'all', { 'x-company-id': company })).json<AnalyticsSnapshot>().rows,
    ).toEqual([]);
    expect((await snapshot(employee, 'workforce_expense', 'all', { 'x-company-id': company })).statusCode).toBe(403);
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Other tenant',
      companyCode: 'O',
      companyName: 'Other',
      adminEmail: 'other-analytics@example.com',
      adminName: 'Other',
      adminPassword: 'password',
    });
    const token = await login('other-analytics@example.com');
    expect((await snapshot(token)).json<AnalyticsSnapshot>().rows).toEqual([]);
    expect((await snapshot(token, 'workforce_expense', 'all', { 'x-company-id': db.companyId })).statusCode).toBe(403);
    expect(other.tenantId).not.toBe(db.tenantId);
  });

  it('uses a read-only repeatable snapshot across concurrent business writes', async () => {
    const params: ContextParams = {
      tenantId: db.tenantId,
      companyId: db.companyId,
      actor: { type: 'user', id: db.adminUserId },
      roles: ['admin'],
    };
    const target = registry.entity('partner'),
      where = { name: 'During analytics snapshot' };
    await withContext(
      db.app,
      params,
      async (ctx) => {
        expect(await repo(ctx, target).count(where)).toBe(0);
        await db.run({}, (writer) => repo(writer, target).create({ name: 'During analytics snapshot' }));
        expect(await repo(ctx, target).count(where)).toBe(0);
      },
      { readOnlySnapshot: true },
    );
    expect(await db.run({}, (ctx) => repo(ctx, target).count(where))).toBe(1);
    await expect(
      withContext(db.app, params, (ctx) => repo(ctx, target).create({ name: 'Read-only must refuse this' }), {
        readOnlySnapshot: true,
      }),
    ).rejects.toThrow();
    expect(await db.run({}, (ctx) => repo(ctx, target).count({ name: 'Read-only must refuse this' }))).toBe(0);
  });
});
