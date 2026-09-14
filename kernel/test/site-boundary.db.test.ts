import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  appMeta,
  auditTrail,
  checkActionExport,
  defineAction,
  defineEntity,
  f,
  label,
  newId,
  repo,
  runAction,
} from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
const roles = {
  workforce_manager: ['read', 'create', 'update', 'export'] as const,
  chain_manager: ['read', 'create', 'update', 'export'] as const,
};
const Site = defineEntity({
  name: 'site_boundary_site',
  label: label('拠点', 'Site'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles },
  siteAccess: { kind: 'store', field: 'id' },
});
const Store = defineEntity({
  name: 'site_boundary_store',
  label: label('店舗', 'Store'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles },
  storeAccess: { kind: 'store', field: 'id' },
});
const Work = defineEntity({
  name: 'site_boundary_work',
  label: label('作業', 'Work'),
  fields: { siteId: f.ref(Site.name, { required: true }), amount: f.money({ required: true }) },
  permissions: { roles },
  siteAccess: { kind: 'store', field: 'siteId' },
});
const Child = defineEntity({
  name: 'site_boundary_child',
  label: label('子', 'Child'),
  fields: { workId: f.ref(Work.name, { required: true }), name: f.text({ required: true }) },
  permissions: { roles },
  siteAccess: { kind: 'parent', field: 'workId', entity: Work.name },
});
const Hidden = defineEntity({
  name: 'site_boundary_hidden',
  label: label('機密', 'Private'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles },
});
const Shared = defineEntity({
  name: 'site_boundary_shared',
  label: label('共有', 'Shared'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles: { admin: ['read'] } },
  siteAccess: { kind: 'sharedRead' },
});
const report = defineAction({
  name: 'site_boundary.report',
  description: label('拠点集計', 'Site report'),
  input: z.object({}),
  output: z.number(),
  permission: { entity: Work.name, op: 'read' },
  siteAccess: true,
  exportEntities: [Work.name],
  tx: 'none',
  mutates: false,
  handler: (ctx) => repo(ctx, Work).count(),
});
defineAction({
  name: 'site_boundary.store_report',
  description: label('店舗集計', 'Store report'),
  input: z.object({}),
  output: z.number(),
  permission: { entity: Store.name, op: 'read' },
  storeAccess: true,
  tx: 'none',
  handler: (ctx) => repo(ctx, Store).count(),
});
defineAction({
  name: 'site_boundary.undeclared',
  description: label('未宣言', 'Undeclared'),
  input: z.object({}),
  output: z.object({}),
  permission: 'authenticated',
  handler: async () => ({}),
});
let db: TestDb;
let a: string;
let b: string;
let sa: string;
let workA: string;
let workB: string;
const limited = () => ({
  accessScope: 'sites' as const,
  siteIds: [a],
  storeIds: [sa],
  roles: ['workforce_manager', 'chain_manager'],
});
beforeAll(async () => {
  db = await freshDb();
  await db.run({}, async (ctx) => {
    a = (await repo(ctx, Site).create({ name: 'A' })).id;
    b = (await repo(ctx, Site).create({ name: 'B' })).id;
    sa = (await repo(ctx, Store).create({ name: 'S-A' })).id;
    await repo(ctx, Store).create({ name: 'S-B' });
    workA = (await repo(ctx, Work).create({ siteId: a, amount: '100' })).id;
    workB = (await repo(ctx, Work).create({ siteId: b, amount: '900' })).id;
    await repo(ctx, Child).create({ workId: workA, name: 'A' });
    await repo(ctx, Child).create({ workId: workB, name: 'B' });
    await repo(ctx, Shared).create({ name: 'Common' });
  });
});
afterAll(async () => {
  await db.close();
});
describe('independent generic site and legacy store ACL', () => {
  it('permits the same manager to see only explicitly assigned sites and stores', async () => {
    await db.run(limited(), async (ctx) => {
      expect((await repo(ctx, Site).list()).items.map((row) => row.name)).toEqual(['A']);
      expect((await repo(ctx, Store).list()).items.map((row) => row.name)).toEqual(['S-A']);
      expect(await runAction(ctx, report.name, {})).toBe(1);
      expect(await runAction(ctx, 'site_boundary.store_report', {})).toBe(1);
      expect(() => checkActionExport(ctx, report)).not.toThrow();
      expect(String((await repo(ctx, Work).aggregate({ metrics: { total: { sum: 'amount' } } }))[0]?.total)).toBe(
        '100',
      );
      expect((await repo(ctx, Child).list({ search: 'B' })).total).toBe(0);
      expect(await repo(ctx, Work).find(workB)).toBeNull();
      expect((await auditTrail(ctx, Work.name, workA)).length).toBeGreaterThan(0);
    });
    await expect(db.run(limited(), (ctx) => auditTrail(ctx, Work.name, workB))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
  it('cannot widen a site or store list through a role union, admin, or the other list', async () => {
    await db.run({ ...limited(), roles: ['admin'], siteIds: [] }, async (ctx) => {
      expect(await repo(ctx, Work).count()).toBe(0);
      expect(await repo(ctx, Store).count()).toBe(1);
    });
    await db.run({ ...limited(), storeIds: [] }, async (ctx) => {
      expect(await repo(ctx, Store).count()).toBe(0);
      expect(await repo(ctx, Work).count()).toBe(1);
    });
    await expect(
      db.run({ ...limited(), storeIds: [] }, (ctx) => runAction(ctx, 'site_boundary.store_report', {})),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run({ ...limited(), accessScope: 'stores' }, (ctx) => repo(ctx, Work).list()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('fails closed on undeclared resources and denies cross-site writes and foreign companies', async () => {
    await expect(db.run(limited(), (ctx) => repo(ctx, Hidden).list())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(db.run(limited(), (ctx) => runAction(ctx, 'site_boundary.undeclared', {}))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(db.run(limited(), (ctx) => repo(ctx, Work).create({ siteId: b, amount: '1' }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(db.run(limited(), (ctx) => repo(ctx, Work).update(workA, { siteId: b }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(db.run(limited(), (ctx) => repo(ctx, Shared).create({ name: 'No' }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await db.run(limited(), async (ctx) => {
      expect(await repo(ctx, Shared).count()).toBe(1);
      expect(appMeta(ctx).entities.map((item) => item.name)).not.toContain(Hidden.name);
    });
    const companyId = newId();
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${companyId}, ${db.tenantId}, 'SITE-OUT', 'Outside')`;
    await db.run({ ...limited(), companyId }, async (ctx) => {
      expect(await repo(ctx, Work).count()).toBe(0);
    });
  });
});
