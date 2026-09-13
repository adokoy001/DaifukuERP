import { rmSync } from 'node:fs';
import { connect, dropAll, hashPassword, newId, runMigrations } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import '../src/modules.ts';
import { MIGRATIONS_DIR, readJournal } from '../src/db/migrations.ts';
import { legacyMigrationFolder } from './legacy-fixture.ts';

const owner = connect(OWNER_URL, { max: 1 });
const app = connect(APP_URL, { max: 1 });
const previous = legacyMigrationFolder(13);
const tenant = newId();
const company = newId();
const user = newId();
const partner = newId();
const account = newId();
const invoice = newId();
const payment = newId();
const site = newId();
const gateway = newId();
const newTables = [
  'trade_quotation',
  'trade_quotation_line',
  'trade_order',
  'trade_order_line',
  'trade_fulfillment',
  'trade_fulfillment_line',
  'trade_billing',
  'trade_billing_line',
  'bank_account',
  'bank_payee',
  'bank_import',
  'bank_statement',
  'bank_reconciliation',
  'bank_transfer',
  'bank_transfer_reservation',
  'filing_accounting_profile',
  'filing_payroll_profile',
  'filing_accounting_pack',
  'filing_payroll_pack',
];
beforeAll(async () => {
  await dropAll(owner);
  await migrate(owner.drizzle, { migrationsFolder: previous });
  await owner.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenant},true)`;
    await tx`insert into tenants(id,name) values(${tenant},'Existing finance tenant')`;
    await tx`insert into companies(id,tenant_id,code,name,settings) values(${company},${tenant},'KEEP','Existing finance company','{"preserve":"original"}')`;
    await tx`insert into users(id,tenant_id,email,name,password_hash,roles,default_company_id,session_version,mfa_enabled) values(${user},${tenant},'finance-legacy@example.invalid','Existing accountant',${await hashPassword('Synthetic-LegacyFinance-2026')},'[]',${company},9,1)`;
    await tx`insert into identity_factors(user_id,tenant_id,secret_cipher,recovery_hashes) values(${user},${tenant},'synthetic-sealed-existing','["synthetic-existing-hash"]')`;
    await tx`insert into user_company_memberships(tenant_id,user_id,company_id,roles,access_scope,version) values(${tenant},${user},${company},'["accounting"]','all',4)`;
    await tx`insert into partner(id,tenant_id,company_id,name) values(${partner},${tenant},${company},'Existing customer')`;
    await tx`insert into account(id,tenant_id,company_id,code,name,type) values(${account},${tenant},${company},'OLD-BANK','Existing bank account','asset')`;
    await tx`insert into sales_invoice(id,tenant_id,company_id,partner_id,tax_summary,docstatus,number,total,paid_amount,balance,status) values(${invoice},${tenant},${company},${partner},'[]',1,'OLD-INV-001',11000,4000,7000,'open')`;
    await tx`insert into payment(id,tenant_id,company_id,direction,partner_id,amount,account_id,docstatus,number,allocated_amount,unallocated_amount) values(${payment},${tenant},${company},'receive',${partner},4000,${account},1,'OLD-PAY-001',4000,0)`;
    await tx`insert into workforce_site(id,tenant_id,company_id,code,name) values(${site},${tenant},${company},'OLD-SITE','Existing site')`;
    await tx`insert into edge_gateway(id,tenant_id,company_id,site_id,code,name) values(${gateway},${tenant},${company},${site},'OLD-RELAY','Existing relay')`;
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
      users: await tx`select * from users`,
      memberships: await tx`select * from user_company_memberships`,
      factors: await tx`select * from identity_factors`,
      companies: await tx`select * from companies`,
      invoices: await tx`select * from sales_invoice`,
      payments: await tx`select * from payment`,
      gateways: await tx`select * from edge_gateway`,
    };
  });
it('upgrades populated 0013 without changing invoices, payment facts, MFA or registered relays', async () => {
  const before = await facts();
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
  for (const table of newTables) {
    expect(
      (await owner.sql`select relrowsecurity,relforcerowsecurity from pg_class where relname=${table}`)[0],
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(
      (
        await app.sql.begin(async (tx) => {
          await tx`select set_config('app.tenant_id',${tenant},true)`;
          return tx`select count(*)::int n from ${tx(table)}`;
        })
      )[0]?.n,
    ).toBe(0);
  }
  await runMigrations(owner, MIGRATIONS_DIR);
  expect(await facts()).toEqual(before);
  expect((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0]?.n).toBe(
    readJournal().entries.length,
  );
});
