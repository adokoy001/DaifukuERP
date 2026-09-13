import { rmSync } from 'node:fs';
import { connect, dropAll, repo, runMigrations, systemParams, withContext, type LocalDate } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { SalesInvoice, applyPayment, invoiceBalancesAsOf } from '@daifuku/mod-sales';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import '../src/modules.ts';
import { MIGRATIONS_DIR, readJournal } from '../src/db/migrations.ts';
import { legacyMigrationFolder, seedLegacy } from './legacy-fixture.ts';

const owner = connect(OWNER_URL, { max: 1 });
const app = connect(APP_URL, { max: 1 });
const legacy = legacyMigrationFolder();
beforeEach(async () => {
  await dropAll(owner);
});
afterAll(async () => {
  await app.close();
  await owner.close();
  rmSync(legacy, { recursive: true, force: true });
});

describe('foundation-refresh AC-3 populated schema upgrade', () => {
  it('preserves original data and only backfills facts supported by original documents', async () => {
    const ids = await seedLegacy(owner, legacy);
    await runMigrations(owner, MIGRATIONS_DIR);
    await runMigrations(owner, MIGRATIONS_DIR);
    const [invoice] =
      await owner.sql`select total, paid_amount, balance, control_account_id, issued_snapshot, settlement_history from sales_invoice where id=${ids.invoice}`;
    expect(invoice).toMatchObject({
      total: '1000.000000',
      paid_amount: '100.000000',
      balance: '900.000000',
      control_account_id: ids.account,
      issued_snapshot: null,
      settlement_history: true,
    });
    const [line] = await owner.sql`select description, amount from sales_invoice_line where id=${ids.line}`;
    expect(line).toMatchObject({ description: 'Preserved description', amount: '1000.000000' });
    const settlements =
      await owner.sql`select date::text, amount from sales_settlement where invoice_id=${ids.invoice}`;
    expect(settlements).toEqual([{ date: '2026-04-10', amount: '100.000000' }]);
    const [unknown] =
      await owner.sql`select paid_amount, balance, settlement_history, issued_snapshot from sales_invoice where id=${ids.unknownInvoice}`;
    expect(unknown).toMatchObject({
      paid_amount: '50.000000',
      balance: '950.000000',
      settlement_history: false,
      issued_snapshot: null,
    });
    await withContext(app, systemParams(ids.tenant, ids.company), async (ctx) => {
      const row = await repo(ctx, SalesInvoice).get(ids.invoice);
      expect((await invoiceBalancesAsOf(ctx, [row], '2026-03-31' as LocalDate)).get(row.id)?.toString()).toBe('1000');
      expect((await invoiceBalancesAsOf(ctx, [row], '2026-04-30' as LocalDate)).get(row.id)?.toString()).toBe('900');
      const missingHistory = await repo(ctx, SalesInvoice).get(ids.unknownInvoice);
      await expect(invoiceBalancesAsOf(ctx, [missingHistory], '2026-03-31' as LocalDate)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });
    const [count] = await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`;
    expect(count?.n).toBe(readJournal().entries.length);
  });

  it('rejects a pre-existing cross-company reference atomically and succeeds after the explicit correction', async () => {
    const ids = await seedLegacy(owner, legacy);
    await owner.sql`update partner set company_id=${ids.otherCompany} where id=${ids.partner}`;
    await expect(runMigrations(owner, MIGRATIONS_DIR)).rejects.toThrow();
    const [count] = await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`;
    expect(count?.n).toBe(7);
    const [table] = await owner.sql`select to_regclass('public.sales_settlement')::text name`;
    expect(table?.name).toBeNull();
    const [preserved] = await owner.sql`select count(*)::int n from sales_invoice`;
    expect(preserved?.n).toBe(2);
    await owner.sql`update partner set company_id=${ids.company} where id=${ids.partner}`;
    await runMigrations(owner, MIGRATIONS_DIR);
  });

  it('does not relabel an existing non-JPY invoice or payment as yen', async () => {
    const ids = await seedLegacy(owner, legacy);
    await owner.sql`update companies set currency='USD' where id=${ids.company}`;
    await expect(runMigrations(owner, MIGRATIONS_DIR)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('non-JPY financial records') },
    });
    const [count] = await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`;
    expect(count?.n).toBe(7);
    const [company] = await owner.sql`select currency from companies where id=${ids.company}`;
    expect(company?.currency).toBe('USD');
    const [invoice] = await owner.sql`select total, paid_amount from sales_invoice where id=${ids.invoice}`;
    expect(invoice).toMatchObject({ total: '1000.000000', paid_amount: '100.000000' });
    const [column] =
      await owner.sql`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='sales_invoice' and column_name='currency'`;
    expect(column?.n).toBe(0);
  });

  it('does not treat an unknown zero balance history as a verified empty history', async () => {
    const ids = await seedLegacy(owner, legacy);
    // Legacy direct header changes could disagree with surviving payment allocations.
    await owner.sql`update sales_invoice set paid_amount=0,balance=1000 where id=${ids.invoice}`;
    await runMigrations(owner, MIGRATIONS_DIR);
    await withContext(app, systemParams(ids.tenant, ids.company), async (ctx) => {
      const row = await repo(ctx, SalesInvoice).get(ids.invoice);
      expect(row.settlementHistory).toBe(false);
      await expect(invoiceBalancesAsOf(ctx, [row], '2026-04-30' as LocalDate)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
      await expect(
        applyPayment(ctx, { invoiceId: row.id, amount: '50', date: '2026-04-15' as LocalDate }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
    const [invoice] = await owner.sql`select paid_amount,settlement_history from sales_invoice where id=${ids.invoice}`;
    expect(invoice).toMatchObject({ paid_amount: '0.000000', settlement_history: false });
  });
});
