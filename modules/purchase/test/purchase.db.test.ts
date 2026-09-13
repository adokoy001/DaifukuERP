// Postgres tests for docs/specs/purchase.md AC-1..AC-8. Test DB: daifuku_test_purchase (TEST_DATABASE_URL*).
// Dependencies (partner, product, tax, accounting) are registered by importing the module; their seeds run here.
import {
  Decimal,
  PermissionDenied,
  StateError,
  ValidationError,
  appMeta,
  newId,
  registerCrudActions,
  registry,
  repo,
  runAction,
  setSetting,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, JournalEntry, JournalLine, openFiscalYear, tableResult } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { Product, seedUoms } from '@daifuku/mod-product';
import { seedTaxRates } from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NON_DEDUCTIBLE_MEMO,
  PAID_CANCEL_HINT,
  PAYMENT_APPLIED_EVENT,
  PURCHASE_ACCOUNTS_KEY,
  PURCHASE_CREDIT_RATIO_POINT,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchaseModule,
  applyPayment,
  defaultCreditRatio,
  purchaseAccountsSchema,
  type CreditRatioFn,
} from '../src/index.ts';
import { golden } from './golden.ts';

type Row = Record<string, unknown>;
type LineJson = Row & {
  id: string;
  seq: number;
  productId: string | null;
  accountId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  taxCategory: string;
  amount: string;
};
type BillJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  date: string;
  dueDate: string | null;
  status: string;
  supplierTaxStatus: string;
  creditRatio: string;
  subtotal: string;
  taxTotal: string;
  deductibleTax: string;
  nonDeductibleTax: string;
  total: string;
  paidAmount: string;
  balance: string;
  journalEntryId: string | null;
  taxSummary: { groups: Row[]; totals: Row; creditRatio: string } | null;
  version: number;
};
type BillWithLines = BillJson & { lines: { purchase_invoice_line: LineJson[] } };
type Table = {
  title: { ja: string; en: string };
  columns: { key: string; kind: string }[];
  rows: Row[];
  totals?: Record<string, string>;
  meta?: Row;
};

/** 2026-09-10 12:00 JST: `date` defaults and report defaults derive "today" from ctx.now(). */
const FIXED_NOW = new Date('2026-09-10T03:00:00Z');
let db: TestDb;
let acc: Record<'purchases' | 'inputTax' | 'payable' | 'supplies' | 'misc', string>;
let codeOf: Map<string, string>;
let supplier: { registered: string; exempt: string };
let product: { goods: string; food: string };

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => FIXED_NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const purchasing = asRole(['purchasing']);
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const totalsOf = (b: BillJson) => ({
  subtotal: b.subtotal,
  taxTotal: b.taxTotal,
  deductibleTax: b.deductibleTax,
  nonDeductibleTax: b.nonDeductibleTax,
  total: b.total,
});

async function getBill(ctx: Context, id: string): Promise<BillWithLines> {
  return (await runAction(ctx, 'purchase_invoice.get', { id })) as BillWithLines;
}
/**
 * Creates through the generic action, then re-reads: the kernel's <entity>.create returns the header as it was saved
 * BEFORE its lines (the line hooks recompute the header afterwards), so the create response carries zero totals — a
 * kernel gap recorded in docs/log/2026-09-11-purchase.md. The stored row is what the tests assert on.
 */
