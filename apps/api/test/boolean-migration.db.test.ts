// Verify conversion of populated security tables, not only schema generation on an empty database.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { authenticateRelay, connect, dropAll, loadPrincipal, newId, runMigrations } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import '../src/modules.ts';
import { MIGRATIONS_DIR, pendingMigration, readJournal } from '../src/db/migrations.ts';
import { legacyMigrationFolder } from './legacy-fixture.ts';
import {
  booleanHistoryFacts,
  expectedBooleanHistory,
  seedBooleanHistory,
  syntheticRelaySecret,
  type BooleanTenantFixture,
} from './boolean-migration-fixture.ts';

const owner = connect(OWNER_URL, { max: 1 });
const app = connect(APP_URL, { max: 1 });
const previous = legacyMigrationFolder(16);
const columns = [
  ['users', 'active', 'true'],
  ['users', 'tenant_admin', 'false'],
  ['users', 'mfa_enabled', 'false'],
  ['ext_field_definitions', 'required', 'false'],
  ['relay_credentials', 'active', 'true'],
] as const;
let fixtures: BooleanTenantFixture[];

beforeEach(async () => {
  await dropAll(owner);
  await migrate(owner.drizzle, { migrationsFolder: previous });
  fixtures = await seedBooleanHistory(owner);
  // Existing installations force RLS. Preflight must still inspect every tenant without changing policies.
  for (const table of ['users', 'ext_field_definitions', 'relay_credentials'])
    await owner.sql`alter table ${owner.sql(table)} force row level security`;
});

afterAll(async () => {
  await app.close();
  await owner.close();
  rmSync(previous, { recursive: true, force: true });
});

async function columnFacts() {
  return owner.sql`select table_name,column_name,data_type,column_default,is_nullable
    from information_schema.columns
    where (table_name='users' and column_name in ('active','tenant_admin','mfa_enabled'))
      or (table_name='ext_field_definitions' and column_name='required')
      or (table_name='relay_credentials' and column_name='active')
    order by table_name,column_name`;
}

async function assertCurrentColumns() {
  const actual = await columnFacts();
  expect(actual).toHaveLength(5);
  for (const [table, column, fallback] of columns)
    expect(actual).toContainEqual({
      table_name: table,
      column_name: column,
      data_type: 'boolean',
      column_default: fallback,
      is_nullable: 'NO',
    });
}

it('0017 changes exactly five boolean columns and the relay predicate; all-pack schema has no drift', async () => {
  const snapshot = (number: string) =>
    JSON.parse(readFileSync(join(MIGRATIONS_DIR, `meta/${number}_snapshot.json`), 'utf8'));
  const before = snapshot('0016');
  const after = snapshot('0017');
  for (const [table, column, fallback] of columns) {
    expect(after.tables[`public.${table}`].columns[column]).toEqual({
      ...before.tables[`public.${table}`].columns[column],
      type: 'boolean',
      default: fallback === 'true',
    });
    after.tables[`public.${table}`].columns[column] = before.tables[`public.${table}`].columns[column];
  }
  const index = 'relay_credential_active_uq';
  expect(after.tables['public.relay_credentials'].indexes[index].where).toBe('"relay_credentials"."active" = true');
  after.tables['public.relay_credentials'].indexes[index] = before.tables['public.relay_credentials'].indexes[index];
  expect(after.tables).toEqual(before.tables);
  expect((await pendingMigration()).statements).toEqual([]);
});

it('preserves both truth values, credentials, MFA, sessions and all unrelated data across tenants; rerun is harmless', async () => {
  const before = await booleanHistoryFacts(owner);
  const expected = expectedBooleanHistory(before);
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await booleanHistoryFacts(owner)).toEqual(expected);
  await assertCurrentColumns();
  for (const fixture of fixtures) {
    const activeUser = fixture.users[0];
    const inactiveUser = fixture.users[1];
    const activeCredential = fixture.credentials[0];
    const revokedCredential = fixture.credentials[1];
    if (!activeUser || !inactiveUser || !activeCredential || !revokedCredential) throw new Error('Missing fixture');
    expect(await loadPrincipal(owner, activeUser)).toMatchObject({
      tenantAdmin: true,
      mfaEnabled: true,
      sessionVersion: 13,
    });
    expect(await loadPrincipal(owner, inactiveUser)).toBeNull();
    expect(
      await authenticateRelay(owner, syntheticRelaySecret(activeCredential), new Date('2026-09-14T00:00:00Z')),
    ).toMatchObject({
      credentialId: activeCredential,
      gatewayId: fixture.gateway,
      credentialVersion: 1,
    });
    await expect(
      authenticateRelay(owner, syntheticRelaySecret(revokedCredential), new Date('2026-09-14T00:00:00Z')),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  }
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await booleanHistoryFacts(owner)).toEqual(expected);
  expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(
    readJournal().entries.length,
  );
});

