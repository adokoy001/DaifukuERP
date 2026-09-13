import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPack, companies, entityMeta, newId, repo, type ContextParams } from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { observe, observerAt, scopePack, ScopeChild, ScopeSite, ScopeWork } from './noninterference-fixture.ts';
let db: TestDb, allowedSite: string, forbiddenSite: string, visibleId: string;
const outsider = fc.record({ label: fc.constantFrom('needle alpha', 'needle beta', 'other'), category: fc.constantFrom('a' as const, 'b' as const), cents: fc.integer({ min: 1, max: 999999 }), secret: fc.string({ maxLength: 20 }) });
type HiddenInput = { label: string; category: 'a' | 'b'; cents: number; secret: string };
const cases = fc.array(outsider, { minLength: 1, maxLength: 4 });
const money = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
beforeAll(async () => {
  db = await freshDb();
  await db.run({}, async (ctx) => {
    allowedSite = (await repo(ctx, ScopeSite).create({ name: 'Allowed' })).id;
    forbiddenSite = (await repo(ctx, ScopeSite).create({ name: 'Forbidden' })).id;
    const row = await repo(ctx, ScopeWork).create({ siteId: allowedSite, name: 'needle alpha', amount: '10.25', category: 'a', secret: 'not-visible' });
    await repo(ctx, ScopeChild).create({ workId: row.id, name: row.name });
  });
  // The observing role can really create/update inside its site; denial assertions are not an always-deny fixture.
  await db.run(observerAt(allowedSite), async (ctx) => {
    const row = await repo(ctx, ScopeWork).create({ siteId: allowedSite, name: 'needle beta', amount: '20', category: 'b' });
    visibleId = row.id;
    const updated = await repo(ctx, ScopeWork).update(row.id, { amount: '20.75' }, { expectedVersion: row.version });
    expect(updated.version).toBe(row.version + 1); expect(String(updated.amount)).toBe('20.75');
    await repo(ctx, ScopeChild).create({ workId: row.id, name: row.name });
  });
});
afterAll(async () => { await db.close(); });
async function newCompany() {
  const companyId = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyId, tenantId: db.tenantId, code: companyId, name: 'Synthetic outsider' });
  return companyId;
}
async function assertBaseline(scope: Partial<ContextParams> = observerAt(allowedSite)) {
  const before = await db.run(scope, observe);
  expect(before.count).toBe(2); expect(before.list.items).toHaveLength(2); expect(before.search.total).toBe(2); expect(before.child.total).toBe(2);
  expect(before.page.items).toHaveLength(1); expect(before.matching).toBe(2);
  expect(before.aggregate.map((row) => String(row.total))).toEqual(['10.25', '20.75']);
  expect(before.list.items.every((row) => row.secret === undefined)).toBe(true);
  expect(before.entityMetadata.extFields).toEqual([]);
  return before;
}
async function assertInvisible(companyId: string, siteId: string, rows: { id: string }[], own: Partial<ContextParams>) {
  const first = rows[0];
  if (!first) throw new Error('At least one hidden record must be created');
  const original = await db.run({ companyId }, (ctx) => repo(ctx, ScopeWork).get(first.id));
  const count = await db.run({ companyId }, (ctx) => repo(ctx, ScopeWork).count());
  await expect(db.run(own, (ctx) => repo(ctx, ScopeWork).get(first.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(db.run(own, (ctx) => repo(ctx, ScopeWork).update(first.id, { name: 'forged' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(db.run(own, (ctx) => repo(ctx, ScopeWork).create({ siteId, name: 'forged', amount: '1', category: 'a' }))).rejects.toMatchObject({ code: companyId === db.companyId ? 'PERMISSION_DENIED' : 'VALIDATION' });
  const hidden = await db.run({ companyId }, (ctx) => repo(ctx, ScopeWork).get(first.id));
  expect(hidden).toEqual(original);
  expect(await db.run({ companyId }, (ctx) => repo(ctx, ScopeWork).count())).toBe(count);
}
async function changeHidden(companyId: string, siteId: string, changes: HiddenInput[]) {
  const ids: { id: string }[] = [];
  for (const [index, input] of changes.entries()) {
    const created = await db.run({ companyId }, async (ctx) => {
      const row = await repo(ctx, ScopeWork).create({ siteId, name: input.label, amount: money(input.cents), category: input.category, secret: input.secret });
      await repo(ctx, ScopeChild).create({ workId: row.id, name: input.label });
      return row;
    });
    ids.push(created);
    const updated = await db.run({ companyId }, (ctx) => repo(ctx, ScopeWork).update(created.id, { amount: money(input.cents + index + 1), name: 'needle changed' }, { expectedVersion: created.version }));
    expect(updated.version).toBe(created.version + 1); expect(String(updated.amount)).not.toBe(String(created.amount));
  }
  return ids;
}
describe('AC-4 / PV-SCOPE-01 two-state Repository noninterference', () => {
  it.each(['company', 'site'] as const)('generated changes behind the %s boundary preserve every authorized observation', async (boundary) => {
    let writes = 0, rejected = 0;
    const scope = boundary === 'company' ? { roles: ['observer'], accessScope: 'all' as const } : observerAt(allowedSite);
    await fc.assert(fc.asyncProperty(cases, async (changes) => {
      const before = await assertBaseline(scope), companyId = boundary === 'company' ? await newCompany() : db.companyId;
      const siteId = boundary === 'company' ? await db.run({ companyId }, async (ctx) => (await repo(ctx, ScopeSite).create({ name: 'Other company site' })).id) : forbiddenSite;
      const rows = await changeHidden(companyId, siteId, changes); writes += rows.length * 2;
      await assertInvisible(companyId, siteId, rows, scope); rejected += 3;
      expect(await db.run(scope, observe)).toEqual(before);
      // Parent-scoped descendants are changed/deleted too; not just an unrelated hidden table.
      for (const row of rows) await db.run({ companyId }, async (ctx) => {
        for (const child of (await repo(ctx, ScopeChild).list({ where: { workId: row.id } })).items) await repo(ctx, ScopeChild).delete(child.id);
        await repo(ctx, ScopeWork).delete(row.id);
      });
      expect(await db.run(scope, observe)).toEqual(before);
    }), { seed: 20260913, numRuns: 8 });
    expect(writes).toBeGreaterThanOrEqual(16); expect(rejected).toBe(24);
  });
  it('generated pack application in another company changes its metadata/hooks without changing this user or company', async () => {
    let applied = 0, rejected = 0;
    await fc.assert(fc.asyncProperty(cases, async (changes) => {
      const before = await assertBaseline(), companyId = await newCompany();
      const siteId = await db.run({ companyId }, async (ctx) => (await repo(ctx, ScopeSite).create({ name: 'Pack company' })).id);
      await db.run({ companyId }, (ctx) => applyPack(ctx, scopePack.name)); applied++;
      const metadata = await db.run({ companyId }, async (ctx) => entityMeta(ctx, ScopeWork));
      expect(metadata.label).not.toEqual(before.entityMetadata.label); expect(metadata.extFields.map((field) => field.name)).toContain('ext.requiredTag');
      await expect(db.run({ companyId }, (ctx) => repo(ctx, ScopeWork).create({ siteId, name: 'missing tag', amount: '1', category: 'a' }))).rejects.toMatchObject({ code: 'VALIDATION' }); rejected++;
      for (const input of changes) {
        const row = await db.run({ companyId }, (ctx) => repo(ctx, ScopeWork).create({ siteId, name: input.label, category: input.category, amount: money(input.cents), ext: { requiredTag: input.secret } }));
        expect(row.ext).toMatchObject({ requiredTag: input.secret, computedTag: 'applied-only' });
      }
      expect(await db.run(observerAt(allowedSite), observe)).toEqual(before);
      expect((await db.run({}, (ctx) => repo(ctx, ScopeWork).get(visibleId))).ext).toBeNull();
    }), { seed: 20260914, numRuns: 6 });
    expect(applied).toBe(6); expect(rejected).toBe(6);
  });
});
