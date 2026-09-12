import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, applyPack, companies, definePack, label, newId, registerPackActions, runAction, type ContextParams } from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

definePack({ name: 'list_access_a', label: label('公開テンプレートA', 'Public template A'), depends: [], version: '1.0.0' });
definePack({ name: 'list_access_b', label: label('公開テンプレートB', 'Public template B'), depends: [], version: '2.0.0' });
registerPackActions();
let db: TestDb;
let companyB: string;
interface Item { name: string; version: string; applied: boolean; appliedVersion: string | null; appliedAt: string | null }
const scopes: Partial<ContextParams>[] = [
  { roles: ['workforce_manager'], accessScope: 'sites', siteIds: [newId()], storeIds: [] },
  { roles: ['chain_manager'], accessScope: 'stores', storeIds: [newId()] },
  { roles: ['workforce_employee'], accessScope: 'sites', siteIds: [], storeIds: [] },
];
beforeAll(async () => {
  db = await freshDb();
  companyB = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'LIST-B', name: 'Second company' });
  await db.run({ now: () => new Date('2026-09-01T00:00:00Z') }, (ctx) => applyPack(ctx, 'list_access_a'));
  await db.run({ companyId: companyB, now: () => new Date('2026-09-02T00:00:00Z') }, (ctx) => applyPack(ctx, 'list_access_b'));
});
afterAll(async () => { await db.close(); });
describe('pack catalogue remains available to restricted company users', () => {
  it('permits site/store scopes to list public catalogue and only the selected company application state', async () => {
    for (const scope of scopes) {
      const a = await db.run(scope, (ctx) => runAction(ctx, 'pack.list', {})) as { items: Item[] };
      expect(a.items.find((item) => item.name === 'list_access_a')).toMatchObject({ applied: true, appliedVersion: '1.0.0', appliedAt: '2026-09-01T00:00:00.000Z' });
      expect(a.items.find((item) => item.name === 'list_access_b')).toMatchObject({ applied: false, appliedVersion: null, appliedAt: null });
      const b = await db.run({ ...scope, companyId: companyB }, (ctx) => runAction(ctx, 'pack.list', {})) as { items: Item[] };
      expect(b.items.find((item) => item.name === 'list_access_a')).toMatchObject({ applied: false, appliedVersion: null, appliedAt: null });
      expect(b.items.find((item) => item.name === 'list_access_b')).toMatchObject({ applied: true, appliedVersion: '2.0.0', appliedAt: '2026-09-02T00:00:00.000Z' });
      for (const item of a.items) expect(Object.keys(item).sort()).toEqual(['applied', 'appliedAt', 'appliedVersion', 'depends', 'hasSample', 'label', 'name', 'sampledAt', 'version']);
      await db.run(scope, async (ctx) => {
        const actions = appMeta(ctx).actions.map((action) => action.name);
        expect(actions).toContain('pack.list'); expect(actions).not.toContain('pack.apply');
      });
    }
  });
  it('rejects both the mutation action and direct application, including an admin role inside a restricted scope', async () => {
    for (const scope of [...scopes, { ...scopes[0], roles: ['admin'] }]) {
      await expect(db.run(scope, (ctx) => runAction(ctx, 'pack.apply', { name: 'list_access_b', sample: true, force: true }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(db.run(scope, (ctx) => applyPack(ctx, 'list_access_a'))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
    const after = await db.run({}, (ctx) => runAction(ctx, 'pack.list', {})) as { items: Item[] };
    expect(after.items.find((item) => item.name === 'list_access_b')?.applied).toBe(false);
  });
});
