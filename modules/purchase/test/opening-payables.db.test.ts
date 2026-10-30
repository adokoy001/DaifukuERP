// Postgres tests for docs/specs/opening-balances.md — opening payables (AC-6, AC-7, AC-15..AC-19, AC-21, AC-22, AC-26,
// AC-27, D-8, D-14, D-16). The receivable half shares the accounting implementation and is covered in depth by
// modules/sales/test/opening-receivables.db.test.ts; this file proves the purchase specifics. Test DB: TEST_DATABASE_URL*.
import {
  companies,
  newId,
  PermissionDenied,
  registerCrudActions,
  repo,
  runAction,
  setSetting,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import {
  Account,
  JournalEntry,
  JournalLine,
  openingImportResult,
  type OpeningImportResult,
} from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { seedUoms } from '@daifuku/mod-product';
import { seedTaxRates } from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PURCHASE_ACCOUNTS_KEY, PurchaseInvoice, PurchaseInvoiceLine, purchaseAccountsSchema } from '../src/index.ts';

const NOW = new Date('2026-04-10T03:00:00Z');
let db: TestDb;
let fyId: string;
const acc: Record<string, string> = {};
const partner: Record<string, string> = {};

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
type Row = Partial<Record<'partnerCode' | 'amount' | 'dueDate' | 'reference' | 'originalDate' | 'memo', string | null>>;
const importAp = (
  rows: Row[],
  mode: 'dry-run' | 'execute' = 'execute',
  params: Partial<ContextParams> = {},
): Promise<OpeningImportResult> =>
  run(params, async (ctx) =>
    openingImportResult.parse(
      await runAction(ctx, 'purchase.import_opening_payables', { fiscalYearId: fyId, mode, rows }),
    ),
  );
const bills = (partnerId?: string) =>
  run({}, (ctx) =>
    repo(ctx, PurchaseInvoice).list({
      where: { openingBalance: true, ...(partnerId ? { partnerId } : {}) },
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      limit: 500,
    }),
  );
const codesOf = (r: OpeningImportResult) => r.rows.map((row) => row.messages?.[0]?.code ?? row.status);

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => NOW }), async (ctx) => {
    await seedUoms(ctx);
    await seedTaxRates(ctx);
  });
  fyId = (
    (await run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-04-01' }))) as {
      fiscalYear: { id: string };
    }
  ).fiscalYear.id;
  for (const [code, name, type, extra] of [
    ['1000', '現金', 'asset', {}],
    ['1500', '仮払消費税', 'asset', { taxRole: 'input_tax' }],
    ['2100', '買掛金', 'liability', { partnerRequired: true }],
    ['5000', '仕入高', 'expense', {}],
    ['3900', '期首残高仮勘定', 'equity', {}],
  ] as const)
    acc[code] = (await run({}, (ctx) => repo(ctx, Account).create({ code, name, type, ...extra }))).id;
  for (const [code, name, extra] of [
    ['S001', '仕入先A', {}],
    ['S002', '免税の仕入先', { taxStatus: 'exempt' }],
  ] as const)
    partner[code] = (
      await run({}, (ctx) =>
        repo(ctx, Partner).create({
          code,
          name,
          isSupplier: true,
          closingDay: 20,
          paymentMonthOffset: 1,
          paymentDay: 10,
          ...extra,
        }),
      )
    ).id;
});
afterAll(async () => {
  await db?.close();
});

