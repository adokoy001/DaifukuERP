// Postgres tests for docs/specs/sales.md AC-1..AC-10. Test DB: daifuku_test_sales (TEST_DATABASE_URL*).
// The dependency modules are registered by importing ../src/index.ts (module.ts imports them first).
import { Decimal, PermissionDenied, StateError, ValidationError, appMeta, newId, registerCrudActions, registry, repo, runAction, setSetting, systemParams, withContext, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, JournalEntry, JournalLine, tableResult } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { Product, seedUoms } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTS_HINT,
  CANCEL_PAID_HINT,
  INVOICE_HTML_OVERRIDE,
  PAYMENT_APPLIED_EVENT,
  SALES_ACCOUNTS_KEY,
  SALES_ISSUER_KEY,
  SalesInvoice,
  SalesInvoiceLine,
  applyPayment,
  defaultInvoiceHtml,
  salesAccountsSchema,
  salesIssuerSchema,
  type InvoiceRenderData,
} from '../src/index.ts';

type Row = Record<string, unknown>;
type LineJson = Row & { id: string; seq: number; productId: string | null; description: string; quantity: string; unitPrice: string; taxCategory: string; amount: string };
type InvoiceJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  version: number;
  partnerId: string;
  date: string;
  dueDate: string | null;
  priceIncludesTax: boolean;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  balance: string;
  status: string;
  taxSummary: Row[];
  journalEntryId: string | null;
  amendedFrom: string | null;
};
type InvoiceWithLines = InvoiceJson & { lines: { sales_invoice_line: LineJson[] } };
type Table = { title: { ja: string; en: string }; columns: { key: string; kind: string }[]; rows: Row[]; totals?: Record<string, string>; meta?: Row };

/** 2026-09-10 12:00 JST: today for defaults and the aging reference day. */
const FIXED_NOW = new Date('2026-09-10T03:00:00Z');
let db: TestDb;
let partnerId: string;
let partnerB: string;
let acc: { ar: string; sales: string; tax: string; cash: string };
let product: { a: string; c: string; noPrice: string };

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) => db.run({ now: () => FIXED_NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const caught = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);

/** The AC-9 golden lines: 10%: 1,234 + 567; 8%: 1,333 (product A / manual / product C). */
const goldenLines = (): Row[] => [{ productId: product.a }, { description: '商品B', unitPrice: '567', taxCategory: 'standard' }, { productId: product.c }];

/**
 * Creates through the generic action, then re-reads: the kernel's generic create returns the header as it was
 * before the lines were saved (stale totals) — noted as a kernel gap in the work log; update re-reads, create does not.
 */
async function createInvoice(ctx: Context, head: Row, lines: Row[] = goldenLines()): Promise<InvoiceWithLines> {
  const created = (await runAction(ctx, 'sales_invoice.create', { partnerId, date: '2026-04-10', ...head, lines: { sales_invoice_line: lines } })) as InvoiceWithLines;
  return getInvoice(ctx, created.id);
}
async function getInvoice(ctx: Context, id: string): Promise<InvoiceWithLines> {
  return (await runAction(ctx, 'sales_invoice.get', { id })) as InvoiceWithLines;
}
async function submit(ctx: Context, id: string): Promise<InvoiceJson> {
  return (await runAction(ctx, 'sales_invoice.submit', { id })) as InvoiceJson;
}
/** create + submit in separate transactions; returns the submitted invoice with lines. */
async function postInvoice(head: Row, lines: Row[] = goldenLines(), params: Partial<ContextParams> = {}): Promise<InvoiceWithLines> {
  const draft = await run(params, (ctx) => createInvoice(ctx, head, lines));
  await run(params, (ctx) => submit(ctx, draft.id));
  return run(params, (ctx) => getInvoice(ctx, draft.id));
}
async function createAccount(code: string, name: string, type: 'asset' | 'liability' | 'revenue', extra: Row = {}): Promise<string> {
  return (await run({}, (ctx) => repo(ctx, Account).create({ code, name, type, ...extra }))).id;
}
/** Σdebit − Σcredit per account over posted lines (aggregate port), as the accounting tests do. */
async function netByAccount(ctx: Context): Promise<Map<string, string>> {
  const rows = await repo(ctx, JournalLine).aggregate({ where: { posted: true }, groupBy: ['accountId'], metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } } });
  return new Map(rows.map((r) => [String(r.accountId), (r.debit as Decimal).minus(r.credit as Decimal).toString()]));
}
const issues = (e: unknown) => ((e as ValidationError).details as { issues: { path: string; message: string }[] }).issues;

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => FIXED_NOW }), async (ctx) => {
    await seedUoms(ctx);
    await TaxModule.seed?.(ctx);
  });
  await run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-01-01' }));
  acc = {
    ar: await createAccount('1300', '売掛金', 'asset', { subtype: '売掛金', partnerRequired: true }),
    sales: await createAccount('4000', '売上高', 'revenue', { subtype: '売上' }),
    tax: await createAccount('2200', '仮受消費税', 'liability', { subtype: '仮受消費税' }),
    cash: await createAccount('1000', '現金', 'asset'),
  };
  partnerId = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '得意先A', isCustomer: true, closingDay: 31, paymentMonthOffset: 1, paymentDay: 31, postalCode: '150-0001', prefecture: '東京都', address1: '渋谷区2-2' }))).id;
  partnerB = (await run({}, (ctx) => repo(ctx, Partner).create({ name: 'B商事', isCustomer: true, closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 }))).id;
  product = {
    a: (await run({}, (ctx) => repo(ctx, Product).create({ code: 'A', name: '商品A', salePrice: '1234', taxCategory: 'standard' }))).id,
    c: (await run({}, (ctx) => repo(ctx, Product).create({ code: 'C', name: '食品C', salePrice: '1333', taxCategory: 'reduced' }))).id,
    noPrice: (await run({}, (ctx) => repo(ctx, Product).create({ code: 'Q', name: '見積品', taxCategory: 'standard' }))).id,
  };
});
afterAll(async () => {
  await db.close();
});

