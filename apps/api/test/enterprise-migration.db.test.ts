// Populated 0011 -> enterprise upgrade retains credentials, scope and published shift history.
import { rmSync } from 'node:fs';
import { connect, dropAll, hashPassword, newId, runMigrations, type Database } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import '../src/modules.ts';
import { MIGRATIONS_DIR, readJournal } from '../src/db/migrations.ts';
import { legacyMigrationFolder } from './legacy-fixture.ts';
const owner = connect(OWNER_URL, { max: 1 }),
  app = connect(APP_URL, { max: 1 }),
  previous = legacyMigrationFolder(11);
const tenant = newId(),
  company = newId(),
  user = newId(),
  site = newId(),
  employee = newId(),
  plan = newId();
const tables = [
  'identity_challenges',
  'identity_factors',
  'identity_links',
  'identity_mail_outbox',
  'workforce_payroll_rules',
  'workforce_payroll_condition',
  'workforce_payroll_tax_evidence',
  'workforce_year_end_declaration',
  'workforce_year_end_adjustment',
  'workforce_work_system_period',
  'pos_integration_location',
  'pos_integration_inbox',
  'pos_integration_transaction',
  'group_accounting_run',
  'franchise_agreement',
  'franchise_settlement',
];
type Sql = postgres.TransactionSql;
const scoped = <T>(db: Database, tenantId: string, fn: (tx: Sql) => Promise<T>) =>
  db.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantId},true)`;
    return fn(tx);
  });
beforeAll(async () => {
  await dropAll(owner);
  await migrate(owner.drizzle, { migrationsFolder: previous });
  await scoped(owner, tenant, async (tx) => {
    await tx`insert into tenants(id,name) values(${tenant},'Historical enterprise fixture')`;
    await tx`insert into companies(id,tenant_id,code,name,settings) values(${company},${tenant},'ORIGINAL','Existing company','{"keep":"settings"}')`;
    await tx`insert into users(id,tenant_id,email,name,password_hash,roles,default_company_id,session_version) values(${user},${tenant},'historical-enterprise@example.invalid','Existing employee',${await hashPassword('Synthetic-OriginalCredential-2026')},'[]',${company},7)`;
    await tx`insert into user_company_memberships(tenant_id,user_id,company_id,roles,access_scope,version) values(${tenant},${user},${company},'["workforce_employee"]','all',3)`;
    await tx`insert into workforce_site(id,tenant_id,company_id,code,name) values(${site},${tenant},${company},'OLD','Existing site')`;
    await tx`insert into workforce_employee(id,tenant_id,company_id,user_id,site_id,code,name,hired_on,version) values(${employee},${tenant},${company},${user},${site},'EMP','Existing employee','2025-04-01',7)`;
    await tx`insert into workforce_shift_profile(id,tenant_id,company_id,employee_id,user_id,profile,version) values(${newId()},${tenant},${company},${employee},${user},'{"employmentType":"part_time","skills":["cashier"],"maxDailyMinutes":480,"maxWeeklyMinutes":2400,"targetMinutes":1200,"maxDays":5,"maxConsecutiveDays":5,"minRestMinutes":660}',4)`;
    await tx`insert into workforce_shift_plan(id,tenant_id,company_id,site_id,week_start,status,slots,assignments,source_revision,reason) values(${plan},${tenant},${company},${site},'2026-09-07','published','[]','[]','original-source','Original published plan')`;
  });
});
afterAll(async () => {
  await app.close();
  await owner.close();
  rmSync(previous, { recursive: true, force: true });
});
const facts = () =>
  scoped(owner, tenant, async (tx) => ({
    users:
      await tx`select id,tenant_id,email,name,password_hash,roles,default_company_id,active,tenant_admin,version,session_version,created_at from users order by id`,
    memberships: await tx`select * from user_company_memberships order by user_id`,
    companies: await tx`select * from companies order by id`,
    employees: await tx`select * from workforce_employee order by id`,
    profiles: await tx`select * from workforce_shift_profile order by id`,
    plans: await tx`select * from workforce_shift_plan order by id`,
  }));
it('preserves historical facts, initializes MFA off and adds only empty enterprise tables with RLS and scoped foreign keys', async () => {
  const before = await facts();
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
  const [identity] = await scoped(
    app,
    tenant,
    (tx) => tx`select mfa_enabled,session_version from users where id=${user}`,
  );
  expect(identity).toEqual({ mfa_enabled: 0, session_version: 7 });
  for (const name of tables) {
    expect((await scoped(app, tenant, (tx) => tx`select count(*)::int n from ${tx(name)}`))[0]?.n).toBe(0);
    expect(
      (await owner.sql`select relrowsecurity,relforcerowsecurity from pg_class where relname=${name}`)[0],
    ).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  }
  await expect(app.sql`select * from identity_rate_limits`).rejects.toMatchObject({ code: '42501' });
  await scoped(
    app,
    tenant,
    (tx) =>
      tx`insert into identity_factors(user_id,tenant_id,secret_cipher,recovery_hashes) values(${user},${tenant},'synthetic-encrypted-fixture','[]')`,
  );
  expect((await scoped(app, newId(), (tx) => tx`select count(*)::int n from identity_factors`))[0]?.n).toBe(0);
  await expect(
    scoped(
      app,
      tenant,
      (tx) =>
        tx`insert into identity_links(id,tenant_id,user_id,provider_id,issuer,subject) values(${newId()},${tenant},${newId()},'test','https://issuer.example.invalid','subject')`,
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
  expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(
    readJournal().entries.length,
  );
});