describe('opening payables', () => {
  it('AC-6: accounting alone and purchasing alone get 403; accounting + purchasing passes', async () => {
    const row = [{ partnerCode: 'S001', amount: '1000' }];
    for (const roles of [['accounting'], ['purchasing'], ['accounting', 'sales']])
      expect(await caught(importAp(row, 'dry-run', asRole(roles)))).toBeInstanceOf(PermissionDenied);
    expect((await importAp(row, 'dry-run', asRole(['accounting', 'purchasing']))).summary.errors).toBe(0);
  });

  it('AC-15 AC-26: invalid rows are classified and keep the execute from writing', async () => {
    const result = await importAp([
      { partnerCode: 'S001', amount: '1000' },
      { partnerCode: 'S001', amount: '-1' },
      { partnerCode: '$ctx.userId', amount: '1' },
      { partnerCode: 'S001', amount: '1', originalDate: '2026/4/1' },
    ]);
    expect(codesOf(result)).toEqual(['ok', 'negative_amount', 'invalid_value', 'invalid_value']);
    expect(result.committed).toBe(false);
    expect((await bills()).total).toBe(0);
  });

  it('D-16: missing purchase posting accounts refuse the whole request', async () => {
    await run({}, (ctx) =>
      setSetting(ctx, PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema, {
        purchases: '5000',
        payable: '9999',
        taxReceivable: '1500',
      }),
    );
    expect(await caught(importAp([{ partnerCode: 'S001', amount: '1' }], 'dry-run'))).toMatchObject({
      code: 'INVALID_STATE',
    });
    await run({}, (ctx) =>
      setSetting(ctx, PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema, {
        purchases: '5000',
        payable: '2100',
        taxReceivable: '1500',
      }),
    );
  });

  it('AC-16 AC-17 AC-27: one opening bill per row: clearing / payable on the opening date, no tax even for exempt suppliers', async () => {
    const result = await importAp([
      { partnerCode: 'S001', amount: '80000', reference: 'B-77', originalDate: '2026-03-15', memo: '3月分' },
      { partnerCode: '免税の仕入先', amount: '20000', dueDate: '2026-05-10' },
    ]);
    expect(result).toMatchObject({ committed: true, totals: { amount: '100000' } });
    expect(result.clearingBalance).toEqual({ before: '0', after: '100000' });
    const items = (await bills()).items;
    expect(
      items.map((b) => [
        b.date,
        b.dueDate,
        b.total.toString(),
        b.taxTotal.toString(),
        b.nonDeductibleTax.toString(),
        b.status,
        b.supplierInvoiceNo,
      ]),
    ).toEqual([
      // closing day 20: 2026-03-15 closes 2026-03-20, paid the 10th of the next month
      ['2026-03-31', '2026-04-10', '80000', '0', '0', 'open', 'B-77'],
      ['2026-03-31', '2026-05-10', '20000', '0', '0', 'open', null],
    ]);
    expect(items[0]?.number).toMatch(/^BILL-2026-/);
    expect(items[0]?.note).toBe('期首残高 元請求日 2026-03-15 3月分');
    const line = (
      await run({}, (ctx) => repo(ctx, PurchaseInvoiceLine).list({ where: { invoiceId: items[0]?.id as string } }))
    ).items[0];
    expect(line).toMatchObject({ accountId: acc['3900'], taxCategory: 'out_of_scope', productId: null });
    const journal = await run({}, async (ctx) => {
      const entry = await repo(ctx, JournalEntry).get(items[0]?.journalEntryId as string);
      const jl = await repo(ctx, JournalLine).list({
        where: { entryId: entry.id },
        orderBy: [{ field: 'seq', dir: 'asc' }],
      });
      return {
        date: entry.date,
        lines: jl.items.map((l) => [l.accountId, l.debit.toString(), l.credit.toString(), l.partnerId]),
      };
    });
    expect(journal.date).toBe('2026-03-31');
    expect(journal.lines).toEqual([
      [acc['3900'], '80000', '0', null],
      [acc['2100'], '0', '80000', partner.S001],
    ]);
  });

  it('AC-22: opening bills appear in AP aging and take payments', async () => {
    const aging = (await run({}, (ctx) => runAction(ctx, 'purchase.ap_aging', { asOf: '2026-04-20' }))) as {
      rows: Record<string, string>[];
    };
    const byName = Object.fromEntries(aging.rows.map((r) => [r.partnerName, r]));
    expect(byName['仕入先A']).toMatchObject({ balance: '80000', days1to30: '80000' });
    expect(byName['免税の仕入先']).toMatchObject({ balance: '20000', notDue: '20000' });
    const id = (await bills(partner.S001)).items[0]?.id as string;
    await run({}, (ctx) =>
      runAction(ctx, 'purchase.record_payment', { invoiceId: id, amount: '80000', date: '2026-04-10' }),
    );
    expect((await run({}, (ctx) => repo(ctx, PurchaseInvoice).get(id))).status).toBe('paid');
  });

  it('AC-18 AC-19 D-8: exists for a live bill; cancel on the opening date re-opens the partner; an in-year cancel blocks it', async () => {
    expect(codesOf(await importAp([{ partnerCode: 'S002', amount: '1' }], 'dry-run'))).toEqual(['exists']);
    const bill = (await bills(partner.S002)).items[0] as { id: string };
    await run({}, (ctx) => runAction(ctx, 'purchase_invoice.cancel', { id: bill.id }));
    expect((await run({}, (ctx) => repo(ctx, PurchaseInvoice).get(bill.id))).cancelledDate).toBe('2026-03-31');
    expect((await importAp([{ partnerCode: 'S002', amount: '25000' }])).committed).toBe(true);
    const fresh = (await bills(partner.S002)).items.find((b) => b.docstatus === 1) as { id: string };
    await run({}, (ctx) => runAction(ctx, 'purchase_invoice.cancel', { id: fresh.id, correctionDate: '2026-04-30' }));
    expect(codesOf(await importAp([{ partnerCode: 'S002', amount: '25000' }], 'dry-run'))).toEqual([
      'cancelled_in_year',
    ]);
    const amended = (await run({}, (ctx) => runAction(ctx, 'purchase_invoice.amend', { id: fresh.id }))) as {
      id: string;
    };
    const err = await caught(run({}, (ctx) => runAction(ctx, 'purchase_invoice.submit', { id: amended.id })));
    expect(JSON.stringify((err as { details?: unknown }).details)).toContain('opening_amend');
  });

  it('AC-21: the generic create cannot set openingBalance', async () => {
    const err = await caught(
      run({}, (ctx) => runAction(ctx, 'purchase_invoice.create', { partnerId: partner.S001, openingBalance: true })),
    );
    expect(String((err as PermissionDenied).details?.op)).toContain('server-owned:openingBalance');
  });

  it('AC-7: a supplier code of another company is ref_not_found', async () => {
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'APX', name: '別会社' });
    await run({ companyId: otherCompanyId }, (ctx) =>
      repo(ctx, Partner).create({ code: 'X800', name: '他社', isSupplier: true }),
    );
    expect(codesOf(await importAp([{ partnerCode: 'X800', amount: '1' }], 'dry-run'))).toEqual(['ref_not_found']);
  });

  it('D-14 AC-18: two concurrent imports for the same supplier create exactly one opening bill', async () => {
    const id = (await run({}, (ctx) => repo(ctx, Partner).create({ code: 'S010', name: '同時', isSupplier: true }))).id;
    const settled = await Promise.allSettled([
      importAp([{ partnerCode: 'S010', amount: '500' }]),
      importAp([{ partnerCode: 'S010', amount: '500' }]),
    ]);
    const values = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    expect(values.filter((v) => v.committed)).toHaveLength(1);
    expect(values.find((v) => !v.committed)?.rows[0]?.messages?.[0]?.code).toBe('exists');
    expect((await bills(id)).total).toBe(1);
  });
});
