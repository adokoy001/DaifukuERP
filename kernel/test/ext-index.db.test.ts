import { and, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTenant } from '../src/auth.ts';
import { extEqualityColumnName, extEqualityIndexName } from '../src/db/ext-index.ts';
import { currentSnapshot, diffSql } from '../src/db/schema-sync.ts';
import { companies } from '../src/db/system-tables.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import type { Domain } from '../src/dsl/types.ts';
import { label } from '../src/i18n.ts';
import { newId } from '../src/ids.ts';
import { registry } from '../src/registry.ts';
import { compileExtCondition } from '../src/repository/ext-query.ts';
import { repo } from '../src/repository/repository.ts';
import { scopeCondition } from '../src/repository/scope.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

const Item = defineEntity({
  name: 'ext_index_item',
  label: label('索引試験', 'Index test'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles: { reader: ['read'] } },
});
const indexName = extEqualityIndexName(Item.name, 'jan');
const prefix = '😀あ'.repeat(80);
const longValue = Array.from({ length: 3000 }, (_, n) => `${n.toString(36)}あ`).join('');
let db: TestDb;
let legacyId: string;
let secondCompany: string;
let other: { tenantId: string; companyId: string };

beforeAll(async () => {
  db = await freshDb();
  legacyId = (await db.run({}, (ctx) => repo(ctx, Item).create({ name: 'legacy', ext: { jan: longValue } }))).id;
  const before = currentSnapshot();
  // A new pack version adds an index after data already exists; the migration must not rewrite/reject that data.
  registry.registerExt(Item.name, { jan: f.text({ equalityIndex: true, searchable: true }) });
  const migration = await diffSql(before, currentSnapshot());
  expect(migration).toHaveLength(2);
  expect(migration[0]).toContain('GENERATED ALWAYS AS');
  await db.owner.drizzle.transaction(async (tx) => {
    for (const statement of migration) await tx.execute(sql.raw(statement));
  });
  const make = (name: string, jan?: string | null) =>
    db.run({}, (ctx) => repo(ctx, Item).create({ name, ...(jan === undefined ? {} : { ext: { jan } }) }));
  await make('zero', '0001234567890');
  await make('without-zero', '1234567890');
  await make('duplicate', '0001234567890');
  await make('prefix-a', `${prefix}A`);
  await make('prefix-b', `${prefix}B`);
  await make('json-null', null);
  await make('missing');
  const shared = { tenantName: 'Index tenant', companyName: 'Index company', adminName: 'Index', adminPassword: 'pw' };
  secondCompany = newId();
  await db.run({}, (ctx) =>
    ctx.db.insert(companies).values({
      id: secondCompany,
      tenantId: db.tenantId,
      code: 'SECOND',
      name: 'Second company',
    }),
  );
  other = await bootstrapTenant(db.owner, { ...shared, companyCode: 'OTHER', adminEmail: 'other@example.com' });
  await db.run({ companyId: secondCompany }, (ctx) =>
    repo(ctx, Item).create({ name: 'second-company', ext: { jan: '0001234567890' } }),
  );
  await db.run(other, (ctx) => repo(ctx, Item).create({ name: 'other-tenant', ext: { jan: '0001234567890' } }));
  // A bounded, synthetic distribution, only in the test database. No production latency claim is derived from it.
  await db.run({}, (ctx) =>
    ctx.db.execute(sql`
    insert into ${Item.table} (id, tenant_id, company_id, name, ext)
    select gen_random_uuid(), ${db.tenantId}::uuid, ${db.companyId}::uuid, 'bulk-' || n,
           jsonb_build_object('jan', 'BULK-' || lpad(n::text, 12, '0'))
    from generate_series(1, 20000) n
  `),
  );
  await db.owner.drizzle.execute(sql`analyze ${Item.table}`);
});
afterAll(async () => {
  await db?.close();
});

async function names(where: Domain, params = {}) {
  const result = await db.run(params, (ctx) =>
    repo(ctx, Item).list({ where, orderBy: [{ field: 'name', dir: 'asc' }] }),
  );
  return result.items.map((item) => item.name);
}

type Plan = { 'Index Name'?: string; 'Index Cond'?: string; Plans?: Plan[] };
function indexes(plan: Plan): Plan[] {
  return [...(plan['Index Name'] ? [plan] : []), ...(plan.Plans ?? []).flatMap(indexes)];
}

