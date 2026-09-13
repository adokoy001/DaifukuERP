// A populated enterprise install must survive the additive store-relay migration.
import { rmSync } from 'node:fs';
import { connect, dropAll, hashPassword, newId } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import '../src/modules.ts';
import { readJournal } from '../src/db/migrations.ts';
import { expectedBooleanUserFacts, legacyMigrationFolder, upgradeLegacyConnection } from './legacy-fixture.ts';
let owner = connect(OWNER_URL, { max: 1 });
const app = connect(APP_URL, { max: 1 });
const previous = legacyMigrationFolder(12);
const tenant = newId();
const company = newId();
const user = newId();
const site = newId();
const tables = ['relay_credentials', 'relay_pairings', 'edge_gateway', 'edge_device', 'edge_job', 'edge_device_event'];
beforeAll(async () => {
  await dropAll(owner);
  await migrate(owner.drizzle, { migrationsFolder: previous });
  await owner.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenant},true)`;
    await tx`insert into tenants(id,name) values(${tenant},'Existing enterprise')`;
    await tx`insert into companies(id,tenant_id,code,name,settings) values(${company},${tenant},'EXISTING','Existing company','{"keep":"settings"}')`;
    await tx`insert into users(id,tenant_id,email,name,password_hash,roles,default_company_id,session_version,mfa_enabled) values(${user},${tenant},'existing@example.invalid','Existing user',${await hashPassword('Synthetic-Existing-Credential')},'[]',${company},7,1)`;
    await tx`insert into identity_factors(user_id,tenant_id,secret_cipher,recovery_hashes) values(${user},${tenant},'existing-sealed-fixture','["existing-hash"]')`;
    await tx`insert into user_company_memberships(tenant_id,user_id,company_id,roles,access_scope,version) values(${tenant},${user},${company},'["workforce_employee"]','all',3)`;
    await tx`insert into workforce_site(id,tenant_id,company_id,code,name) values(${site},${tenant},${company},'OLD','Existing site')`;
  });
});
afterAll(async () => {
  await app.close();
  await owner.close();
  rmSync(previous, { recursive: true, force: true });
});
const facts = () =>
  owner.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenant},true)`;
    return {
      users: await tx`select * from users order by id`,
      factors: await tx`select * from identity_factors order by user_id`,
      memberships: await tx`select * from user_company_memberships order by user_id`,
      companies: await tx`select * from companies order by id`,
      sites: await tx`select * from workforce_site order by id`,
    };
  });
it('preserves existing MFA, sessions, memberships and sites; new tables have forced RLS and scoped keys', async () => {
  const original = await facts();
  const before = { ...original, users: expectedBooleanUserFacts(original.users) };
  owner = await upgradeLegacyConnection(owner, OWNER_URL);
  expect(await facts()).toEqual(before);
  for (const table of tables) {
    expect((await owner.sql`select count(*)::int n from ${owner.sql(table)}`)[0]?.n).toBe(0);
    expect(
      (await owner.sql`select relrowsecurity,relforcerowsecurity from pg_class where relname=${table}`)[0],
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  }
  await app.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenant},true)`;
    await tx`insert into edge_gateway(id,tenant_id,company_id,site_id,code,name) values(${newId()},${tenant},${company},${site},'TEST','Scoped relay')`;
  });
  const otherCount = await app.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${newId()},true)`;
    return tx`select count(*)::int n from edge_gateway`;
  });
  expect(otherCount[0]?.n).toBe(0);
  await expect(
    app.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${tenant},true)`;
      await tx`insert into edge_gateway(id,tenant_id,company_id,site_id,code,name) values(${newId()},${tenant},${newId()},${site},'FOREIGN','Wrong company')`;
    }),
  ).rejects.toMatchObject({ code: '23503' });
  owner = await upgradeLegacyConnection(owner, OWNER_URL);
  expect(await facts()).toEqual(before);
  expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(
    readJournal().entries.length,
  );
});
