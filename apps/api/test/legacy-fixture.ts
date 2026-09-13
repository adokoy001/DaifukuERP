// Real pre-refresh schema/data fixture. No current repository hooks or generated defaults are used.
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, newId, systemParams, withContext, type Database } from '@daifuku/kernel';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { modules } from '../src/modules.ts';
import { DEMO_TENANT, type SeedResult } from '../src/db/reset.ts';
import { MIGRATIONS_DIR, readJournal } from '../src/db/migrations.ts';

export function legacyMigrationFolder(lastIndex = 6): string {
  const dir = mkdtempSync(join(tmpdir(), 'daifuku-legacy-migration-'));
  const journal = readJournal();
  const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
  mkdirSync(join(dir, 'meta'));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  return dir;
}

export async function seedLegacy(owner: Database, dir: string) {
  await migrate(owner.drizzle, { migrationsFolder: dir });
  const tenant = newId();
  const company = newId();
  const otherCompany = newId();
  const partner = newId();
  const account = newId();
  const entry = newId();
  const revenue = newId();
  const invoice = newId();
  const unknownInvoice = newId();
  const line = newId();
  const payment = newId();
  await owner.sql`insert into tenants (id,name) values (${tenant},'Migration fixture')`;
  await owner.sql`insert into companies (id,tenant_id,code,name) values (${company},${tenant},'OLD','Original'), (${otherCompany},${tenant},'OTHER','Other')`;
  await owner.sql`insert into partner (id,tenant_id,company_id,name,is_customer) values (${partner},${tenant},${company},'Old customer',true)`;
  await owner.sql`insert into account (id,tenant_id,company_id,code,name,type) values (${account},${tenant},${company},'110','Original control account','asset')`;
  await owner.sql`insert into account (id,tenant_id,company_id,code,name,type) values (${revenue},${tenant},${company},'410','Revenue','revenue')`;
  await owner.sql`insert into journal_entry (id,tenant_id,company_id,docstatus,date,total_debit,total_credit,source_entity,source_id) values (${entry},${tenant},${company},1,'2026-03-31',1000,1000,'sales_invoice',${invoice})`;
  await owner.sql`insert into journal_line (id,tenant_id,company_id,entry_id,account_id,partner_id,debit,credit,posted,entry_date) values (${newId()},${tenant},${company},${entry},${account},${partner},1000,0,true,'2026-03-31')`;
  await owner.sql`insert into journal_line (id,tenant_id,company_id,entry_id,account_id,seq,debit,credit,posted,entry_date) values (${newId()},${tenant},${company},${entry},${revenue},2,0,1000,true,'2026-03-31')`;
  await owner.sql`insert into sales_invoice (id,tenant_id,company_id,partner_id,date,docstatus,total,paid_amount,balance,status,tax_summary,journal_entry_id) values
    (${invoice},${tenant},${company},${partner},'2026-03-31',1,1000,100,900,'open','[]',${entry}),
    (${unknownInvoice},${tenant},${company},${partner},'2026-03-31',1,1000,50,950,'open','[]',null)`;
  await owner.sql`insert into sales_invoice_line (id,tenant_id,company_id,invoice_id,description,unit_price,tax_category,amount) values (${line},${tenant},${company},${invoice},'Preserved description',1000,'exempt',1000)`;
  await owner.sql`insert into payment (id,tenant_id,company_id,direction,partner_id,date,amount,account_id,docstatus,allocated_amount,unallocated_amount) values (${payment},${tenant},${company},'receive',${partner},'2026-04-10',100,${account},1,100,0)`;
  await owner.sql`insert into payment_allocation (id,tenant_id,company_id,payment_id,invoice_entity,invoice_id,amount) values (${newId()},${tenant},${company},${payment},'sales_invoice',${invoice},100)`;
  return { tenant, company, otherCompany, partner, account, entry, invoice, unknownInvoice, line, payment };
}

/** Historical Demo identity: do not call the current bootstrap against a pre-membership schema. */
export async function seedLegacyDemo(owner: Database): Promise<SeedResult> {
  const tenantId = newId();
  const companyId = newId();
  const userId = newId();
  await owner.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`insert into tenants (id, name) values (${tenantId}, ${DEMO_TENANT.tenantName})`;
    await tx`insert into companies (id, tenant_id, code, name) values (${companyId}, ${tenantId}, ${DEMO_TENANT.companyCode}, ${DEMO_TENANT.companyName})`;
    await tx`insert into users (id, tenant_id, email, name, password_hash, roles, default_company_id) values (${userId}, ${tenantId}, ${DEMO_TENANT.adminEmail}, ${DEMO_TENANT.adminName}, ${await hashPassword(DEMO_TENANT.adminPassword)}, '["admin"]'::jsonb, ${companyId})`;
  });
  const seededModules: string[] = [];
  // Only modules that existed in the historical fixture may seed its pre-workforce schema.
  const historicalSeeds = new Set(['partner', 'product', 'tax', 'accounting', 'inventory', 'l10n_jp']);
  for (const module of modules)
    if (module.seed && historicalSeeds.has(module.name)) {
      await withContext(owner, systemParams(tenantId, companyId), async (ctx) => module.seed?.(ctx));
      seededModules.push(module.name);
    }
  return { tenantId, companyId, userId, seededModules };
}