it('keeps RLS, foreign keys, defaults and exactly one active credential per gateway', async () => {
  await runMigrations(owner, MIGRATIONS_DIR);
  const fixture = fixtures[0];
  const foreign = fixtures[1];
  if (!fixture || !foreign) throw new Error('Missing fixture');
  for (const table of ['users', 'ext_field_definitions', 'relay_credentials']) {
    expect(
      (await owner.sql`select relrowsecurity,relforcerowsecurity from pg_class where relname=${table}`)[0],
    ).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
    });
    const rows = await app.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${fixture.tenant}, true)`;
      return tx`select tenant_id from ${tx(table)}`;
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.tenant_id === fixture.tenant)).toBe(true);
  }
  expect(
    (
      await owner.sql`select indisvalid,indisunique from pg_index where indexrelid='relay_credential_active_uq'::regclass`
    )[0],
  ).toEqual({
    indisvalid: true,
    indisunique: true,
  });
  await expect(owner.sql`insert into relay_credentials(id,tenant_id,company_id,gateway_id,site_id,secret_hash,credential_version,expires_at)
    values(${newId()},${fixture.tenant},${fixture.company},${fixture.gateway},${fixture.site},'synthetic-duplicate',3,'2036-01-01')`).rejects.toMatchObject(
    { code: '23505' },
  );
  await expect(owner.sql`insert into users(id,tenant_id,email,name,default_company_id)
    values(${newId()},${fixture.tenant},'foreign@example.invalid','Invalid',${foreign.company})`).rejects.toMatchObject(
    { code: '23503' },
  );
  await expect(
    app.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${fixture.tenant}, true)`;
      await tx`insert into ext_field_definitions(id,tenant_id,entity,key,kind,label,owner)
      values(${newId()},${foreign.tenant},'product','forbidden','text','{}','synthetic')`;
    }),
  ).rejects.toMatchObject({ code: '42501' });
  const [user] = await owner.sql`insert into users(id,tenant_id,email,name)
    values(${newId()},${fixture.tenant},'new@example.invalid','New') returning active,tenant_admin,mfa_enabled`;
  expect(user).toEqual({ active: true, tenant_admin: false, mfa_enabled: false });
  const [field] = await owner.sql`insert into ext_field_definitions(id,tenant_id,entity,key,kind,label,owner)
    values(${newId()},${fixture.tenant},'product','new','text','{}','synthetic') returning required`;
  expect(field).toEqual({ required: false });
  const [credential] =
    await owner.sql`insert into relay_credentials(id,tenant_id,company_id,gateway_id,site_id,secret_hash,credential_version,expires_at)
    values(${newId()},${fixture.tenant},${fixture.company},${newId()},${fixture.site},'synthetic-default',1,'2036-01-01') returning active`;
  expect(credential).toEqual({ active: true });
});

describe('invalid legacy flags', () => {
  it.each(columns)('rejects %s.%s before any conversion and keeps all source facts', async (table, column) => {
    const fixture = fixtures[1];
    if (!fixture) throw new Error('Missing fixture');
    // Corrupt the other tenant: an RLS-filtered preflight must never miss it.
    await owner.sql`update ${owner.sql(table)} set ${owner.sql(column)} = 2 where tenant_id=${fixture.tenant}`;
    const before = await booleanHistoryFacts(owner);
    const schema = await columnFacts();
    await expect(runMigrations(owner, MIGRATIONS_DIR)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('Boolean flag migration requires only 0 or 1') },
    });
    expect(await booleanHistoryFacts(owner)).toEqual(before);
    expect(await columnFacts()).toEqual(schema);
    expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(17);
    expect(
      (
        await owner.sql`select pg_get_expr(indpred,indrelid) as predicate from pg_index where indexrelid='relay_credential_active_uq'::regclass`
      )[0]?.predicate,
    ).toBe('(active = 1)');
  });
});

it('creates native boolean columns on a new installation', async () => {
  await dropAll(owner);
  await runMigrations(owner, MIGRATIONS_DIR);
  await assertCurrentColumns();
  expect((await owner.sql`select count(*)::int n from users`)[0]?.n).toBe(0);
});