describe('ext equality index migration and app-role queries (review-hardening AC-3)', () => {
  it('preserves legacy long values, is nonunique and retains forced RLS', async () => {
    expect((await db.run({}, (ctx) => repo(ctx, Item).get(legacyId))).ext).toEqual({ jan: longValue });
    expect(await names({ 'ext.jan': longValue })).toEqual(['legacy']);
    const details = await db.owner.sql`
      select i.indisvalid, i.indisunique, c.relrowsecurity, c.relforcerowsecurity,
             pg_get_indexdef(i.indexrelid) as definition
      from pg_index i join pg_class c on c.oid = i.indrelid
      where i.indexrelid = ${indexName}::regclass
    `;
    expect(details[0]).toMatchObject({
      indisvalid: true,
      indisunique: false,
      relrowsecurity: true,
      relforcerowsecurity: true,
    });
    expect(String(details[0]?.definition)).toContain('tenant_id, company_id,');
    expect(await diffSql(currentSnapshot(), currentSnapshot())).toEqual([]);
    const created = await db.run({}, (ctx) => repo(ctx, Item).create({ name: 'updated', ext: { jan: longValue } }));
    expect(Object.keys(created)).not.toContain(extEqualityColumnName('jan'));
    await db.run({}, (ctx) => repo(ctx, Item).update(created.id, { ext: { jan: 'updated-jan' } }));
    expect(await names({ 'ext.jan': 'updated-jan' })).toEqual(['updated']);
  });

  it('keeps leading zeros, duplicate codes and full comparisons after multibyte prefix collisions', async () => {
    expect(await names({ 'ext.jan': '0001234567890' })).toEqual(['duplicate', 'zero']);
    expect(await names({ 'ext.jan': '1234567890' })).toEqual(['without-zero']);
    expect(await names({ 'ext.jan': `${prefix}A` })).toEqual(['prefix-a']);
    expect(await names({ 'ext.jan': { $in: [`${prefix}B`, '0001234567890'] } })).toEqual([
      'duplicate',
      'prefix-b',
      'zero',
    ]);
    expect(await names({ name: { $like: 'prefix-%' }, 'ext.jan': { $ne: `${prefix}A` } })).toEqual(['prefix-b']);
    await expect(names({ $not: { 'ext.jan': `${prefix}A` } })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('preserves SQL null, IN, negation and fuzzy search semantics', async () => {
    expect(await names({ 'ext.jan': null })).toEqual(['json-null', 'missing']);
    expect(await names({ 'ext.jan': { $in: [null, `${prefix}A`] } })).toEqual(['json-null', 'missing', 'prefix-a']);
    expect(await names({ 'ext.jan': { $in: [] } })).toEqual([]);
    expect(await names({ name: { $like: 'prefix-%' }, 'ext.jan': { $ne: null } })).toEqual(['prefix-a', 'prefix-b']);
    expect(await names({ 'ext.jan': { $like: '%1234567890' } })).toEqual(['duplicate', 'without-zero', 'zero']);
    const found = await db.run({}, (ctx) => repo(ctx, Item).list({ search: '1234567890' }));
    expect(found.total).toBe(3);
  });

  it('enforces tenant, company and role boundaries on indexed equality', async () => {
    expect(await names({ 'ext.jan': '0001234567890' }, { companyId: secondCompany })).toEqual(['second-company']);
    expect(await names({ 'ext.jan': '0001234567890' }, other)).toEqual(['other-tenant']);
    expect(await names({ 'ext.jan': '0001234567890' }, { roles: ['reader'] })).toEqual(['duplicate', 'zero']);
    await expect(names({ 'ext.jan': '0001234567890' }, { roles: [] })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('uses the scoped generated-column index in a forced generic plan with app RLS enabled', async () => {
    const plan = await db.run({ roles: ['reader'] }, async (ctx) => {
      const query = ctx.db
        .select({ id: Item.col('id') })
        .from(Item.table)
        .where(
          and(
            scopeCondition(ctx, Item),
            compileExtCondition(Item, 'ext.jan', '0001234567890', (value) => value),
          ),
        )
        .toSQL();
      expect(query.params).toEqual([db.tenantId, db.companyId, '0001234567890', '0001234567890']);
      await ctx.db.execute(sql`set local plan_cache_mode = force_generic_plan`);
      await ctx.db.execute(sql.raw(`prepare ext_index_lookup(uuid, uuid, text, text) as ${query.sql}`));
      try {
        const argumentsSql = query.params.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(',');
        const result = await ctx.db.execute(
          sql.raw(`explain (analyze, buffers, format json) execute ext_index_lookup(${argumentsSql})`),
        );
        return (result[0]?.['QUERY PLAN'] as { Plan: Plan }[])[0]?.Plan;
      } finally {
        await ctx.db.execute(sql`deallocate ext_index_lookup`);
      }
    });
    expect(plan).toBeDefined();
    const used = indexes(plan as Plan).find((entry) => entry['Index Name'] === indexName);
    expect(used, JSON.stringify(plan)).toBeDefined();
    expect(used?.['Index Cond']).toContain('$3');
    console.info('Synthetic 20k-row app-role generic lookup plan:', JSON.stringify(plan));
  });
});
