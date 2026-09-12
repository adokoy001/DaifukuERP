import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { appMeta, auditTrail, checkActionExport, defineAction, defineDocument, defineEntity, f, label, newId, repo, runAction, submitDocument } from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

const roles = { chain_staff: ['read', 'create', 'update', 'delete'] as const, chain_manager: ['read', 'create', 'update', 'delete', 'export'] as const };
const Store = defineEntity({ name: 'access_store', label: label('店舗', 'Store'), fields: { name: f.text({ required: true }) }, permissions: { roles }, storeAccess: { kind: 'store', field: 'id' } });
const Shared = defineEntity({ name: 'access_shared', label: label('共有', 'Shared'), fields: { name: f.text({ required: true }) }, permissions: { roles: { admin: ['read'] } }, storeAccess: { kind: 'sharedRead' } });
const Hidden = defineEntity({ name: 'access_hidden', label: label('金融', 'Finance'), fields: { name: f.text({ required: true }) }, permissions: { roles } });
const Closing = defineDocument({ name: 'access_closing', label: label('締め', 'Closing'), naming: { type: 'sequence', prefix: 'ACL-' }, fields: { storeId: f.ref(Store.name, { required: true }), amount: f.money({ required: true }) }, permissions: { roles }, storeAccess: { kind: 'store', field: 'storeId' }, lines: [{ entity: 'access_line', parentField: 'closingId' }] });
const Line = defineEntity({ name: 'access_line', label: label('明細', 'Line'), fields: { closingId: f.ref(Closing.name, { required: true }), name: f.text({ required: true }) }, permissions: { roles }, storeAccess: { kind: 'parent', field: 'closingId', entity: Closing.name } });
const report = defineAction({ name: 'access.report', description: label('集計', 'Report'), input: z.object({}), output: z.object({ count: z.number() }), permission: { entity: Closing.name, op: 'read' }, tx: 'none', storeAccess: true, exportEntities: [Closing.name], handler: async (ctx) => ({ count: await repo(ctx, Closing).count() }) });
defineAction({ name: 'access.undeclared', description: label('未宣言', 'Undeclared'), input: z.object({}), output: z.object({}), permission: 'authenticated', tx: 'none', handler: async () => ({}) });
let db: TestDb;
let storeA: string, storeB: string, closingA: string, closingB: string, lineA: string;
const limited = () => ({ roles: ['chain_manager'], accessScope: 'stores' as const, storeIds: [storeA] });
beforeAll(async () => {
  db = await freshDb();
  await db.run({}, async (ctx) => {
    storeA = (await repo(ctx, Store).create({ name: 'A' })).id;
    storeB = (await repo(ctx, Store).create({ name: 'B' })).id;
    closingA = (await repo(ctx, Closing).create({ storeId: storeA, amount: '100' })).id;
    closingB = (await repo(ctx, Closing).create({ storeId: storeB, amount: '900' })).id;
    lineA = (await repo(ctx, Line).create({ closingId: closingA, name: 'A line' })).id;
    await repo(ctx, Line).create({ closingId: closingB, name: 'B line' });
    await repo(ctx, Shared).create({ name: 'Reference' });
  });
});
afterAll(async () => { await db.close(); });

describe('company/store boundary applies below every transport', () => {
  it('filters list, count, aggregate, search, get, child rows and audit, even with admin role', async () => {
    await db.run(limited(), async (ctx) => {
      expect((await repo(ctx, Store).list()).items.map((r) => r.name)).toEqual(['A']);
      expect(await repo(ctx, Closing).count()).toBe(1);
      expect((await repo(ctx, Line).list({ search: 'B' })).total).toBe(0);
      expect((await repo(ctx, Line).list()).items.map((r) => r.name)).toEqual(['A line']);
      const aggregate = await repo(ctx, Closing).aggregate({ metrics: { total: { sum: 'amount' } } });
      expect(String(aggregate[0]?.total)).toBe('100');
      expect(await repo(ctx, Closing).find(closingB)).toBeNull();
      expect((await auditTrail(ctx, Closing.name, closingA)).length).toBeGreaterThan(0);
    });
    await expect(db.run({ ...limited(), roles: ['admin'] }, (ctx) => auditTrail(ctx, Closing.name, closingB))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('rejects cross-store create, record move, child reparent and direct posting', async () => {
    await expect(db.run(limited(), (ctx) => repo(ctx, Closing).create({ storeId: storeB, amount: '1' }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(db.run(limited(), (ctx) => repo(ctx, Closing).update(closingA, { storeId: storeB }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(db.run(limited(), (ctx) => repo(ctx, Line).update(lineA, { closingId: closingB }))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(db.run({ ...limited(), roles: ['admin'] }, (ctx) => submitDocument(ctx, Closing, closingA))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await db.run({}, async (ctx) => { expect((await repo(ctx, Closing).get(closingA)).storeId).toBe(storeA); });
  });
  it('fails closed for empty assignments, undeclared entities/actions, and shared writes', async () => {
    await db.run({ ...limited(), storeIds: [] }, async (ctx) => { expect(await repo(ctx, Closing).count()).toBe(0); });
    await expect(db.run(limited(), (ctx) => repo(ctx, Hidden).list())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(db.run(limited(), (ctx) => repo(ctx, Shared).create({ name: 'No' }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(db.run(limited(), (ctx) => runAction(ctx, 'access.undeclared', {}))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await db.run(limited(), async (ctx) => {
      expect((await repo(ctx, Shared).list()).total).toBe(1);
      expect(appMeta(ctx).entities.map((e) => e.name)).not.toContain(Hidden.name);
      expect(appMeta(ctx).actions.map((a) => a.name)).not.toContain('access.undeclared');
      expect(await runAction(ctx, report.name, {})).toEqual({ count: 1 });
      expect(() => checkActionExport(ctx, report)).not.toThrow();
    });
    await db.run({ ...limited(), roles: ['chain_staff'] }, async (ctx) => { expect(() => checkActionExport(ctx, report)).toThrow(); });
  });
  it('rejects caller-forged store ids in other companies through normal company scope', async () => {
    const otherCompany = newId();
    await db.owner.sql`insert into companies (id, tenant_id, code, name) values (${otherCompany}, ${db.tenantId}, 'O', 'Other')`;
    await db.run({ ...limited(), companyId: otherCompany }, async (ctx) => { expect(await repo(ctx, Closing).count()).toBe(0); });
  });
});
