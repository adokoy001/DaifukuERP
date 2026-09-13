// Upgrade facts are inserted with the historical schema, without current hooks/default synthesis.
import { rmSync } from 'node:fs';
import { connect, dropAll, hashPassword, newId, runMigrations, type Database } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import '../src/modules.ts';
import { MIGRATIONS_DIR, readJournal } from '../src/db/migrations.ts';
import { legacyMigrationFolder } from './legacy-fixture.ts';

const owner = connect(OWNER_URL, { max: 1 });
const app = connect(APP_URL, { max: 1 });
const previous = legacyMigrationFolder(8);
type Sql = postgres.TransactionSql;
const scope = <T>(db: Database, tenant: string, fn: (tx: Sql) => Promise<T>) =>
  db.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenant},true)`;
    return fn(tx);
  });
interface UserFixture {
  id: string;
  roles: string[];
  active: number;
  defaultCompany: string | null;
  passwordHash: string;
}
interface TenantFixture {
  id: string;
  companies: string[];
  users: UserFixture[];
  closings: string[];
}

beforeEach(async () => {
  await dropAll(owner);
  await migrate(owner.drizzle, { migrationsFolder: previous });
  // Reproduce the historical FORCE RLS owner path without invoking current-registry grants.
  const tables = await owner.sql<
    { name: string }[]
  >`select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity`;
  for (const table of tables) await owner.sql`alter table ${owner.sql(table.name)} force row level security`;
});
afterAll(async () => {
  await app.close();
  await owner.close();
  rmSync(previous, { recursive: true, force: true });
});

async function addClosings(tx: Sql, tenant: string, company: string): Promise<string[]> {
  const warehouse = newId();
  const partner = newId();
  const account = newId();
  const store = newId();
  await tx`insert into warehouse(id,tenant_id,company_id,code,name) values(${warehouse},${tenant},${company},'KITCHEN','既存厨房')`;
  await tx`insert into partner(id,tenant_id,company_id,name,is_customer) values(${partner},${tenant},${company},'既存店舗客',true)`;
  await tx`insert into account(id,tenant_id,company_id,code,name,type) values(${account},${tenant},${company},'CASH','既存現金','asset')`;
  await tx`insert into restaurant_chain_store(id,tenant_id,company_id,code,name,warehouse_id,partner_id,cash_account_id) values(${store},${tenant},${company},'STORE','既存店舗',${warehouse},${partner},${account})`;
  const ids: string[] = [];
  for (const status of [0, 1, 2]) {
    const id = newId();
    ids.push(id);
    await tx`insert into restaurant_chain_closing(id,tenant_id,company_id,store_id,docstatus,number,date,cash_amount,card_amount,qr_amount,subtotal,tax_total,total,quantity,consumption_cost,waste_cost,note,cancelled_date)
      values(${id},${tenant},${company},${store},${status},${`OLD-${status}`},'2026-09-12',700,300,110,1000,110,1110,2,222,10,'旧版メモ',${status === 2 ? '2026-09-13' : null})`;
  }
  return ids;
}
async function historicalFixture(): Promise<TenantFixture[]> {
  const fixtures: TenantFixture[] = [];
  for (const label of ['Tenant A', 'Tenant B']) {
    const id = newId();
    const companies = [newId(), newId()];
    const users: UserFixture[] = [
      {
        id: newId(),
        roles: ['admin'],
        active: 1,
        defaultCompany: companies[1] ?? null,
        passwordHash: await hashPassword('Original-AdminCredential9!'),
      },
      {
        id: newId(),
        roles: ['sales_user'],
        active: 1,
        defaultCompany: null,
        passwordHash: await hashPassword('Original-SalesCredential9!'),
      },
      {
        id: newId(),
        roles: [],
        active: 0,
        defaultCompany: companies[0] ?? null,
        passwordHash: await hashPassword('Original-InactiveCredential9!'),
      },
    ];
    const closings = await scope(owner, id, async (tx) => {
      await tx`insert into tenants(id,name) values(${id},${label})`;
      const documents: string[] = [];
      for (const [index, company] of companies.entries()) {
        await tx`insert into companies(id,tenant_id,code,name,settings) values(${company},${id},${`C${index}`},${`${label} ${index}`},' {"custom":"preserve"}'::jsonb)`;
        documents.push(...(await addClosings(tx, id, company)));
      }
      for (const [index, user] of users.entries())
        await tx`insert into users(id,tenant_id,email,name,password_hash,roles,active,default_company_id)
        values(${user.id},${id},${`same-user-${index}@example.test`},${`Original user ${index}`},${user.passwordHash},${JSON.stringify(user.roles)}::jsonb,${user.active},${user.defaultCompany})`;
      return documents;
    });
    fixtures.push({ id, companies, users, closings });
  }
  return fixtures;
}
async function originalFacts(fixtures: TenantFixture[]) {
  return Promise.all(
    fixtures.map((fixture) =>
      scope(owner, fixture.id, async (tx) => ({
        users:
          await tx`select id,email,name,password_hash,roles,active,default_company_id from users where tenant_id=${fixture.id} order by id`,
        companies: await tx`select id,code,name,settings from companies where tenant_id=${fixture.id} order by id`,
        closings:
          await tx`select id,company_id,store_id,docstatus,number,date::text,cash_amount,card_amount,qr_amount,subtotal,tax_total,total,quantity,consumption_cost,waste_cost,note,cancelled_date::text from restaurant_chain_closing where tenant_id=${fixture.id} order by id`,
      })),
    ),
  );
}

describe('operations-control historical 0008 upgrade', () => {
  it('copies tenant-wide legacy roles into only the same tenant companies without changing original facts', async () => {
    const fixtures = await historicalFixture();
    const original = await originalFacts(fixtures);
    await runMigrations(owner, MIGRATIONS_DIR);
    expect(await originalFacts(fixtures)).toEqual(original);
    for (const fixture of fixtures)
      await scope(owner, fixture.id, async (tx) => {
        const memberships =
          await tx`select tenant_id,user_id,company_id,roles,access_scope,store_ids,version from user_company_memberships where tenant_id=${fixture.id} order by user_id,company_id`;
        expect(memberships).toHaveLength(fixture.users.length * fixture.companies.length);
        for (const user of fixture.users)
          for (const company of fixture.companies)
            expect(memberships).toContainEqual({
              tenant_id: fixture.id,
              user_id: user.id,
              company_id: company,
              roles: user.roles,
              access_scope: 'all',
              store_ids: [],
              version: 1,
            });
        const users =
          await tx`select id,tenant_admin,version,session_version from users where tenant_id=${fixture.id} order by id`;
        for (const user of fixture.users)
          expect(users).toContainEqual({
            id: user.id,
            tenant_admin: user.roles.includes('admin') ? 1 : 0,
            version: 1,
            session_version: 1,
          });
        const closings =
          await tx`select cash_sales_counted,review_status,submitted_at,submitted_by,reviewed_at,reviewed_by,review_note from restaurant_chain_closing where tenant_id=${fixture.id}`;
        expect(closings).toHaveLength(fixture.closings.length);
        for (const closing of closings)
          expect(closing).toEqual({
            cash_sales_counted: null,
            review_status: 'draft',
            submitted_at: null,
            submitted_by: null,
            reviewed_at: null,
            reviewed_by: null,
            review_note: null,
          });
        expect(
          (await tx`select count(*)::int n from restaurant_chain_day_plan where tenant_id=${fixture.id}`)[0]?.n,
        ).toBe(0);
      });
    const memberships = () =>
      Promise.all(
        fixtures.map((f) =>
          scope(
            owner,
            f.id,
            (tx) => tx`select * from user_company_memberships where tenant_id=${f.id} order by user_id,company_id`,
          ),
        ),
      );
    const membersBefore = await memberships();
    await runMigrations(owner, MIGRATIONS_DIR);
    expect(await originalFacts(fixtures)).toEqual(original);
    expect(await memberships()).toEqual(membersBefore);
    expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(
      readJournal().entries.length,
    );
  });

  it('enforces tenant RLS on migrated memberships and denies a foreign-tenant insert', async () => {
    const fixtures = await historicalFixture();
    await runMigrations(owner, MIGRATIONS_DIR);
    const current = fixtures[0];
    const foreign = fixtures[1];
    expect(current && foreign).toBeTruthy();
    if (!current || !foreign) throw new Error('fixture missing');
    for (const fixture of fixtures)
      await scope(app, fixture.id, async (tx) => {
        const rows = await tx`select tenant_id,user_id,company_id from user_company_memberships`;
        expect(rows).toHaveLength(6);
        expect(
          rows.every((row) => row.tenant_id === fixture.id && fixture.companies.includes(String(row.company_id))),
        ).toBe(true);
      });
    await expect(
      scope(
        app,
        current.id,
        (tx) =>
          tx`insert into user_company_memberships(tenant_id,user_id,company_id,roles) values(${foreign.id},${foreign.users[0]?.id ?? ''},${foreign.companies[0] ?? ''},'[]'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const [policy] =
      await owner.sql`select relrowsecurity,relforcerowsecurity from pg_class where oid='user_company_memberships'::regclass`;
    expect(policy).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('rolls back the entire migration for malformed legacy role JSON, then succeeds after an explicit source correction', async () => {
    const fixtures = await historicalFixture();
    const fixture = fixtures[1];
    expect(fixture).toBeTruthy();
    if (!fixture) throw new Error('fixture missing');
    const user = fixture.users[1];
    if (!user) throw new Error('user missing');
    await scope(owner, fixture.id, (tx) => tx`update users set roles='{"admin":true}'::jsonb where id=${user.id}`);
    const before = await originalFacts(fixtures);
    await expect(runMigrations(owner, MIGRATIONS_DIR)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('Legacy user roles must be a JSON array') },
    });
    expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(9);
    expect(
      (await owner.sql`select to_regclass('public.user_company_memberships') as membership`)[0]?.membership,
    ).toBeNull();
    expect(
      (
        await owner.sql`select count(*)::int n from information_schema.columns where table_name='users' and column_name='tenant_admin'`
      )[0]?.n,
    ).toBe(0);
    expect(await originalFacts(fixtures)).toEqual(before);
    await scope(
      owner,
      fixture.id,
      (tx) => tx`update users set roles=${JSON.stringify(user.roles)}::jsonb where id=${user.id}`,
    );
    await runMigrations(owner, MIGRATIONS_DIR);
    expect(
      await scope(
        owner,
        fixture.id,
        async (tx) =>
          (await tx`select count(*)::int n from user_company_memberships where tenant_id=${fixture.id}`)[0]?.n,
      ),
    ).toBe(6);
  });
});
