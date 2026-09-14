import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { connect, dropAll, newId, runMigrations } from '@daifuku/kernel';
import { OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import '../src/modules.ts';
import { MIGRATIONS_DIR, pendingMigration } from '../src/db/migrations.ts';
import { legacyMigrationFolder } from './legacy-fixture.ts';

const owner = connect(OWNER_URL, { max: 1 });
const previous = legacyMigrationFolder(15);
const tenant = newId();
const company = newId();
const column = '_ext_eq_jan_bbdda0a5d6f7';
const index = 'product_ext_jan_eq_ec17256bb299_idx';
const legacyExt = [
  { jan: '0001234567890', untouched: { legacy: true } },
  { jan: '0001234567890' },
  { jan: Array.from({ length: 3000 }, (_, n) => `${n.toString(36)}😀`).join('') },
  { jan: null },
  { original: [1, 2, 3] },
];

beforeAll(async () => {
  await dropAll(owner);
  await migrate(owner.drizzle, { migrationsFolder: previous });
  await owner.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenant}, true)`;
    await tx`insert into tenants(id,name) values(${tenant},'Index migration test')`;
    await tx`insert into companies(id,tenant_id,code,name,settings) values(${company},${tenant},'KEEP','Existing company','{"preserve":true}')`;
    for (const [number, ext] of legacyExt.entries()) {
      await tx`insert into product(id,tenant_id,company_id,code,name,ext,version)
        values(${newId()},${tenant},${company},${`OLD-${number}`},'Existing product',${JSON.stringify(ext)}::jsonb,7)`;
    }
  });
});
afterAll(async () => {
  await owner.close();
  rmSync(previous, { recursive: true, force: true });
});

async function facts() {
  return owner.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenant}, true)`;
    return {
      products: await tx`select to_jsonb(p) - ${column} as row from product p order by code`,
      companies: await tx`select * from companies order by id`,
      constraints: await tx`select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition
        from pg_constraint where connamespace='public'::regnamespace order by relation,conname`,
    };
  });
}

it('0016 changes only the generated JAN column and its index in the complete 0015 snapshot', async () => {
  const snapshot = (number: string) =>
    JSON.parse(readFileSync(join(MIGRATIONS_DIR, `meta/${number}_snapshot.json`), 'utf8'));
  const before = snapshot('0015');
  const after = snapshot('0016');
  expect(Object.keys(after.tables)).toEqual(Object.keys(before.tables));
  expect(after.tables['public.product'].columns[column].generated).toMatchObject({ type: 'stored' });
  delete after.tables['public.product'].columns[column];
  delete after.tables['public.product'].indexes[index];
  expect(after.tables).toEqual(before.tables);
  expect((await pendingMigration()).statements).toEqual([]);
});

it('upgrades populated 0015 without changing old values, versions, settings or FK constraints; rerun is harmless', async () => {
  const before = await facts();
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
  const generated = await owner.sql`
    select attgenerated from pg_attribute where attrelid='product'::regclass and attname=${column}
  `;
  expect(generated[0]?.attgenerated).toBe('s');
  expect((await owner.sql`select indisvalid,indisunique from pg_index where indexrelid=${index}::regclass`)[0]).toEqual(
    { indisvalid: true, indisunique: false },
  );
  expect(
    (await owner.sql`select relrowsecurity,relforcerowsecurity from pg_class where oid='product'::regclass`)[0],
  ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
});
