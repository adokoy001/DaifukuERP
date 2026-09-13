// Upgrade real 0010 facts before loading current workforce hooks.
import { rmSync } from 'node:fs';
import { connect, dropAll, newId, runMigrations, type Database } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import '../src/modules.ts';
import { MIGRATIONS_DIR, readJournal } from '../src/db/migrations.ts';
import { legacyMigrationFolder } from './legacy-fixture.ts';
const owner = connect(OWNER_URL, { max: 1 }),
  app = connect(APP_URL, { max: 1 });
const previous = legacyMigrationFolder(10);
const tables = [
  'workforce_shift_profile',
  'workforce_shift_availability',
  'workforce_shift_plan',
  'workforce_shift_assignment',
];
const tenant = newId(),
  company = newId(),
  user = newId(),
  site = newId(),
  employee = newId();
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
    await tx`insert into tenants(id,name) values(${tenant},'Historical shift fixture')`;
    await tx`insert into companies(id,tenant_id,code,name) values(${company},${tenant},'ORIGINAL','Existing company')`;
    await tx`insert into users(id,tenant_id,email,name,password_hash,roles,default_company_id) values(${user},${tenant},'migration-shift@example.test','Original employee','historical-non-login-fixture','[]'::jsonb,${company})`;
    await tx`insert into workforce_site(id,tenant_id,company_id,code,name) values(${site},${tenant},${company},'OLD','Existing site')`;
    await tx`insert into workforce_employee(id,tenant_id,company_id,user_id,site_id,code,name,hired_on,version) values(${employee},${tenant},${company},${user},${site},'EMP','Existing employee','2025-04-01',7)`;
    await tx`insert into workforce_attendance(id,tenant_id,company_id,employee_id,user_id,site_id,work_date,status,clock_in,clock_out,worked_ms,day_kind,review_reason) values(${newId()},${tenant},${company},${employee},${user},${site},'2026-09-10','approved','2026-09-10T00:00:00Z','2026-09-10T09:00:00Z',28800000,'workday','Keep the original review')`;
    await tx`insert into workforce_leave_grant(id,tenant_id,company_id,employee_id,user_id,site_id,valid_from,expires_on,days,eligibility_confirmed,basis,granted_by) values(${newId()},${tenant},${company},${employee},${user},${site},'2026-04-01','2028-03-31',10,true,'Original confirmed grant',${user})`;
  });
});
afterAll(async () => {
  await app.close();
  await owner.close();
  rmSync(previous, { recursive: true, force: true });
});
const facts = () =>
  scoped(owner, tenant, async (tx) => ({
    employees: await tx`select * from workforce_employee order by id`,
    attendance: await tx`select * from workforce_attendance order by id`,
    leave: await tx`select * from workforce_leave_grant order by id`,
    users:
      await tx`select id,tenant_id,email,name,password_hash,roles,default_company_id,active,tenant_admin,version,session_version,created_at from users order by id`,
  }));
it('preserves populated 0010 employee, approved attendance and leave facts; adds empty protected shift tables idempotently', async () => {
  const before = await facts();
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
  for (const name of tables) {
    expect((await scoped(app, tenant, (tx) => tx`select count(*)::int n from ${tx(name)}`))[0]?.n).toBe(0);
    const [policy] = await owner.sql`select relrowsecurity,relforcerowsecurity from pg_class where relname=${name}`;
    expect(policy).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  }
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
  expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(
    readJournal().entries.length,
  );
  await scoped(
    app,
    tenant,
    (tx) =>
      tx`insert into workforce_shift_profile(id,tenant_id,company_id,employee_id,user_id,profile) values(${newId()},${tenant},${company},${employee},${user},'{}'::jsonb)`,
  );
  expect((await scoped(app, newId(), (tx) => tx`select count(*)::int n from workforce_shift_profile`))[0]?.n).toBe(0);
  await expect(
    scoped(
      app,
      tenant,
      (tx) =>
        tx`insert into workforce_shift_profile(id,tenant_id,company_id,employee_id,user_id,profile) values(${newId()},${newId()},${company},${employee},${user},'{}'::jsonb)`,
    ),
  ).rejects.toMatchObject({ code: '42501' });
  const otherCompany = newId();
  await scoped(
    owner,
    tenant,
    (tx) => tx`insert into companies(id,tenant_id,code,name) values(${otherCompany},${tenant},'OTHER','Other company')`,
  );
  await expect(
    scoped(
      app,
      tenant,
      (tx) =>
        tx`insert into workforce_shift_profile(id,tenant_id,company_id,employee_id,user_id,profile) values(${newId()},${tenant},${otherCompany},${employee},${user},'{}'::jsonb)`,
    ),
  ).rejects.toMatchObject({ code: '23503' });
});