describe('sales module (docs/specs/sales.md)', () => {
  it('AC-1 sales_invoice with lines: defaults (today JST, tax setting, due date from partner terms), computed fields, get returns lines', async () => {
    const inv = await run({}, (ctx) => createInvoice(ctx, {}));
    expect(inv).toMatchObject({ docstatus: 0, number: null, partnerId, date: '2026-04-10', dueDate: '2026-05-31', priceIncludesTax: false, status: 'draft', paidAmount: '0', journalEntryId: null, amendedFrom: null });
    expect([inv.subtotal, inv.taxTotal, inv.total, inv.balance]).toEqual(['3134', '286', '3420', '3420']);
    // kernel-phase15 AC-7: create (version 1) + ONE header recalculation for all 3 lines via after_lines_saved (version 2).
    // Before the switch every line write touched the header, so this was 4 (1 + 3).
    expect(inv.version).toBe(2);
    expect(inv.taxSummary).toEqual([
      { category: 'standard', code: 'STD10', label: '標準10%', rate: '0.1', taxable: '1801', tax: '180', gross: '1981', lineCount: 2 },
      { category: 'reduced', code: 'RED8', label: '軽減8%', rate: '0.08', taxable: '1333', tax: '106', gross: '1439', lineCount: 1 },
    ]);
    expect(inv.lines.sales_invoice_line.map((l) => [l.seq, l.productId, l.description, l.quantity, l.unitPrice, l.taxCategory, l.amount])).toEqual([
      [1, product.a, '商品A', '1', '1234', 'standard', '1234'],
      [2, null, '商品B', '1', '567', 'standard', '567'],
      [3, product.c, '食品C', '1', '1333', 'reduced', '1333'],
    ]);
    const got = await run({}, (ctx) => getInvoice(ctx, inv.id));
    expect(got.lines.sales_invoice_line).toHaveLength(3);
    expect(got.version).toBe(inv.version);
    // defaults: date = today (JST from ctx.now), due date follows; an explicit due date is kept
    const today = await run({}, (ctx) => createInvoice(ctx, { date: undefined }, []));
    expect(today).toMatchObject({ date: '2026-09-10', dueDate: '2026-10-31', subtotal: '0', total: '0' });
    const explicit = await run({}, (ctx) => createInvoice(ctx, { dueDate: '2026-04-30', partnerId: partnerB }, []));
    expect(explicit.dueDate).toBe('2026-04-30');
    const b = await run({}, (ctx) => createInvoice(ctx, { partnerId: partnerB, date: '2026-04-25' }, []));
    expect(b.dueDate).toBe('2026-07-10'); // after the 20th -> closes 2026-05-20, +2 months, day 10
    // validation
    await expect(run({}, (ctx) => runAction(ctx, 'sales_invoice.create', { date: '2026-04-10' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'partnerId' }] } });
    await expect(run({}, (ctx) => createInvoice(ctx, { date: '2026-13-01' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'date' }] } });
    await expect(run({}, (ctx) => createInvoice(ctx, {}, [{ description: 'x', unitPrice: '1', taxCategory: 'vat' }]))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'taxCategory' }] } });
    await expect(run({}, (ctx) => createInvoice(ctx, {}, [{ description: 'x', taxCategory: 'standard' }]))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'unitPrice' }] } });
  });

  it('AC-2 recalculation on every path: product defaults, line save via update, header date/priceIncludesTax change, direct line write, tampering refused', async () => {
    const inv = await run({}, (ctx) => createInvoice(ctx, {}));
    // product without a sale price -> unitPrice required with a hint
    const noPrice = await caught(run({}, (ctx) => createInvoice(ctx, {}, [{ productId: product.noPrice }])));
    expect(noPrice).toBeInstanceOf(ValidationError);
    expect(issues(noPrice)).toEqual([{ path: 'unitPrice', message: expect.stringContaining('no salePrice') }]);
    expect((await run({}, (ctx) => createInvoice(ctx, {}, [{ productId: product.noPrice, unitPrice: '10' }]))).total).toBe('11');
    // replace-all line save through the generic update: keep line 1 (by id, quantity 2), drop the rest, add one
    const first = inv.lines.sales_invoice_line[0];
    const u = (await run({}, (ctx) =>
      runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { lines: { sales_invoice_line: [{ id: first?.id, productId: product.a, description: '商品A', unitPrice: '1234', quantity: '2', taxCategory: 'standard' }, { productId: product.c, quantity: '3' }] } } }),
    )) as InvoiceWithLines;
    expect(u.lines.sales_invoice_line.map((l) => [l.seq, l.description, l.quantity, l.amount])).toEqual([
      [1, '商品A', '2', '2468'],
      [2, '食品C', '3', '3999'],
    ]);
    expect(u.lines.sales_invoice_line[0]?.id).toBe(first?.id);
    // 10%: 2468 -> 246.8 -> 246; 8%: 3999 -> 319.92 -> 319
    expect([u.subtotal, u.taxTotal, u.total, u.balance]).toEqual(['6467', '565', '7032', '7032']);
    expect(u.version).toBeGreaterThan(inv.version);
    // kernel-phase15 AC-7: a lines-only update (1 line updated, 2 deleted, 1 created) recalculates the header once
    expect(u.version).toBe(inv.version + 1);
    // 税込: 2468 × 10/110 = 224.36 -> 224 (net 2244); 3999 × 8/108 = 296.22 -> 296 (net 3703)
    const incl = (await run({}, (ctx) => runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { priceIncludesTax: true } }))) as InvoiceJson;
    expect([incl.subtotal, incl.taxTotal, incl.total]).toEqual(['5947', '520', '6467']);
    expect(incl.taxSummary.map((g) => [g.category, g.taxable, g.tax, g.gross])).toEqual([
      ['standard', '2244', '224', '2468'],
      ['reduced', '3703', '296', '3999'],
    ]);
    // date in the 8% era: standard resolves to STD8, reduced has no rate -> VALIDATION from the tax module
    const noRate = await caught(run({}, (ctx) => runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { date: '2019-09-01' } })));
    expect(noRate).toMatchObject({ code: 'VALIDATION', details: { issues: [{ message: expect.stringContaining('reduced') }] } });
    const still = await run({}, (ctx) => repo(ctx, SalesInvoice).get(inv.id));
    expect(still.date).toBe('2026-04-10');
    // tampering with computed fields is refused; explicit dueDate null recomputes it
    await expect(run({}, (ctx) => runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { subtotal: '1', total: '2', paidAmount: '3', balance: '4', status: 'paid', journalEntryId: null } }))).rejects.toBeInstanceOf(PermissionDenied);
    const t = (await run({}, (ctx) => runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { priceIncludesTax: false, dueDate: null, date: '2026-05-05' } }))) as InvoiceJson;
    expect(t).toMatchObject({ subtotal: '6467', taxTotal: '565', total: '7032', paidAmount: '0', balance: '7032', status: 'draft', dueDate: '2026-06-30', date: '2026-05-05' });
    // a direct line write recalculates the header too
    const lineId = u.lines.sales_invoice_line[1]?.id ?? '';
    await expect(run({}, (ctx) => repo(ctx, SalesInvoiceLine).update(lineId, { amount: '999' }))).rejects.toBeInstanceOf(PermissionDenied);
    const l = await run({}, (ctx) => repo(ctx, SalesInvoiceLine).update(lineId, { quantity: '1' }));
    expect(l.amount.toString()).toBe('1333');
    expect((await run({}, (ctx) => repo(ctx, SalesInvoice).get(inv.id))).total.toString()).toBe('4153'); // 2468+246 + 1333+106
    await run({}, (ctx) => repo(ctx, SalesInvoiceLine).delete(lineId));
    expect((await run({}, (ctx) => repo(ctx, SalesInvoice).get(inv.id))).total.toString()).toBe('2714');
    const direct = await run({}, (ctx) => repo(ctx, SalesInvoiceLine).create({ invoiceId: inv.id, productId: product.c } as never));
    expect([direct.description, direct.unitPrice.toString(), direct.taxCategory, direct.amount.toString()]).toEqual(['食品C', '1333', 'reduced', '1333']);
    expect((await run({}, (ctx) => repo(ctx, SalesInvoice).get(inv.id))).total.toString()).toBe('4153');
    // explicit null asks for the product default again on update
    const refilled = await run({}, (ctx) => repo(ctx, SalesInvoiceLine).update(direct.id, { description: null as never }));
    expect(refilled.description).toBe('食品C');
  });

  it('AC-3 / AC-9 submit: ≥1 line, totals fixed, INV-<year>-<n>, status open, balance = total, journal entry with the golden lines; lines frozen afterwards', async () => {
    const before = await run({}, netByAccount);
    const inv = await postInvoice({});
    expect(inv.number).toMatch(/^INV-2026-\d{6}$/);
    expect(inv).toMatchObject({ docstatus: 1, status: 'open', paidAmount: '0', balance: '3420', subtotal: '3134', taxTotal: '286', total: '3420' });
    expect(inv.journalEntryId).toEqual(expect.any(String));
    const je = await run({}, (ctx) => repo(ctx, JournalEntry).get(inv.journalEntryId ?? ''));
    expect(je).toMatchObject({ docstatus: 1, sourceEntity: 'sales_invoice', sourceId: inv.id, date: '2026-04-10', description: `売上請求書 ${inv.number} 得意先A`, reversalOf: null });
    expect([je.totalDebit.toString(), je.totalCredit.toString()]).toEqual(['3420', '3420']);
    const lines = await run({}, (ctx) => repo(ctx, JournalLine).list({ where: { entryId: je.id }, orderBy: [{ field: 'seq', dir: 'asc' }] }));
    expect(lines.items.map((l) => [l.seq, l.accountId, l.debit.toString(), l.credit.toString(), l.partnerId, l.taxCategory, l.taxRate?.toString() ?? null, l.memo, l.posted])).toEqual([
      [1, acc.ar, '3420', '0', partnerId, null, null, '売掛金', true],
      [2, acc.sales, '0', '1234', null, 'standard', '0.1', '商品A', true],
      [3, acc.sales, '0', '567', null, 'standard', '0.1', '商品B', true],
      [4, acc.sales, '0', '1333', null, 'reduced', '0.08', '食品C', true],
      [5, acc.tax, '0', '180', null, 'standard', '0.1', '仮受消費税 10%', true],
      [6, acc.tax, '0', '106', null, 'reduced', '0.08', '仮受消費税 8%', true],
    ]);
    const after = await run({}, netByAccount);
    expect(Decimal.from(after.get(acc.ar) ?? '0').minus(before.get(acc.ar) ?? '0').toString()).toBe('3420');
    expect(Decimal.from(after.get(acc.sales) ?? '0').minus(before.get(acc.sales) ?? '0').toString()).toBe('-3134');
    expect(Decimal.from(after.get(acc.tax) ?? '0').minus(before.get(acc.tax) ?? '0').toString()).toBe('-286');
    // frozen: lines on every path, header fields outside allowOnSubmit
    const lineId = inv.lines.sales_invoice_line[0]?.id ?? '';
    await expect(run({}, (ctx) => runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { lines: { sales_invoice_line: [] } } }))).rejects.toBeInstanceOf(StateError);
    const frozen = await caught(run({}, (ctx) => repo(ctx, SalesInvoiceLine).update(lineId, { quantity: '9' })));
    expect(frozen).toMatchObject({ code: 'INVALID_STATE', hint: 'Use the owning module operation, or cancel and amend.' });
    await expect(run({}, (ctx) => repo(ctx, SalesInvoiceLine).delete(lineId))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, SalesInvoiceLine).create({ invoiceId: inv.id, productId: product.a } as never))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { date: '2026-04-11' } }))).rejects.toMatchObject({ code: 'INVALID_STATE', details: { blocked: ['date'] } });
    await expect(run({}, (ctx) => repo(ctx, SalesInvoice).delete(inv.id))).rejects.toBeInstanceOf(StateError);
    expect((await run({}, (ctx) => getInvoice(ctx, inv.id))).total).toBe('3420');
    // refusals leave the draft untouched: no lines, zero total
    const empty = await run({}, (ctx) => createInvoice(ctx, {}, []));
    const e1 = await caught(run({}, (ctx) => submit(ctx, empty.id)));
    expect(e1).toBeInstanceOf(ValidationError);
    expect(issues(e1)[0]?.path).toBe('lines');
    const zero = await run({}, (ctx) => createInvoice(ctx, {}, [{ description: '無償', unitPrice: '0', taxCategory: 'standard' }]));
    const e2 = await caught(run({}, (ctx) => submit(ctx, zero.id)));
    expect(issues(e2)[0]?.path).toBe('total');
    expect((await run({}, (ctx) => repo(ctx, SalesInvoice).get(zero.id))).docstatus).toBe(0);
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceId: zero.id }))).toBe(0);
    // numbering is per year and gapless in sequence
    const next = await postInvoice({});
    expect(Number(next.number?.slice(-6))).toBe(Number(inv.number?.slice(-6)) + 1);
    // the sales role can do the whole cycle (accounting grants it journal_entry create/submit)
    const bySales = await postInvoice({}, goldenLines(), asRole(['sales']));
    expect(bySales.status).toBe('open');
  });

  it('AC-3 missing account code -> INVALID_STATE with the seed/settings hint; the draft is not submitted', async () => {
    const inv = await run({}, (ctx) => createInvoice(ctx, {}));
    await run({}, (ctx) => setSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, { receivable: '1300', revenue: '4000', taxPayable: '2299' }));
    const err = await caught(run({}, (ctx) => submit(ctx, inv.id)));
    expect(err).toBeInstanceOf(StateError);
    expect(err).toMatchObject({ code: 'INVALID_STATE', hint: ACCOUNTS_HINT, details: { setting: SALES_ACCOUNTS_KEY, missing: { taxPayable: '2299' } } });
    expect((err as StateError).message).toContain('2299 (taxPayable)');
    expect((await run({}, (ctx) => repo(ctx, SalesInvoice).get(inv.id))).docstatus).toBe(0);
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceId: inv.id }))).toBe(0);
    await run({}, (ctx) => setSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, { receivable: '1300', revenue: '4000', taxPayable: '2200' }));
    expect((await run({}, (ctx) => submit(ctx, inv.id))).status).toBe('open');
    // the setting is declared for the generic settings UI
    expect(registry.hasSetting(SALES_ACCOUNTS_KEY)).toBe(true);
    expect(registry.hasSetting(SALES_ISSUER_KEY)).toBe(true);
  });

  it('AC-4 / AC-10 cancel reverses the entry (trial balance unchanged), refuses after a payment (hint), amend gives a clean draft', async () => {
    const trialBalance = () => run({}, (ctx) => runAction(ctx, 'accounting.trial_balance', { from: '2026-04-01', to: '2026-04-30' })) as Promise<Table>;
    const before = await run({}, netByAccount);
    const tbBefore = await trialBalance();
    const inv = await postInvoice({});
    const tbPosted = await trialBalance();
    const cancelled = (await run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: inv.id }))) as InvoiceJson;
    expect(cancelled).toMatchObject({ docstatus: 2, status: 'cancelled', balance: '3420', paidAmount: '0', journalEntryId: inv.journalEntryId });
    const reversals = await run({}, (ctx) => repo(ctx, JournalEntry).list({ where: { reversalOf: inv.journalEntryId } }));
    expect(reversals.items.map((e) => [e.docstatus, e.date, e.totalDebit.toString()])).toEqual([[1, '2026-04-10', '3420']]);
    expect(await run({}, netByAccount)).toEqual(before);
    const tbAfter = await trialBalance();
    const closing = (t: Table) => ['1300', '4000', '2200'].map((code) => [code, t.rows.find((r) => r.code === code)?.closingBalance]);
    expect(closing(tbAfter)).toEqual(closing(tbBefore));
    expect(closing(tbPosted)).not.toEqual(closing(tbBefore));
    // paid invoices cannot be cancelled
    const paid = await postInvoice({});
    await run({}, (ctx) => applyPayment(ctx, { invoiceId: paid.id, amount: '1000', date: '2026-05-01' }));
    const err = await caught(run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: paid.id })));
    expect(err).toBeInstanceOf(StateError);
    expect(err).toMatchObject({ code: 'INVALID_STATE', hint: CANCEL_PAID_HINT, details: { paidAmount: '1000' } });
    expect((await run({}, (ctx) => repo(ctx, SalesInvoice).get(paid.id))).docstatus).toBe(1);
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ reversalOf: paid.journalEntryId }))).toBe(0);
    // cancel again -> INVALID_STATE (kernel); amend -> new draft, system fields reset, lines not copied (kernel amend copies the header only)
    await expect(run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: inv.id }))).rejects.toBeInstanceOf(StateError);
    const amended = (await run({}, (ctx) => runAction(ctx, 'sales_invoice.amend', { id: inv.id }))) as InvoiceJson;
    // kernel amend copies the lines (ADR-0006), so the draft carries the original totals; state fields are reset
    expect(amended).toMatchObject({ docstatus: 0, number: null, amendedFrom: inv.id, status: 'draft', subtotal: '3134', total: '3420', balance: '3420', paidAmount: '0', journalEntryId: null, partnerId, date: '2026-04-10', dueDate: '2026-05-31' });
    expect((await run({}, (ctx) => getInvoice(ctx, amended.id))).lines.sales_invoice_line).toHaveLength(3); // lines copied by kernel amend
    const resubmitted = await run({}, async (ctx) => {
      await runAction(ctx, 'sales_invoice.update', { id: amended.id, patch: { lines: { sales_invoice_line: goldenLines() } } });
      return submit(ctx, amended.id);
    });
    // ADR-0006: amendments are numbered <original>-1
    expect(resubmitted.number).toBe(`${inv.number}-1`);
    expect(resubmitted).toMatchObject({ docstatus: 1, status: 'open', total: '3420', balance: '3420', amendedFrom: inv.id });
    expect(resubmitted.journalEntryId).not.toBe(inv.journalEntryId);
  });

  it('AC-5 render_invoice_html: 適格請求書 fields from settings/partner/lines; layout replaceable via sales.invoice_html', async () => {
    const inv = await postInvoice({ note: '納品書No.7' });
    const r1 = (await run(asRole(['viewer']), (ctx) => runAction(ctx, 'sales.render_invoice_html', { id: inv.id }))) as { html: string };
    expect(r1.html).toContain('テスト株式会社'); // issuer falls back to the company name
    expect(r1.html).not.toContain('登録番号');
    expect(r1.html).toContain(String(inv.number));
    expect(r1.html).toContain('得意先A 御中');
    expect(r1.html).toContain('〒150-0001 東京都 渋谷区2-2');
    expect(r1.html).toContain('2026-04-10');
    expect(r1.html).toContain('2026-05-31');
    expect(r1.html).toContain('※食品C');
    expect(r1.html).toContain('納品書No.7');
    for (const s of ['>1,801<', '>180<', '>1,333<', '>106<', '>3,134<', '>286<', '>3,420<', '課税（標準） 10%', '課税（軽減） 8%', '※は軽減税率対象']) expect(r1.html).toContain(s);
    await run({}, (ctx) => setSetting(ctx, SALES_ISSUER_KEY, salesIssuerSchema, { name: '大福商事株式会社', invoiceRegistrationNo: 'T1234567890123', postalCode: '100-0001', address: '東京都千代田区1-1', phone: '03-0000-0000', bankInfo: 'テスト銀行 本店 普通 1234567' }));
    const r2 = (await run({}, (ctx) => runAction(ctx, 'sales.render_invoice_html', { id: inv.id }))) as { html: string };
    expect(r2.html).toBe(r1.html); // issued facts survive subsequent company setting changes
    const newIssued = await postInvoice({});
    const newHtml = (await run({}, (ctx) => runAction(ctx, 'sales.render_invoice_html', { id: newIssued.id }))) as { html: string };
    expect(newHtml.html).toContain('大福商事株式会社');
    expect(newHtml.html).toContain('登録番号: T1234567890123');
    expect(newHtml.html).toContain('テスト銀行 本店 普通 1234567');
    await expect(run({}, (ctx) => setSetting(ctx, SALES_ISSUER_KEY, salesIssuerSchema, { name: 'x', invoiceRegistrationNo: '1234567890123' }))).rejects.toBeInstanceOf(ValidationError);
    // override point (ADR-0008): a pack replaces the layout and receives the InvoiceRenderData contract
    let seen: InvoiceRenderData | null = null;
    registry.registerOverride(INVOICE_HTML_OVERRIDE, (data: InvoiceRenderData) => {
      seen = data;
      return `<p>custom ${data.invoice.number}</p>`;
    });
    try {
      const r3 = (await run({}, (ctx) => runAction(ctx, 'sales.render_invoice_html', { id: inv.id }))) as { html: string };
      expect(r3.html).toBe(`<p>custom ${inv.number}</p>`);
    } finally {
      registry.registerOverride(INVOICE_HTML_OVERRIDE, defaultInvoiceHtml);
    }
    const data = seen as InvoiceRenderData | null;
    expect(data?.issuer).toEqual({ name: 'テスト株式会社' });
    expect(data?.recipient).toEqual({ name: '得意先A', postalCode: '150-0001', address: '東京都 渋谷区2-2' });
    expect(data?.invoice).toEqual({ docstatus: 1, number: inv.number, date: '2026-04-10', dueDate: '2026-05-31', note: '納品書No.7', priceIncludesTax: false });
    expect(data?.lines.map((l) => [l.seq, l.description, l.quantity, l.unitPrice, l.amount, l.taxCategory, l.rate])).toEqual([
      [1, '商品A', '1', '1234', '1234', 'standard', '0.1'],
      [2, '商品B', '1', '567', '567', 'standard', '0.1'],
      [3, '食品C', '1', '1333', '1333', 'reduced', '0.08'],
    ]);
    expect(data?.taxSummary).toEqual([
      { category: 'standard', rate: '0.1', taxable: '1801', tax: '180', gross: '1981' },
      { category: 'reduced', rate: '0.08', taxable: '1333', tax: '106', gross: '1439' },
    ]);
    expect(data?.totals).toEqual({ subtotal: '3134', taxTotal: '286', total: '3420' });
    expect(data?.locale).toBe('ja');
    // a draft renders too (no number); unknown id / no permission
    const draft = await run({}, (ctx) => createInvoice(ctx, {}));
    expect(((await run({}, (ctx) => runAction(ctx, 'sales.render_invoice_html', { id: draft.id }))) as { html: string }).html).toContain('（下書き）');
    await expect(run({}, (ctx) => runAction(ctx, 'sales.render_invoice_html', { id: newId() }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(run(asRole(['nobody']), (ctx) => runAction(ctx, 'sales.render_invoice_html', { id: inv.id }))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-7 record_payment / applyPayment: partial, final -> paid, over-payment VALIDATION, un-apply, drafts refused, no posting', async () => {
    // kernel-phase15 AC-9: record_payment is internal — still callable in-process (runAction below), not exposed by apps
    expect(registry.action('sales.record_payment').internal).toBe(true);
    expect(registry.actions().map((a) => a.name)).not.toContain('sales.record_payment');
    const inv = await postInvoice({});
    const entries = () => run({}, (ctx) => repo(ctx, JournalEntry).count());
    const n = await entries();
    const p1 = (await run(asRole(['sales']), (ctx) => runAction(ctx, 'sales.record_payment', { invoiceId: inv.id, amount: '1000', date: '2026-05-01' }))) as InvoiceJson;
    expect(p1).toMatchObject({ paidAmount: '1000', balance: '2420', status: 'open', docstatus: 1 });
    const over = await caught(run({}, (ctx) => applyPayment(ctx, { invoiceId: inv.id, amount: '2421', date: '2026-05-02' })));
    expect(over).toBeInstanceOf(ValidationError);
    expect(issues(over)).toEqual([{ path: 'amount', message: 'must be <= 2420' }]);
    const p2 = await run({}, (ctx) => applyPayment(ctx, { invoiceId: inv.id, amount: Decimal.from('2420'), date: '2026-05-02' }));
    expect([p2.paidAmount.toString(), p2.balance.toString(), p2.status]).toEqual(['3420', '0', 'paid']);
    expect(await entries()).toBe(n); // no journal entry from payments
    // un-apply (payment cancel) reopens; cannot go below zero; zero amount / bad date rejected
    const p3 = await run({}, (ctx) => applyPayment(ctx, { invoiceId: inv.id, amount: '-2420', date: '2026-05-03' }));
    expect([p3.paidAmount.toString(), p3.balance.toString(), p3.status]).toEqual(['1000', '2420', 'open']);
    await expect(run({}, (ctx) => applyPayment(ctx, { invoiceId: inv.id, amount: '-1001', date: '2026-05-03' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'amount' }] } });
    await expect(run({}, (ctx) => applyPayment(ctx, { invoiceId: inv.id, amount: '0', date: '2026-05-03' }))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(run({}, (ctx) => applyPayment(ctx, { invoiceId: inv.id, amount: '1', date: '2026/05/03' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'date' }] } });
    await expect(run({}, (ctx) => runAction(ctx, 'sales.record_payment', { invoiceId: inv.id, amount: 'abc', date: '2026-05-03' }))).rejects.toBeInstanceOf(ValidationError);
    const events = await db.owner.sql<{ payload: Row }[]>`select payload from outbox where topic = ${PAYMENT_APPLIED_EVENT} and tenant_id = ${db.tenantId}`;
    expect(events.map((r) => r.payload)).toContainEqual({ invoiceId: inv.id, number: inv.number, amount: '2420', date: '2026-05-02', paidAmount: '3420', balance: '0', status: 'paid' });
    // drafts and cancelled invoices do not take payments
    const draft = await run({}, (ctx) => createInvoice(ctx, {}));
    await expect(run({}, (ctx) => applyPayment(ctx, { invoiceId: draft.id, amount: '1', date: '2026-05-03' }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const cancelled = await postInvoice({});
    await run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: cancelled.id }));
    await expect(run({}, (ctx) => applyPayment(ctx, { invoiceId: cancelled.id, amount: '1', date: '2026-05-03' }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(run({}, (ctx) => applyPayment(ctx, { invoiceId: newId(), amount: '1', date: '2026-05-03' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // the audit trail shows the payment fields only
    const trail = await db.owner.sql<{ after: Row }[]>`select after from audit_log where entity = 'sales_invoice' and record_id = ${inv.id} and op = 'update' order by at`;
    const paymentAudit = trail.map((t) => t.after).filter((a) => Object.keys(a).sort().join(',') === 'balance,paidAmount');
    expect(paymentAudit.map((a) => [Decimal.from(String(a.paidAmount)).toString(), Decimal.from(String(a.balance)).toString()])).toEqual([['1000', '2420']]);
  });

  it('AC-6 ar_aging: open balances per partner bucketed by days overdue as of asOf; TableResult with totals', async () => {
    // a third partner isolates this test from the invoices above: 5 open invoices + 1 paid + 1 draft + 1 cancelled
    const c = (await run({}, (ctx) => repo(ctx, Partner).create({ name: 'C工業', isCustomer: true }))).id;
    const one = [{ description: 'x', unitPrice: '1000', taxCategory: 'exempt' }];
    const mk = (date: string, dueDate: string, partner = c, lines = one) => postInvoice({ partnerId: partner, date, dueDate }, lines);
    await mk('2026-04-10', '2026-05-31'); // 102 days -> over90
    await mk('2026-05-10', '2026-06-20'); // 82 -> 61-90
    await mk('2026-06-10', '2026-07-15'); // 57 -> 31-60
    await mk('2026-07-10', '2026-08-31', c, [{ description: 'y', unitPrice: '2000', taxCategory: 'exempt' }]); // 10 -> 1-30
    await mk('2026-09-01', '2026-10-31', c, [{ description: 'z', unitPrice: '300', taxCategory: 'standard' }]); // not due (330 gross)
    const paid = await mk('2026-09-05', '2026-09-30');
    await run({}, (ctx) => applyPayment(ctx, { invoiceId: paid.id, amount: '1000', date: '2026-09-06' }));
    const partly = await mk('2026-09-06', '2026-09-10');
    await run({}, (ctx) => applyPayment(ctx, { invoiceId: partly.id, amount: '400', date: '2026-09-07' })); // 600 open, due today -> not due
    await run({}, (ctx) => createInvoice(ctx, { partnerId: c, dueDate: '2026-01-01' }, one));
    const cancelled = await mk('2026-08-01', '2026-08-01');
    await run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: cancelled.id }));
    await mk('2026-09-11', '2026-09-30'); // dated after asOf: excluded
    const t = (await run(asRole(['viewer']), (ctx) => runAction(ctx, 'sales.ar_aging', { asOf: '2026-09-10' }))) as Table;
    expect(tableResult.safeParse(t).success).toBe(true);
    expect(t.title).toEqual({ ja: '売掛金年齢表 2026-09-10 現在', en: 'AR aging as of 2026-09-10' });
    expect(t.columns.map((col) => col.key)).toEqual(['partnerName', 'notDue', 'days1to30', 'days31to60', 'days61to90', 'over90', 'total', 'partnerId']);
    expect(t.meta).toEqual({ asOf: '2026-09-10', truncated: false });
    const row = t.rows.find((r) => r.partnerId === c);
    expect(row).toEqual({ partnerId: c, partnerName: 'C工業', notDue: '930', days1to30: '2000', days31to60: '1000', days61to90: '1000', over90: '1000', total: '5930' });
    expect(t.rows.map((r) => r.partnerName)).toEqual([...t.rows.map((r) => String(r.partnerName))].sort());
    const sum = (key: string) => Decimal.sum(t.rows.map((r) => Decimal.from(String(r[key])))).toString();
    expect(t.totals?.total).toBe(sum('total'));
    expect(t.totals?.over90).toBe(sum('over90'));
    expect(Decimal.sum(['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90'].map((k) => Decimal.from(t.totals?.[k] ?? '0'))).toString()).toBe(t.totals?.total);
    // an earlier reference day moves the buckets; default asOf = today (ctx.now, JST)
    const earlier = (await run({}, (ctx) => runAction(ctx, 'sales.ar_aging', { asOf: '2026-06-01' }))) as Table;
    expect(earlier.rows.find((r) => r.partnerId === c)).toMatchObject({ notDue: '1000', days1to30: '1000', over90: '0', total: '2000' });
    const dflt = (await run({}, (ctx) => runAction(ctx, 'sales.ar_aging', {}))) as Table;
    expect(dflt.meta?.asOf).toBe('2026-09-10');
    expect(dflt.rows.find((r) => r.partnerId === c)).toEqual(row);
    await expect(run({}, (ctx) => runAction(ctx, 'sales.ar_aging', { asOf: '2026-9-1' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(run(asRole(['nobody']), (ctx) => runAction(ctx, 'sales.ar_aging', {}))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-8 permissions: sales full cycle on invoice + lines, accounting/viewer read only, admin all', async () => {
    const ops = (roles: string[], entity: string) => run(asRole(roles), async (ctx) => appMeta(ctx).entities.find((e) => e.name === entity)?.ops);
    expect(await ops(['sales'], 'sales_invoice')).toEqual(['read', 'create', 'update', 'submit', 'cancel', 'amend']);
    expect(await ops(['sales'], 'sales_invoice_line')).toEqual(['read', 'create', 'update', 'delete']);
    expect(await ops(['accounting'], 'sales_invoice')).toEqual(['read', 'update']); // payment application (spec AC-8, revised)
    expect(await ops(['accounting'], 'sales_invoice_line')).toEqual(['read']);
    expect(await ops(['viewer'], 'sales_invoice')).toEqual(['read']);
    expect(await ops(['viewer'], 'sales_invoice_line')).toEqual(['read']);
    const inv = await postInvoice({});
    for (const role of ['accounting', 'viewer']) {
      expect((await run(asRole([role]), (ctx) => getInvoice(ctx, inv.id))).lines.sales_invoice_line).toHaveLength(3);
      await expect(run(asRole([role]), (ctx) => createInvoice(ctx, {}))).rejects.toBeInstanceOf(PermissionDenied);
      // accounting may update (payment application, allowOnSubmit fields only) — a header field on a submitted invoice is a state error, viewer is denied outright
      await expect(run(asRole([role]), (ctx) => runAction(ctx, 'sales_invoice.update', { id: inv.id, patch: { note: 'x' } }))).rejects.toBeInstanceOf(role === 'accounting' ? StateError : PermissionDenied);
      if (role === 'viewer') await expect(run(asRole([role]), (ctx) => runAction(ctx, 'sales.record_payment', { invoiceId: inv.id, amount: '1', date: '2026-05-01' }))).rejects.toBeInstanceOf(PermissionDenied);
      await expect(run(asRole([role]), (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: inv.id }))).rejects.toBeInstanceOf(PermissionDenied);
    }
    await expect(run(asRole(['sales']), (ctx) => repo(ctx, SalesInvoice).delete(inv.id))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(asRole(['nobody']), (ctx) => getInvoice(ctx, inv.id))).rejects.toBeInstanceOf(PermissionDenied);
    const draft = await run(asRole(['sales']), (ctx) => createInvoice(ctx, {}));
    await run({}, (ctx) => repo(ctx, SalesInvoice).delete(draft.id));
    expect(await run({}, (ctx) => repo(ctx, SalesInvoiceLine).count({ invoiceId: draft.id }))).toBe(0); // cascade
  });
});