async function createBill(ctx: Context, head: Row, lines: Row[]): Promise<BillWithLines> {
  const created = (await runAction(ctx, 'purchase_invoice.create', {
    ...head,
    lines: { purchase_invoice_line: lines },
  })) as BillWithLines;
  return getBill(ctx, created.id);
}
async function submit(ctx: Context, id: string): Promise<BillJson> {
  return (await runAction(ctx, 'purchase_invoice.submit', { id })) as BillJson;
}
/** Journal lines of an entry as [code, debit, credit, memo, partnerId]. */
async function entryLines(ctx: Context, entryId: string): Promise<(string | null)[][]> {
  const lines = await repo(ctx, JournalLine).list({
    where: { entryId },
    orderBy: [{ field: 'seq', dir: 'asc' }],
    limit: 100,
  });
  return lines.items.map((l) => [
    codeOf.get(l.accountId) ?? l.accountId,
    l.debit.toString(),
    l.credit.toString(),
    l.memo,
    l.partnerId,
  ]);
}
/** Σdebit − Σcredit per account code over posted lines. */
async function netByCode(ctx: Context): Promise<Record<string, string>> {
  const rows = await repo(ctx, JournalLine).aggregate({
    where: { posted: true },
    groupBy: ['accountId'],
    metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } },
  });
  return Object.fromEntries(
    rows.map((r) => [
      codeOf.get(String(r.accountId)) ?? String(r.accountId),
      (r.debit as Decimal).minus(r.credit as Decimal).toString(),
    ]),
  );
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run({}, async (ctx) => {
    await seedUoms(ctx);
    await seedTaxRates(ctx);
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
  });
  const account = (code: string, name: string, type: 'asset' | 'liability' | 'expense', extra: Row = {}) =>
    run({}, async (ctx) => (await repo(ctx, Account).create({ code, name, type, ...extra })).id);
  acc = {
    purchases: await account('5000', '仕入高', 'expense', { subtype: '仕入' }),
    inputTax: await account('1500', '仮払消費税', 'asset', { subtype: '仮払消費税' }),
    payable: await account('2100', '買掛金', 'liability', { subtype: '買掛金', partnerRequired: true }),
    supplies: await account('6400', '消耗品費', 'expense', { subtype: '販管費', taxCategoryDefault: 'standard' }),
    misc: await account('6500', '雑費', 'expense', { subtype: '販管費' }),
  };
  codeOf = new Map(Object.values(acc).map((id) => [id, ''] as [string, string]));
  for (const [k, code] of [
    ['purchases', '5000'],
    ['inputTax', '1500'],
    ['payable', '2100'],
    ['supplies', '6400'],
    ['misc', '6500'],
  ] as const)
    codeOf.set(acc[k], code);
  supplier = await run({}, async (ctx) => ({
    registered: (
      await repo(ctx, Partner).create({
        code: 'S-REG',
        name: '課税商事',
        isSupplier: true,
        taxStatus: 'registered',
        invoiceRegistrationNo: 'T1234567890123',
      })
    ).id,
    exempt: (
      await repo(ctx, Partner).create({
        code: 'S-EX',
        name: '免税工房',
        isSupplier: true,
        taxStatus: 'exempt',
        closingDay: 20,
        paymentMonthOffset: 1,
        paymentDay: 10,
      })
    ).id,
  }));
  product = await run({}, async (ctx) => ({
    goods: (
      await repo(ctx, Product).create({ code: 'G-1', name: '商品A', purchasePrice: '1000', taxCategory: 'standard' })
    ).id,
    food: (
      await repo(ctx, Product).create({ code: 'F-1', name: '食品B', purchasePrice: '540', taxCategory: 'reduced' })
    ).id,
  }));
});
afterAll(async () => {
  await db.close();
});

describe('purchase module (docs/specs/purchase.md)', () => {
  it('AC-1 purchase_invoice + lines: defaults (date=today JST, 税込, due date from terms, supplier status copied), line defaults from product/account, VALIDATION rules', async () => {
    const b = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.registered }, [
        { productId: product.goods },
        { accountId: acc.supplies, description: 'コピー用紙', quantity: '2', unitPrice: '550' },
      ]),
    );
    expect(b).toMatchObject({
      docstatus: 0,
      number: null,
      date: '2026-09-10',
      dueDate: '2026-10-31',
      priceIncludesTax: true,
      status: 'draft',
      supplierTaxStatus: 'registered',
      creditRatio: '1',
      paidAmount: '0',
      journalEntryId: null,
      supplierInvoiceNo: null,
    });
    expect(
      b.lines.purchase_invoice_line.map((l) => [
        l.seq,
        l.productId,
        l.accountId,
        l.description,
        l.quantity,
        l.unitPrice,
        l.taxCategory,
        l.amount,
      ]),
    ).toEqual([
      [1, product.goods, null, '商品A', '1', '1000', 'standard', '1000'],
      [2, null, acc.supplies, 'コピー用紙', '2', '550', 'standard', '1100'],
    ]);
    // 税込 2,100 at 10%: tax = round(2100 × 0.1 / 1.1) = 190 (190.9… 切捨て), taxable 1,910
    expect(totalsOf(b)).toEqual({
      subtotal: '1910',
      taxTotal: '190',
      deductibleTax: '190',
      nonDeductibleTax: '0',
      total: '2100',
    });
    expect(b.balance).toBe('2100');
    expect(b.taxSummary?.creditRatio).toBe('1');
    expect(b.taxSummary?.groups[0]).toMatchObject({
      category: 'standard',
      code: 'STD10',
      rate: '0.1',
      taxable: '1910',
      tax: '190',
      gross: '2100',
      lineCount: 2,
      deductibleTax: '190',
      nonDeductibleTax: '0',
    });
    // exempt supplier with its own terms: closing 20th → 2026-09-20, +1 month, day 10 → 2026-10-10; explicit due date kept
    const e = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.exempt, supplierInvoiceNo: 'K-77' }, [{ productId: product.goods }]),
    );
    expect(e).toMatchObject({ dueDate: '2026-10-10', supplierTaxStatus: 'exempt', supplierInvoiceNo: 'K-77' });
    const d = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.exempt, date: '2026-09-25', dueDate: '2026-12-31' }, [
        { productId: product.goods },
      ]),
    );
    expect(d.dueDate).toBe('2026-12-31');
    // neither product nor account; unknown partner; account without a default category and no taxCategory; invalid enum
    await expect(
      run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.registered }, [{ description: 'x', unitPrice: '1' }]),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'accountId' }] } });
    await expect(
      run(purchasing, (ctx) => createBill(ctx, { partnerId: newId() }, [{ productId: product.goods }])),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'partnerId' }] } });
    await expect(
      run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.registered }, [
          { accountId: acc.misc, description: 'x', unitPrice: '1' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'taxCategory' }] } });
    const misc = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.registered }, [
        { accountId: acc.misc, description: '雑', unitPrice: '300', taxCategory: 'out_of_scope' },
      ]),
    );
    expect(totalsOf(misc)).toEqual({
      subtotal: '300',
      taxTotal: '0',
      deductibleTax: '0',
      nonDeductibleTax: '0',
      total: '300',
    });
    await expect(
      run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.registered }, [{ productId: product.goods, taxCategory: 'vat' }]),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'taxCategory' }] } });
    await expect(
      run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.registered, date: '2026-13-01' }, [{ productId: product.goods }]),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'date' }] } });
    // system-owned fields while draft: status/paidAmount/balance/journalEntryId are forced
    await expect(
      run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.registered, status: 'paid', paidAmount: '999', balance: '1' }, [
          { productId: product.goods },
        ]),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    // AC-6: ops per role
    const ops = async (roles: string[]) =>
      run(asRole(roles), async (ctx) => appMeta(ctx).entities.find((x) => x.name === 'purchase_invoice')?.ops);
    expect(await ops(['purchasing'])).toEqual(['read', 'create', 'update', 'submit', 'cancel', 'amend']);
    expect(await ops(['accounting'])).toEqual(['read', 'update']);
    expect(await ops(['viewer'])).toEqual(['read']);
    await expect(
      run(asRole(['viewer']), (ctx) =>
        createBill(ctx, { partnerId: supplier.registered }, [{ productId: product.goods }]),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      run(asRole(['accounting']), (ctx) =>
        createBill(ctx, { partnerId: supplier.registered }, [{ productId: product.goods }]),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    expect((await run(asRole(['viewer']), (ctx) => getBill(ctx, b.id))).lines.purchase_invoice_line).toHaveLength(2);
    await expect(run(asRole(['nobody']), (ctx) => getBill(ctx, b.id))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-2 recalculation on every draft save: generic update (header before lines), direct line writes, header-only changes; exempt supplier defaults to ratio 0', async () => {
    const b = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.registered }, [
        { productId: product.goods, unitPrice: '11000' },
        { productId: product.food, quantity: '10', unitPrice: '540' },
      ]),
    );
    expect(totalsOf(b)).toEqual({
      subtotal: '15000',
      taxTotal: '1400',
      deductibleTax: '1400',
      nonDeductibleTax: '0',
      total: '16400',
    });
    // kernel-phase15 AC-7: create (version 1) + one re-save for both lines via after_lines_saved (was 1 + one per line = 3)
    expect(b.version).toBe(2);
    expect(b.taxSummary?.groups.map((g) => [g.category, g.taxable, g.tax])).toEqual([
      ['standard', '10000', '1000'],
      ['reduced', '5000', '400'],
    ]);
    // generic update with lines: the header is saved first (sees the old lines), the line hooks re-save it afterwards
    const line1 = b.lines.purchase_invoice_line[0]?.id ?? '';
    const u = (await run(purchasing, (ctx) =>
      runAction(ctx, 'purchase_invoice.update', {
        id: b.id,
        patch: {
          note: 'x',
          lines: { purchase_invoice_line: [{ id: line1, productId: product.goods, unitPrice: '2200' }] },
        },
      }),
    )) as BillWithLines;
    expect(u.lines.purchase_invoice_line.map((l) => [l.id, l.amount])).toEqual([[line1, '2200']]);
    // kernel-phase15 AC-7: header patch (+1) and one after_lines_saved re-save for the line update + delete (+1)
    expect(u.version).toBe(b.version + 2);
    expect(totalsOf(u)).toEqual({
      subtotal: '2000',
      taxTotal: '200',
      deductibleTax: '200',
      nonDeductibleTax: '0',
      total: '2200',
    });
    expect(u.balance).toBe('2200');
    expect(await run({}, (ctx) => repo(ctx, PurchaseInvoiceLine).count({ invoiceId: b.id }))).toBe(1);
    // header-only change: 税抜 → tax on top
    const h = (await run(purchasing, (ctx) =>
      runAction(ctx, 'purchase_invoice.update', { id: b.id, patch: { priceIncludesTax: false } }),
    )) as BillJson;
    expect(totalsOf(h)).toEqual({
      subtotal: '2200',
      taxTotal: '220',
      deductibleTax: '220',
      nonDeductibleTax: '0',
      total: '2420',
    });
    // direct line writes (not via saveLines) recompute the header too
    await run(purchasing, (ctx) => repo(ctx, PurchaseInvoiceLine).update(line1, { quantity: '3' }));
    expect(totalsOf(await run({}, (ctx) => getBill(ctx, b.id)))).toMatchObject({
      subtotal: '6600',
      taxTotal: '660',
      total: '7260',
    });
    const extra = await run(purchasing, (ctx) =>
      repo(ctx, PurchaseInvoiceLine).create({
        invoiceId: b.id,
        accountId: acc.supplies,
        description: '追加',
        unitPrice: '100',
      } as never),
    );
    expect(extra).toMatchObject({ seq: 1, taxCategory: 'standard', amount: Decimal.from('100') });
    expect((await run({}, (ctx) => getBill(ctx, b.id))).total).toBe('7370');
    await run(purchasing, (ctx) => repo(ctx, PurchaseInvoiceLine).delete(extra.id));
    expect((await run({}, (ctx) => getBill(ctx, b.id))).total).toBe('7260');
    // exempt supplier, no override registered: ratio 0 → nothing deductible (AC-8)
    const x = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.exempt, date: '2026-10-15' }, [
        { productId: product.goods, unitPrice: '11000' },
      ]),
    );
    expect(x).toMatchObject({ supplierTaxStatus: 'exempt', creditRatio: '0' });
    expect(totalsOf(x)).toEqual({
      subtotal: '10000',
      taxTotal: '1000',
      deductibleTax: '0',
      nonDeductibleTax: '1000',
      total: '11000',
    });
    // switching the partner re-copies the status/ratio and recomputes the due date
    const sw = (await run(purchasing, (ctx) =>
      runAction(ctx, 'purchase_invoice.update', { id: x.id, patch: { partnerId: supplier.registered } }),
    )) as BillJson;
    expect(sw).toMatchObject({
      supplierTaxStatus: 'registered',
      creditRatio: '1',
      deductibleTax: '1000',
      nonDeductibleTax: '0',
      dueDate: '2026-11-30',
    });
    // a date with no standard rate → VALIDATION from the tax module (rates are data)
    await expect(
      run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.registered, date: '2010-01-01' }, [{ productId: product.goods }]),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-7 golden: exempt supplier with a country-pack-style override (0.8 until 2026-09-30, 0.7 after) — totals, journal and re-dating; AC-3 posting', async () => {
    const override: CreditRatioFn = ({ supplierTaxStatus, date }) =>
      supplierTaxStatus === 'registered' ? Decimal.from(1) : Decimal.from(date >= '2026-10-01' ? '0.7' : '0.8');
    registry.registerOverride(PURCHASE_CREDIT_RATIO_POINT, override);
    try {
      const [oct, sep] = golden.cases;
      if (!oct || !sep) throw new Error('golden cases missing');
      const b = await run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.exempt, date: oct.date, supplierInvoiceNo: 'INV-EX-1' }, [
          { productId: product.goods, unitPrice: '11000' },
        ]),
      );
      expect(b).toMatchObject({ creditRatio: oct.creditRatio, supplierTaxStatus: 'exempt' });
      expect(totalsOf(b)).toEqual({
        subtotal: oct.expected.subtotal,
        taxTotal: oct.expected.taxTotal,
        deductibleTax: oct.expected.deductibleTax,
        nonDeductibleTax: oct.expected.nonDeductibleTax,
        total: oct.expected.total,
      });
      const s = await run(purchasing, (ctx) => submit(ctx, b.id));
      expect(s).toMatchObject({
        docstatus: 1,
        status: 'open',
        balance: '11000',
        paidAmount: '0',
        deductibleTax: '700',
        nonDeductibleTax: '300',
      });
      expect(s.number).toMatch(/^BILL-2026-\d{6}$/);
      expect(s.journalEntryId).toEqual(expect.any(String));
      const entry = await run({}, (ctx) => repo(ctx, JournalEntry).get(s.journalEntryId ?? ''));
      expect(entry).toMatchObject({
        docstatus: 1,
        date: oct.date,
        sourceEntity: 'purchase_invoice',
        sourceId: b.id,
        description: '仕入 免税工房 INV-EX-1',
      });
      expect(entry.totalDebit.toString()).toBe('11000');
      expect(await run({}, (ctx) => entryLines(ctx, entry.id))).toEqual([
        ['5000', '10000', '0', null, null],
        ['1500', '700', '0', '仮払消費税 標準10%', null],
        ['5000', '300', '0', NON_DEDUCTIBLE_MEMO, null],
        ['2100', '0', '11000', null, supplier.exempt],
      ]);
      expect(await run({}, (ctx) => entryLines(ctx, entry.id))).toEqual(
        oct.expected.journal.map((l) => [
          l.account,
          l.debit,
          l.credit,
          l.memo,
          l.account === '2100' ? supplier.exempt : null,
        ]),
      );
      // the same bill dated 2026-09-15 → 80%: re-dating a draft recomputes the ratio
      const b2 = await run(purchasing, (ctx) =>
        createBill(ctx, { partnerId: supplier.exempt, date: oct.date }, [
          { productId: product.goods, unitPrice: '11000' },
        ]),
      );
      const re = (await run(purchasing, (ctx) =>
        runAction(ctx, 'purchase_invoice.update', { id: b2.id, patch: { date: sep.date } }),
      )) as BillJson;
      expect(re).toMatchObject({ date: sep.date, creditRatio: sep.creditRatio, dueDate: '2026-10-10' });
      expect(totalsOf(re)).toEqual({
        subtotal: sep.expected.subtotal,
        taxTotal: sep.expected.taxTotal,
        deductibleTax: sep.expected.deductibleTax,
        nonDeductibleTax: sep.expected.nonDeductibleTax,
        total: sep.expected.total,
      });
      const s2 = await run(purchasing, (ctx) => submit(ctx, b2.id));
      expect(await run({}, (ctx) => entryLines(ctx, s2.journalEntryId ?? ''))).toEqual(
        sep.expected.journal.map((l) => [
          l.account,
          l.debit,
          l.credit,
          l.memo,
          l.account === '2100' ? supplier.exempt : null,
        ]),
      );
      expect(s2.number).not.toBe(s.number);
    } finally {
      registry.registerOverride(PURCHASE_CREDIT_RATIO_POINT, defaultCreditRatio);
    }
    // the default is back: exempt → 0
    const after = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.exempt, date: '2026-10-15' }, [{ productId: product.goods }]),
    );
    expect(after.creditRatio).toBe('0');
  });

  it('AC-3/AC-8 submit an expense bill (経費, account lines + product line): posting per account, 控除対象外 on the first line account, frozen after submit, failure leaves a draft', async () => {
    const b = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.exempt, date: '2026-10-20', priceIncludesTax: false }, [
        { accountId: acc.supplies, description: '文具', quantity: '4', unitPrice: '250' },
        { productId: product.goods, unitPrice: '3000' },
        { accountId: acc.misc, description: '手数料', unitPrice: '700', taxCategory: 'non_taxable' },
      ]),
    );
    expect(totalsOf(b)).toEqual({
      subtotal: '4700',
      taxTotal: '400',
      deductibleTax: '0',
      nonDeductibleTax: '400',
      total: '5100',
    });
    // no lines → VALIDATION; viewer/accounting cannot submit
    const empty = await run(purchasing, (ctx) => createBill(ctx, { partnerId: supplier.registered }, []));
    await expect(run(purchasing, (ctx) => submit(ctx, empty.id))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'lines' }] },
    });
    await expect(run(asRole(['viewer']), (ctx) => submit(ctx, b.id))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(asRole(['accounting']), (ctx) => submit(ctx, b.id))).rejects.toBeInstanceOf(PermissionDenied);
    // a missing posting account is INVALID_STATE naming the code; the bill stays a draft
    await run({}, (ctx) => setSetting(ctx, PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema, { payable: '9999' }));
    const missing = await caught(run(purchasing, (ctx) => submit(ctx, b.id)));
    expect(missing).toBeInstanceOf(StateError);
    expect(missing).toMatchObject({ code: 'INVALID_STATE', details: { code: '9999', role: 'payable' } });
    await run({}, (ctx) => setSetting(ctx, PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema, {}));
    // a date outside every fiscal period fails in accounting and leaves the draft
    const outside = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.registered, date: '2031-01-01' }, [{ productId: product.goods }]),
    );
    await expect(run(purchasing, (ctx) => submit(ctx, outside.id))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await run({}, (ctx) => getBill(ctx, outside.id))).toMatchObject({
      docstatus: 0,
      status: 'draft',
      journalEntryId: null,
    });
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceId: outside.id }))).toBe(0);
    const s = await run(purchasing, (ctx) => submit(ctx, b.id));
    expect(s).toMatchObject({ status: 'open', balance: '5100' });
    expect(await run({}, (ctx) => entryLines(ctx, s.journalEntryId ?? ''))).toEqual([
      ['6400', '1000', '0', null, null],
      ['5000', '3000', '0', null, null],
      ['6500', '700', '0', null, null],
      ['6400', '400', '0', NON_DEDUCTIBLE_MEMO, null],
      ['2100', '0', '5100', null, supplier.exempt],
    ]);
    // frozen: header fields, saveLines, direct line writes; allowOnSubmit fields still move (through applyPayment)
    await expect(
      run(purchasing, (ctx) => runAction(ctx, 'purchase_invoice.update', { id: b.id, patch: { date: '2026-10-21' } })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { blocked: ['date'] } });
    await expect(
      run(purchasing, (ctx) =>
        runAction(ctx, 'purchase_invoice.update', { id: b.id, patch: { lines: { purchase_invoice_line: [] } } }),
      ),
    ).rejects.toBeInstanceOf(StateError);
    const lineId = b.lines.purchase_invoice_line[0]?.id ?? '';
    await expect(
      run(purchasing, (ctx) => repo(ctx, PurchaseInvoiceLine).update(lineId, { unitPrice: '1' })),
    ).rejects.toBeInstanceOf(StateError);
    await expect(run(purchasing, (ctx) => repo(ctx, PurchaseInvoiceLine).delete(lineId))).rejects.toBeInstanceOf(
      StateError,
    );
    await expect(
      run(purchasing, (ctx) =>
        repo(ctx, PurchaseInvoiceLine).create({ invoiceId: b.id, productId: product.goods } as never),
      ),
    ).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => runAction(ctx, 'purchase_invoice.delete', { id: b.id }))).rejects.toBeInstanceOf(
      StateError,
    );
    expect(await run({}, (ctx) => repo(ctx, PurchaseInvoiceLine).count({ invoiceId: b.id }))).toBe(3);
    expect((await run({}, (ctx) => getBill(ctx, b.id))).total).toBe('5100');
  });

  it('AC-4 cancel: refused while paidAmount > 0; otherwise reverses the entry and sets cancelled; amend gives a fresh draft', async () => {
    const b = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.registered, date: '2026-10-05' }, [
        { productId: product.goods, unitPrice: '5500' },
      ]),
    );
    const before = await run({}, (ctx) => netByCode(ctx));
    const s = await run(purchasing, (ctx) => submit(ctx, b.id));
    expect(await run({}, (ctx) => netByCode(ctx))).not.toEqual(before);
    await run(purchasing, (ctx) => applyPayment(ctx, { invoiceId: b.id, amount: '500', date: '2026-10-06' }));
    const err = await caught(run(purchasing, (ctx) => runAction(ctx, 'purchase_invoice.cancel', { id: b.id })));
    expect(err).toBeInstanceOf(StateError);
    expect(err).toMatchObject({ code: 'INVALID_STATE', hint: PAID_CANCEL_HINT, details: { paidAmount: '500' } });
    expect(await run({}, (ctx) => getBill(ctx, b.id))).toMatchObject({ docstatus: 1, status: 'open' });
    await run(purchasing, (ctx) => applyPayment(ctx, { invoiceId: b.id, amount: '-500', date: '2026-10-06' }));
    await expect(
      run(asRole(['accounting']), (ctx) => runAction(ctx, 'purchase_invoice.cancel', { id: b.id })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const c = (await run(purchasing, (ctx) => runAction(ctx, 'purchase_invoice.cancel', { id: b.id }))) as BillJson;
    expect(c).toMatchObject({ docstatus: 2, status: 'cancelled', journalEntryId: s.journalEntryId, number: s.number });
    const reversal = await run({}, (ctx) =>
      repo(ctx, JournalEntry).list({ where: { reversalOf: s.journalEntryId ?? '' } }),
    );
    expect(reversal.items).toHaveLength(1);
    expect(reversal.items[0]).toMatchObject({ docstatus: 1, date: '2026-10-05' });
    const after = await run({}, (ctx) => netByCode(ctx));
    expect(after).toEqual(before);
    // cancelled bills take no payments and cannot be cancelled twice; amend copies the header as a new draft (lines are not copied by the kernel)
    await expect(
      run(purchasing, (ctx) => applyPayment(ctx, { invoiceId: b.id, amount: '1', date: '2026-10-07' })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(
      run(purchasing, (ctx) => runAction(ctx, 'purchase_invoice.cancel', { id: b.id })),
    ).rejects.toBeInstanceOf(StateError);
    const a = (await run(purchasing, (ctx) => runAction(ctx, 'purchase_invoice.amend', { id: b.id }))) as BillWithLines;
    // kernel amend copies the lines (ADR-0006): totals carry over, state fields are reset
    expect(a).toMatchObject({
      docstatus: 0,
      status: 'draft',
      amendedFrom: b.id,
      number: null,
      journalEntryId: null,
      paidAmount: '0',
      balance: '5500',
      total: '5500',
      partnerId: supplier.registered,
      date: '2026-10-05',
    });
    const a2 = (await run(purchasing, (ctx) =>
      runAction(ctx, 'purchase_invoice.update', {
        id: a.id,
        patch: { lines: { purchase_invoice_line: [{ productId: product.goods, unitPrice: '5500' }] } },
      }),
    )) as BillJson;
    expect(a2.total).toBe('5500');
    const s2 = await run(purchasing, (ctx) => submit(ctx, a.id));
    // ADR-0006: amended documents are numbered <original>-<n>
    expect(s2.number).toBe(`${s.number}-1`);
    expect(s2).toMatchObject({ docstatus: 1, status: 'open', balance: '5500', amendedFrom: b.id });
  });

  it('AC-5 record_payment / applyPayment: partial, full (paid), un-apply, overshoot VALIDATION, drafts INVALID_STATE, event, roles', async () => {
    // kernel-phase15 AC-9: record_payment is internal — still callable in-process (runAction below), not exposed by apps
    expect(registry.action('purchase.record_payment').internal).toBe(true);
    expect(registry.actions().map((a) => a.name)).not.toContain('purchase.record_payment');
    const b = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.registered, date: '2026-10-08' }, [
        { productId: product.goods, unitPrice: '3300' },
      ]),
    );
    await expect(
      run(purchasing, (ctx) =>
        runAction(ctx, 'purchase.record_payment', { invoiceId: b.id, amount: '100', date: '2026-10-09' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await run(purchasing, (ctx) => submit(ctx, b.id));
    const p1 = (await run(asRole(['accounting']), (ctx) =>
      runAction(ctx, 'purchase.record_payment', { invoiceId: b.id, amount: '1000', date: '2026-10-09' }),
    )) as BillJson;
    expect(p1).toMatchObject({ paidAmount: '1000', balance: '2300', status: 'open' });
    await expect(
      run(purchasing, (ctx) =>
        runAction(ctx, 'purchase.record_payment', { invoiceId: b.id, amount: '2301', date: '2026-10-09' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'amount' }] } });
    await expect(
      run(purchasing, (ctx) =>
        runAction(ctx, 'purchase.record_payment', { invoiceId: b.id, amount: '0', date: '2026-10-09' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      run(purchasing, (ctx) =>
        runAction(ctx, 'purchase.record_payment', { invoiceId: b.id, amount: '1', date: '2026-10-9' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      run(asRole(['viewer']), (ctx) =>
        runAction(ctx, 'purchase.record_payment', { invoiceId: b.id, amount: '1', date: '2026-10-09' }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const p2 = await run(purchasing, (ctx) =>
      applyPayment(ctx, { invoiceId: b.id, amount: Decimal.from('2300'), date: '2026-10-10' }),
    );
    expect(p2.status).toBe('paid');
    expect(p2.balance.toString()).toBe('0');
    expect(p2.paidAmount.toString()).toBe('3300');
    const p3 = await run(purchasing, (ctx) =>
      applyPayment(ctx, { invoiceId: b.id, amount: '-300', date: '2026-10-11' }),
    );
    expect(p3).toMatchObject({ status: 'open' });
    expect(p3.balance.toString()).toBe('300');
    const events = await db.owner.sql<
      { payload: Row }[]
    >`select payload from outbox where topic = ${PAYMENT_APPLIED_EVENT} and tenant_id = ${db.tenantId} order by created_at`;
    expect(events.map((e) => e.payload)).toContainEqual({
      invoiceId: b.id,
      number: p1.number,
      amount: '2300',
      date: '2026-10-10',
      paidAmount: '3300',
      balance: '0',
      status: 'paid',
    });
    // no journal entry is written by payments
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceId: b.id }))).toBe(1);
  });

  it('AC-5 ap_aging: open submitted bills per supplier bucketed by days past due as of a date; TableResult; viewer may read', async () => {
    const mk = async (partnerId: string, date: string, dueDate: string, unitPrice: string) => {
      const b = await run(purchasing, (ctx) =>
        createBill(ctx, { partnerId, date, dueDate }, [{ productId: product.goods, unitPrice }]),
      );
      await run(purchasing, (ctx) => submit(ctx, b.id));
      return b.id;
    };
    const asOf = '2026-12-15';
    const aging = (params: Partial<ContextParams>, input: Row) =>
      run(params, async (ctx) => (await runAction(ctx, 'purchase.ap_aging', input)) as Table);
    const bucketsOf = (t: Table, partnerId: string) => {
      const r = t.rows.find((x) => x.partnerId === partnerId);
      return Object.fromEntries(
        ['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90', 'balance'].map((k) => [
          k,
          Decimal.from(String(r?.[k] ?? '0')),
        ]),
      );
    };
    const delta = (a: Record<string, Decimal>, b: Record<string, Decimal>) =>
      Object.fromEntries(
        Object.keys(a).map((k) => [k, (a[k] ?? Decimal.zero()).minus(b[k] ?? Decimal.zero()).toString()]),
      );
    // earlier tests left open bills of both suppliers: assert on the change this test causes
    const base = await aging({}, { asOf });
    await mk(supplier.registered, '2026-11-01', '2026-12-31', '1000'); // not due
    await mk(supplier.registered, '2026-11-01', '2026-11-30', '2000'); // 15 days
    const paidLater = await mk(supplier.registered, '2026-10-01', '2026-10-31', '3000'); // 45 days, partly paid
    await run(purchasing, (ctx) => applyPayment(ctx, { invoiceId: paidLater, amount: '500', date: '2026-11-05' }));
    await mk(supplier.exempt, '2026-09-01', '2026-09-10', '4000'); // 96 days
    await mk(supplier.exempt, '2026-12-20', '2027-01-31', '9000'); // after asOf: excluded
    const t = await aging(asRole(['viewer']), { asOf });
    expect(tableResult.safeParse(t).success).toBe(true);
    expect(t.title).toEqual({ ja: '買掛金年齢表 2026-12-15 時点', en: 'AP aging as of 2026-12-15' });
    expect(t.columns.map((c) => c.key)).toEqual([
      'partnerCode',
      'partnerName',
      'billCount',
      'notDue',
      'days1to30',
      'days31to60',
      'days61to90',
      'over90',
      'balance',
      'partnerId',
    ]);
    expect(t.rows.find((r) => r.partnerId === supplier.exempt)).toMatchObject({
      partnerCode: 'S-EX',
      partnerName: '免税工房',
    });
    expect(t.rows.find((r) => r.partnerId === supplier.registered)).toMatchObject({
      partnerCode: 'S-REG',
      partnerName: '課税商事',
    });
    expect(delta(bucketsOf(t, supplier.registered), bucketsOf(base, supplier.registered))).toEqual({
      notDue: '1000',
      days1to30: '2000',
      days31to60: '2500',
      days61to90: '0',
      over90: '0',
      balance: '5500',
    });
    expect(delta(bucketsOf(t, supplier.exempt), bucketsOf(base, supplier.exempt))).toEqual({
      notDue: '0',
      days1to30: '0',
      days31to60: '0',
      days61to90: '0',
      over90: '4000',
      balance: '4000',
    });
    expect(Number(t.meta?.bills) - Number(base.meta?.bills)).toBe(4);
    // totals are consistent with the rows
    const sum = (key: string) => Decimal.sum(t.rows.map((r) => Decimal.from(String(r[key])))).toString();
    expect(t.totals?.balance).toBe(sum('balance'));
    expect(
      Decimal.sum(
        ['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90'].map((k) => Decimal.from(t.totals?.[k] ?? '0')),
      ).toString(),
    ).toBe(t.totals?.balance);
    expect(t.meta).toMatchObject({ asOf, suppliers: t.rows.length });
    expect(t.rows.map((r) => r.partnerCode)).toEqual([...t.rows.map((r) => r.partnerCode)].sort());
    // default asOf = today (2026-09-10): none of the bills above are dated on or before it except cancelled/paid ones
    const dflt = await aging({}, {});
    expect(dflt.meta).toMatchObject({ asOf: '2026-09-10' });
    expect(dflt.rows.every((r) => Decimal.from(String(r.balance)).gt(0))).toBe(true);
    await expect(run(asRole(['nobody']), (ctx) => runAction(ctx, 'purchase.ap_aging', {}))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(run({}, (ctx) => runAction(ctx, 'purchase.ap_aging', { asOf: '2026-2-1' }))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('AC-1/AC-6 accounting may update a draft header but not create lines; purchasing may delete drafts only through admin (spec lists no delete)', async () => {
    const b = await run(purchasing, (ctx) =>
      createBill(ctx, { partnerId: supplier.registered }, [{ productId: product.goods }]),
    );
    const u = (await run(asRole(['accounting']), (ctx) =>
      runAction(ctx, 'purchase_invoice.update', { id: b.id, patch: { note: '経理メモ' } }),
    )) as BillJson;
    expect(u.note).toBe('経理メモ');
    await expect(
      run(asRole(['accounting']), (ctx) =>
        repo(ctx, PurchaseInvoiceLine).create({ invoiceId: b.id, productId: product.goods } as never),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      run(purchasing, (ctx) => runAction(ctx, 'purchase_invoice.delete', { id: b.id })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await run({}, (ctx) => runAction(ctx, 'purchase_invoice.delete', { id: b.id }));
    expect(await run({}, (ctx) => repo(ctx, PurchaseInvoiceLine).count({ invoiceId: b.id }))).toBe(0);
    expect(PurchaseModule.depends).toEqual(['partner', 'product', 'tax', 'accounting']);
    expect(registry.hasSetting(PURCHASE_ACCOUNTS_KEY)).toBe(true);
    expect(PurchaseInvoice.doc?.naming).toEqual({ type: 'sequence', prefix: 'BILL-', period: 'year' });
  });
});
