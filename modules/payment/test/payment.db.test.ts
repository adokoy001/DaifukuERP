// Postgres tests for docs/specs/payment.md AC-1..AC-7. Test DB: daifuku_test_payment (TEST_DATABASE_URL*).
// The dependency modules (partner, product, tax, accounting, sales, purchase) are registered by importing ../src/index.ts.
// Invoices use zero-rate lines (exempt) so no tax_rate seed is needed: mod-product / mod-tax are not dependencies of
// this package. Accounts and the fiscal year are seeded by hand (l10n/jp owns the real chart of accounts).
import { Decimal, DOCSTATUS, PermissionDenied, StateError, ValidationError, appMeta, newId, registerCrudActions, registry, repo, runAction, setSetting, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, JournalEntry, JournalLine, openFiscalYear, tableResult } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { SalesInvoice } from '@daifuku/mod-sales';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOCATION_HINT, PAYMENT_ACCOUNTS_KEY, Payment, PaymentAllocation, PaymentModule, paymentAccountsSchema } from '../src/index.ts';

type Row = Record<string, unknown>;
type LineJson = Row & { id: string; seq: number; invoiceEntity: string; invoiceId: string; amount: string };
type PaymentJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  version: number;
  direction: string;
  partnerId: string;
  date: string;
  amount: string;
  method: string;
  accountId: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  note: string | null;
  journalEntryId: string | null;
  amendedFrom: string | null;
};
type PaymentWithLines = PaymentJson & { lines: { payment_allocation: LineJson[] } };
type InvoiceJson = Row & { id: string; number: string | null; docstatus: number; status: string; total: string; paidAmount: string; balance: string; journalEntryId: string | null };
type Table = { title: { ja: string; en: string }; columns: { key: string; kind: string; ref?: string }[]; rows: Row[]; totals?: Record<string, string>; meta?: Row };

/** 2026-09-10 12:00 JST: today for defaults. */
const FIXED_NOW = new Date('2026-09-10T03:00:00Z');
let db: TestDb;
let acc: Record<'1000' | '1100' | '1300' | '2100' | '2400' | '1900' | '4000' | '2200' | '5000' | '1500', string>;
let codeOf: Map<string, string>;
let customerA: string;
let customerB: string;
let supplierS: string;

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) => db.run({ now: () => FIXED_NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const sales = asRole(['sales']);
const purchasing = asRole(['purchasing']);
const accounting = asRole(['accounting']);
const viewer = asRole(['viewer']);
const caught = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);
const issues = (e: unknown) => ((e as ValidationError).details as { issues: { path: string; message: string }[] }).issues;

async function getPayment(ctx: Context, id: string): Promise<PaymentWithLines> {
  return (await runAction(ctx, 'payment.get', { id })) as PaymentWithLines;
}
/** Creates through the generic action, then re-reads (the kernel's create returns the header as saved before its lines — known gap). */
async function createPayment(ctx: Context, head: Row, lines?: Row[]): Promise<PaymentWithLines> {
  const created = (await runAction(ctx, 'payment.create', { ...head, ...(lines ? { lines: { payment_allocation: lines } } : {}) })) as PaymentWithLines;
  return getPayment(ctx, created.id);
}
async function submitPayment(ctx: Context, id: string): Promise<PaymentJson> {
  return (await runAction(ctx, 'payment.submit', { id })) as PaymentJson;
}
async function postSalesInvoice(partnerId: string, amount: string, date = '2026-08-01'): Promise<InvoiceJson> {
  return run({}, async (ctx) => {
    const inv = (await runAction(ctx, 'sales_invoice.create', { partnerId, date, lines: { sales_invoice_line: [{ description: '商品', unitPrice: amount, taxCategory: 'exempt' }] } })) as InvoiceJson;
    return (await runAction(ctx, 'sales_invoice.submit', { id: inv.id })) as InvoiceJson;
  });
}
async function postBill(partnerId: string, amount: string, date = '2026-08-05'): Promise<InvoiceJson> {
  return run({}, async (ctx) => {
    const bill = (await runAction(ctx, 'purchase_invoice.create', { partnerId, date, priceIncludesTax: false, lines: { purchase_invoice_line: [{ accountId: acc['5000'], description: '仕入', unitPrice: amount, taxCategory: 'exempt' }] } })) as InvoiceJson;
    return (await runAction(ctx, 'purchase_invoice.submit', { id: bill.id })) as InvoiceJson;
  });
}
const salesInvoice = (id: string) => run({}, (ctx) => repo(ctx, SalesInvoice).get(id));
const bill = (id: string) => run({}, (ctx) => repo(ctx, PurchaseInvoice).get(id));
/** Journal lines of an entry as [code, debit, credit, partnerId, memo]. */
async function entryLines(entryId: string): Promise<(string | null)[][]> {
  return run({}, async (ctx) => {
    const lines = await repo(ctx, JournalLine).list({ where: { entryId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 100 });
    return lines.items.map((l) => [codeOf.get(l.accountId) ?? l.accountId, l.debit.toString(), l.credit.toString(), l.partnerId, l.memo]);
  });
}
/** Σdebit − Σcredit per account code over posted lines (aggregate port). */
async function netByCode(): Promise<Record<string, string>> {
  return run({}, async (ctx) => {
    const rows = await repo(ctx, JournalLine).aggregate({ where: { posted: true }, groupBy: ['accountId'], metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } } });
    return Object.fromEntries(rows.map((r) => [codeOf.get(String(r.accountId)) ?? String(r.accountId), (r.debit as Decimal).minus(r.credit as Decimal).toString()]));
  });
}
const delta = (after: Record<string, string>, before: Record<string, string>, code: string) => Decimal.from(after[code] ?? '0').minus(before[code] ?? '0').toString();
const trialBalance = () => run({}, (ctx) => runAction(ctx, 'accounting.trial_balance', { from: '2026-01-01', to: '2026-12-31' })) as Promise<Table>;
const closing = (t: Table, code: string) => String(t.rows.find((r) => r.code === code)?.closingBalance ?? '0');

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run({}, (ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  const account = (code: string, name: string, type: 'asset' | 'liability' | 'revenue' | 'expense', extra: Row = {}) => run({}, async (ctx) => (await repo(ctx, Account).create({ code, name, type, ...extra })).id);
  acc = {
    '1000': await account('1000', '現金', 'asset', { subtype: '現金預金' }),
    '1100': await account('1100', '普通預金', 'asset', { subtype: '現金預金' }),
    '1300': await account('1300', '売掛金', 'asset', { subtype: '売掛金', partnerRequired: true }),
    '2100': await account('2100', '買掛金', 'liability', { subtype: '買掛金', partnerRequired: true }),
    '2400': await account('2400', '前受金', 'liability', { subtype: 'その他流動負債' }),
    '1900': await account('1900', '前払金', 'asset', { subtype: 'その他流動資産' }),
    '4000': await account('4000', '売上高', 'revenue', { subtype: '売上' }),
    '2200': await account('2200', '仮受消費税', 'liability', { subtype: '仮受消費税' }),
    '5000': await account('5000', '仕入高', 'expense', { subtype: '仕入' }),
    '1500': await account('1500', '仮払消費税', 'asset', { subtype: '仮払消費税' }),
  };
  codeOf = new Map(Object.entries(acc).map(([code, id]) => [id, code]));
  customerA = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '得意先A', isCustomer: true }))).id;
  customerB = (await run({}, (ctx) => repo(ctx, Partner).create({ name: 'B商事', isCustomer: true }))).id;
  supplierS = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '仕入先S', isSupplier: true }))).id;
});
afterAll(async () => {
  await db.close();
});

describe('payment module (docs/specs/payment.md)', () => {
  it('AC-1 payment + allocations: defaults (today JST, bank_transfer, accountId from payment.accounts by method), computed fields, get returns lines, validation', async () => {
    expect(PaymentModule.name).toBe('payment');
    expect(registry.hasSetting(PAYMENT_ACCOUNTS_KEY)).toBe(true);
    const inv = await postSalesInvoice(customerA, '3000');
    await expect(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1000', allocatedAmount: '999', journalEntryId: inv.journalEntryId }))).rejects.toBeInstanceOf(PermissionDenied);
    const p = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1000' }));
    expect(p).toMatchObject({ docstatus: 0, number: null, direction: 'receive', partnerId: customerA, date: '2026-09-10', amount: '1000', method: 'bank_transfer', accountId: acc['1100'], allocatedAmount: '0', unallocatedAmount: '1000', journalEntryId: null, amendedFrom: null });
    expect(p.lines.payment_allocation).toEqual([]);
    const cash = await run({}, (ctx) => createPayment(ctx, { direction: 'pay', partnerId: supplierS, amount: '500', method: 'cash', date: '2026-08-20' }));
    expect(cash).toMatchObject({ accountId: acc['1000'], date: '2026-08-20', method: 'cash' });
    const explicit = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '10', method: 'cash', accountId: acc['1100'] }));
    expect(explicit.accountId).toBe(acc['1100']);
    // with lines: allocated / unallocated derived, lines ordered by seq
    const withLines = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1000' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '600' }]));
    expect([withLines.allocatedAmount, withLines.unallocatedAmount]).toEqual(['600', '400']);
    expect(withLines.lines.payment_allocation.map((l) => [l.seq, l.invoiceEntity, l.invoiceId, l.amount])).toEqual([[1, 'sales_invoice', inv.id, '600']]);
    expect((await run({}, (ctx) => getPayment(ctx, withLines.id))).lines.payment_allocation).toHaveLength(1);
    // update: computed fields re-derived (tampering neutralised), accountId null -> default for the (new) method
    await expect(run({}, (ctx) => runAction(ctx, 'payment.update', { id: withLines.id, patch: { allocatedAmount: '1', unallocatedAmount: '2' } }))).rejects.toBeInstanceOf(PermissionDenied);
    const u = (await run({}, (ctx) => runAction(ctx, 'payment.update', { id: withLines.id, patch: { amount: '800', method: 'cash', accountId: null } }))) as PaymentJson;
    expect(u).toMatchObject({ amount: '800', allocatedAmount: '600', unallocatedAmount: '200', accountId: acc['1000'], method: 'cash' });
    // validation
    await expect(run({}, (ctx) => createPayment(ctx, { partnerId: customerA, amount: '1' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'direction' }] } });
    await expect(run({}, (ctx) => createPayment(ctx, { direction: 'receive', amount: '1' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'partnerId' }] } });
    await expect(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'amount' }] } });
    await expect(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '0' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'amount', message: 'must be > 0' }] } });
    await expect(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '-5' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'amount' }] } });
    await expect(run({}, (ctx) => runAction(ctx, 'payment.update', { id: p.id, patch: { amount: '0' } }))).rejects.toMatchObject({ code: 'VALIDATION' });
    const badMethod = await caught(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1', method: 'cheque' })));
    expect(badMethod).toBeInstanceOf(ValidationError);
    expect(issues(badMethod).map((i) => i.path)).toEqual(['method', 'accountId']); // no default account for an unknown method
    await expect(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1', date: '2026-13-01' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'date' }] } });
    // default account code missing -> VALIDATION on accountId with the setting in the hint; an explicit accountId still works
    await run({}, (ctx) => setSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, { cash: '1000', bank: '9999', receivable: '1300', payable: '2100', advanceReceived: '2400', advancePaid: '1900' }));
    const noAcc = await caught(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1' })));
    expect(noAcc).toBeInstanceOf(ValidationError);
    expect(issues(noAcc)).toEqual([{ path: 'accountId', message: expect.stringContaining('9999') }]);
    expect((noAcc as ValidationError).hint).toContain(PAYMENT_ACCOUNTS_KEY);
    expect((await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1', accountId: acc['1100'] }))).accountId).toBe(acc['1100']);
    await run({}, (ctx) => setSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, { cash: '1000', bank: '1100', receivable: '1300', payable: '2100', advanceReceived: '2400', advancePaid: '1900' }));
  });

  it('AC-2 allocation rules on save (entity/direction, existence, open, partner, balance, amount) and at submit (Σ <= amount, one line per invoice)', async () => {
    const inv = await postSalesInvoice(customerA, '3000');
    const invB = await postSalesInvoice(customerB, '700');
    const billS = await postBill(supplierS, '5000');
    const draftInv = await run({}, (ctx) => runAction(ctx, 'sales_invoice.create', { partnerId: customerA, date: '2026-08-01', lines: { sales_invoice_line: [{ description: 'x', unitPrice: '10', taxCategory: 'exempt' }] } })) as InvoiceJson;
    const mk = (lines: Row[], head: Row = {}) => run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '2500', ...head }, lines));
    const line = (over: Row = {}) => ({ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '1000', ...over });
    const expectIssue = async (p: Promise<unknown>, path: string, message: string) => {
      const e = await caught(p);
      expect(e).toBeInstanceOf(ValidationError);
      expect(issues(e)).toEqual([{ path, message: expect.stringContaining(message) }]);
    };
    await expectIssue(mk([line({ invoiceEntity: 'purchase_invoice', invoiceId: billS.id })]), 'invoiceEntity', 'must be sales_invoice for direction receive');
    await expectIssue(mk([line({ invoiceId: newId() })]), 'invoiceId', 'does not exist or is not visible');
    await expectIssue(mk([line({ invoiceId: draftInv.id, amount: '10' })]), 'invoiceId', 'is not open (docstatus 0, status draft)');
    await expectIssue(mk([line({ invoiceId: invB.id, amount: '700' })]), 'invoiceId', 'belongs to another partner');
    await expectIssue(mk([line({ amount: '3001' })], { amount: '5000' }), 'amount', 'must be <= the invoice balance 3000');
    await expectIssue(mk([line({ amount: '2600' })]), 'amount', 'must be <= the payment amount 2500');
    await expectIssue(mk([line({ amount: '0' })]), 'amount', 'must be > 0');
    await expectIssue(mk([line({ invoiceEntity: 'sales_invoice', invoiceId: billS.id })], { direction: 'pay', partnerId: supplierS }), 'invoiceEntity', 'must be purchase_invoice for direction pay');
    await expect(mk([line({ invoiceEntity: 'bill' })])).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'invoiceEntity' }] } });
    await expect(mk([line({ invoiceId: 'not-a-uuid' })])).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'invoiceId' }] } });
    // a refused line leaves nothing behind
    expect(await run({}, (ctx) => repo(ctx, Payment).count({ partnerId: customerA, amount: '2500' }))).toBe(0);
    // valid: replace-all through the generic update (intermediate Σ > amount is tolerated), direct line writes recompute the header
    const p = await mk([line()]);
    expect([p.allocatedAmount, p.unallocatedAmount]).toEqual(['1000', '1500']);
    const first = p.lines.payment_allocation[0];
    const u = (await run({}, (ctx) => runAction(ctx, 'payment.update', { id: p.id, patch: { amount: '1000', lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '1000' }] } } }))) as PaymentWithLines;
    // phase15-cleanup AC-4: header patch (+1) and ONE header touch for the whole replace-all save via after_lines_saved (+1);
    // per-line touches (create the new line +1, delete the old one +1) would make it p.version + 3
    expect(u.version).toBe(p.version + 2);
    expect(u.lines.payment_allocation.map((l) => [l.seq, l.amount])).toEqual([[1, '1000']]);
    expect(u.lines.payment_allocation[0]?.id).not.toBe(first?.id);
    expect([u.amount, u.allocatedAmount, u.unallocatedAmount]).toEqual(['1000', '1000', '0']);
    const direct = await run({}, (ctx) => repo(ctx, PaymentAllocation).update(u.lines.payment_allocation[0]?.id ?? '', { amount: '250' }));
    expect(direct.amount.toString()).toBe('250');
    expect((await run({}, (ctx) => repo(ctx, Payment).get(p.id))).unallocatedAmount.toString()).toBe('750');
    const added = await run({}, (ctx) => repo(ctx, PaymentAllocation).create({ paymentId: p.id, invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '750' }));
    expect(added.seq).toBe(1); // DSL default; the generic replace-all assigns seq from array order
    expect((await run({}, (ctx) => repo(ctx, Payment).get(p.id))).unallocatedAmount.toString()).toBe('0');
    await run({}, (ctx) => repo(ctx, PaymentAllocation).delete(added.id));
    expect((await run({}, (ctx) => repo(ctx, Payment).get(p.id))).allocatedAmount.toString()).toBe('250');
    // amount reduced below Σ: the draft shows the truth (negative unallocated), submit refuses with the Σ issue
    const over = await run({}, (ctx) => runAction(ctx, 'payment.update', { id: p.id, patch: { amount: '100' } })) as PaymentJson;
    expect([over.allocatedAmount, over.unallocatedAmount]).toEqual(['250', '-150']);
    const e1 = await caught(run({}, (ctx) => submitPayment(ctx, p.id)));
    expect(e1).toMatchObject({ code: 'VALIDATION', hint: ALLOCATION_HINT });
    expect(issues(e1)).toEqual([
      { path: 'lines.1.amount', message: 'must be <= the payment amount 100' },
      { path: 'lines', message: 'allocations 250 exceed the payment amount 100' },
    ]);
    expect((await run({}, (ctx) => repo(ctx, Payment).get(p.id))).docstatus).toBe(0);
    // one allocation per invoice
    const dup = await mk([line({ amount: '100' }), line({ amount: '200' })]);
    // phase15-cleanup AC-4: create (version 1) + one after_lines_saved touch for both lines (was 1 + one touch per line = 3)
    expect(dup.version).toBe(2);
    expect(dup.allocatedAmount).toBe('300');
    const e2 = await caught(run({}, (ctx) => submitPayment(ctx, dup.id)));
    expect(issues(e2)).toEqual([{ path: 'lines.2.invoiceId', message: `sales_invoice ${inv.number} is allocated twice; merge the lines` }]);
    // the invoice's state is re-checked at submit: pay it elsewhere, then the old draft fails on balance
    const full = await mk([line({ amount: '2500' })]);
    const other = await mk([line({ amount: '2000' })]);
    await run({}, (ctx) => submitPayment(ctx, other.id));
    const e3 = await caught(run({}, (ctx) => submitPayment(ctx, full.id)));
    expect(issues(e3)).toEqual([{ path: 'lines.1.amount', message: 'must be <= the invoice balance 1000' }]);
    expect((await salesInvoice(inv.id)).balance.toString()).toBe('1000');
  });

  it('AC-3 / AC-7 receive cycle: partial (sales role) then final with an advance (accounting) -> invoice paid; PAY-<year>-<n>; entries; frozen after submit', async () => {
    const inv = await postSalesInvoice(customerA, '3000', '2026-08-02');
    const before = await netByCode();
    const draft1 = await run(sales, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1000', date: '2026-08-10' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '1000' }]));
    const p1 = await run(sales, (ctx) => submitPayment(ctx, draft1.id));
    expect(p1.number).toMatch(/^PAY-2026-\d{6}$/);
    expect(p1).toMatchObject({ docstatus: 1, allocatedAmount: '1000', unallocatedAmount: '0', accountId: acc['1100'] });
    expect(p1.journalEntryId).toEqual(expect.any(String));
    expect(await salesInvoice(inv.id)).toMatchObject({ status: 'open' });
    expect([(await salesInvoice(inv.id)).paidAmount.toString(), (await salesInvoice(inv.id)).balance.toString()]).toEqual(['1000', '2000']);
    const je1 = await run({}, (ctx) => repo(ctx, JournalEntry).get(p1.journalEntryId ?? ''));
    expect(je1).toMatchObject({ docstatus: 1, sourceEntity: 'payment', sourceId: p1.id, date: '2026-08-10', description: `入金 ${p1.number} 得意先A`, reversalOf: null });
    expect([je1.totalDebit.toString(), je1.totalCredit.toString()]).toEqual(['1000', '1000']);
    expect(await entryLines(je1.id)).toEqual([
      ['1100', '1000', '0', customerA, '入金'],
      ['1300', '0', '1000', customerA, `売掛金 ${inv.number}`],
    ]);
    // final: 2,500 received, 2,000 allocated -> 500 前受金; the invoice is paid
    const draft2 = await run(accounting, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '2500', date: '2026-08-20', method: 'other' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '2000' }]));
    const p2 = await run(accounting, (ctx) => submitPayment(ctx, draft2.id));
    expect(p2).toMatchObject({ allocatedAmount: '2000', unallocatedAmount: '500', accountId: acc['1100'] });
    expect(Number(p2.number?.slice(-6))).toBe(Number(p1.number?.slice(-6)) + 1);
    const paid = await salesInvoice(inv.id);
    expect([paid.paidAmount.toString(), paid.balance.toString(), paid.status]).toEqual(['3000', '0', 'paid']);
    expect(await entryLines(p2.journalEntryId ?? '')).toEqual([
      ['1100', '2500', '0', customerA, '入金'],
      ['1300', '0', '2000', customerA, `売掛金 ${inv.number}`],
      ['2400', '0', '500', customerA, '前受金'],
    ]);
    const after = await netByCode();
    expect([delta(after, before, '1100'), delta(after, before, '1300'), delta(after, before, '2400')]).toEqual(['3500', '-3000', '-500']);
    // frozen: lines on every path, header fields outside allowOnSubmit; a paid invoice takes no new allocation
    const lineId = draft1.lines.payment_allocation[0]?.id ?? '';
    await expect(run({}, (ctx) => runAction(ctx, 'payment.update', { id: p1.id, patch: { lines: { payment_allocation: [] } } }))).rejects.toBeInstanceOf(StateError);
    const frozen = await caught(run({}, (ctx) => repo(ctx, PaymentAllocation).update(lineId, { amount: '9' })));
    expect(frozen).toMatchObject({ code: 'INVALID_STATE', hint: 'Use the owning module operation, or cancel and amend.' });
    await expect(run({}, (ctx) => repo(ctx, PaymentAllocation).delete(lineId))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, PaymentAllocation).create({ paymentId: p1.id, invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '1' }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => runAction(ctx, 'payment.update', { id: p1.id, patch: { amount: '1' } }))).rejects.toMatchObject({ code: 'INVALID_STATE', details: { blocked: ['amount'] } });
    await expect(run({}, (ctx) => repo(ctx, Payment).delete(p1.id))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '1' }]))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'invoiceId', message: expect.stringContaining('status paid') }, { path: 'amount', message: 'must be <= the invoice balance 0' }] },
    });
    // a submit that fails (account code missing) leaves the draft, the invoice and the ledger untouched
    const inv2 = await postSalesInvoice(customerA, '100');
    const posted = await netByCode();
    const d = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '100' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv2.id, amount: '100' }]));
    await run({}, (ctx) => setSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, { cash: '1000', bank: '1100', receivable: '1300', payable: '2100', advanceReceived: '2499', advancePaid: '1900' }));
    const err = await caught(run({}, (ctx) => submitPayment(ctx, d.id)));
    expect(err).toMatchObject({ code: 'INVALID_STATE', details: { setting: PAYMENT_ACCOUNTS_KEY, missing: { advanceReceived: '2499' } } });
    await run({}, (ctx) => setSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, { cash: '1000', bank: '1100', receivable: '1300', payable: '2100', advanceReceived: '2400', advancePaid: '1900' }));
    expect((await run({}, (ctx) => repo(ctx, Payment).get(d.id))).docstatus).toBe(0);
    expect((await salesInvoice(inv2.id)).paidAmount.toString()).toBe('0');
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceId: d.id }))).toBe(0);
    expect(await netByCode()).toEqual(posted);
  });

  it('AC-3 / AC-7 pay cycle (purchasing role): Dr 買掛金 / Dr 前払金 / Cr 現金 -> bill paid', async () => {
    const b = await postBill(supplierS, '5000');
    const before = await netByCode();
    const draft = await run(purchasing, (ctx) => createPayment(ctx, { direction: 'pay', partnerId: supplierS, amount: '6000', method: 'cash', date: '2026-08-25' }, [{ invoiceEntity: 'purchase_invoice', invoiceId: b.id, amount: '5000' }]));
    expect(draft).toMatchObject({ accountId: acc['1000'], allocatedAmount: '5000', unallocatedAmount: '1000' });
    const p = await run(purchasing, (ctx) => submitPayment(ctx, draft.id));
    expect(p).toMatchObject({ docstatus: 1, allocatedAmount: '5000', unallocatedAmount: '1000' });
    const paid = await bill(b.id);
    expect([paid.paidAmount.toString(), paid.balance.toString(), paid.status]).toEqual(['5000', '0', 'paid']);
    const je = await run({}, (ctx) => repo(ctx, JournalEntry).get(p.journalEntryId ?? ''));
    expect(je).toMatchObject({ sourceEntity: 'payment', sourceId: p.id, date: '2026-08-25', description: `支払 ${p.number} 仕入先S` });
    expect(await entryLines(je.id)).toEqual([
      ['2100', '5000', '0', supplierS, `買掛金 ${b.number}`],
      ['1900', '1000', '0', supplierS, '前払金'],
      ['1000', '0', '6000', supplierS, '支払'],
    ]);
    const after = await netByCode();
    expect([delta(after, before, '2100'), delta(after, before, '1900'), delta(after, before, '1000')]).toEqual(['5000', '1000', '-6000']);
    // an advance with no allocation at all: Dr 前払金 / Cr 普通預金
    const adv = await run(purchasing, (ctx) => createPayment(ctx, { direction: 'pay', partnerId: supplierS, amount: '300', date: '2026-08-26' }));
    const advP = await run(purchasing, (ctx) => submitPayment(ctx, adv.id));
    expect(await entryLines(advP.journalEntryId ?? '')).toEqual([
      ['1900', '300', '0', supplierS, '前払金'],
      ['1100', '0', '300', supplierS, '支払'],
    ]);
  });

  it('AC-4 cancel un-applies the allocations and reverses the entry (balances and trial balance restored); amend gives a clean draft', async () => {
    const inv = await postSalesInvoice(customerA, '4000', '2026-08-03');
    const tb0 = await trialBalance();
    const net0 = await netByCode();
    const d1 = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1000', date: '2026-08-11' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '1000' }]));
    const p1 = await run({}, (ctx) => submitPayment(ctx, d1.id));
    const tb1 = await trialBalance();
    const net1 = await netByCode();
    const d2 = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '3500', date: '2026-08-12' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '3000' }]));
    const p2 = await run({}, (ctx) => submitPayment(ctx, d2.id));
    expect((await salesInvoice(inv.id)).status).toBe('paid');
    const tbPaid = await trialBalance();
    expect(['1100', '1300', '2400'].map((c) => closing(tbPaid, c))).not.toEqual(['1100', '1300', '2400'].map((c) => closing(tb1, c)));
    // sales may not cancel (spec AC-6); accounting may
    await expect(run(sales, (ctx) => runAction(ctx, 'payment.cancel', { id: p2.id }))).rejects.toBeInstanceOf(PermissionDenied);
    const cancelled = (await run(accounting, (ctx) => runAction(ctx, 'payment.cancel', { id: p2.id }))) as PaymentJson;
    expect(cancelled).toMatchObject({ docstatus: 2, allocatedAmount: '3000', unallocatedAmount: '500', journalEntryId: p2.journalEntryId });
    const reopened = await salesInvoice(inv.id);
    expect([reopened.paidAmount.toString(), reopened.balance.toString(), reopened.status]).toEqual(['1000', '3000', 'open']);
    const reversals = await run({}, (ctx) => repo(ctx, JournalEntry).list({ where: { reversalOf: p2.journalEntryId } }));
    expect(reversals.items.map((e) => [e.docstatus, e.date, e.totalDebit.toString()])).toEqual([[1, '2026-08-12', '3500']]);
    expect(await netByCode()).toEqual(net1);
    const tb2 = await trialBalance();
    for (const c of ['1000', '1100', '1300', '2100', '2400', '1900']) expect(closing(tb2, c)).toBe(closing(tb1, c));
    // cancel again / cancel a draft -> INVALID_STATE; the reopened invoice takes allocations again
    await expect(run({}, (ctx) => runAction(ctx, 'payment.cancel', { id: p2.id }))).rejects.toBeInstanceOf(StateError);
    const someDraft = await run({}, (c) => createPayment(c, { direction: 'receive', partnerId: customerA, amount: '1' }));
    await expect(run({}, (ctx) => runAction(ctx, 'payment.cancel', { id: someDraft.id }))).rejects.toBeInstanceOf(StateError);
    // amend: a new draft with the copied allocations, system fields reset, numbered <original>-1 at submit
    const amended = (await run(accounting, (ctx) => runAction(ctx, 'payment.amend', { id: p2.id }))) as PaymentJson;
    expect(amended).toMatchObject({ docstatus: 0, number: null, amendedFrom: p2.id, amount: '3500', allocatedAmount: '3000', unallocatedAmount: '500', journalEntryId: null, direction: 'receive', partnerId: customerA, date: '2026-08-12' });
    expect((await run({}, (ctx) => getPayment(ctx, amended.id))).lines.payment_allocation.map((l) => [l.invoiceId, l.amount])).toEqual([[inv.id, '3000']]);
    const resubmitted = await run(accounting, (ctx) => submitPayment(ctx, amended.id));
    expect(resubmitted.number).toBe(`${p2.number}-1`);
    expect((await salesInvoice(inv.id)).status).toBe('paid');
    expect(resubmitted.journalEntryId).not.toBe(p2.journalEntryId);
    // cancel everything -> back to the state before any payment; the invoice can then be cancelled by sales (paidAmount 0)
    await run(accounting, (ctx) => runAction(ctx, 'payment.cancel', { id: resubmitted.id }));
    await run(accounting, (ctx) => runAction(ctx, 'payment.cancel', { id: p1.id }));
    expect(await netByCode()).toEqual(net0);
    const tb3 = await trialBalance();
    for (const c of ['1000', '1100', '1300', '2100', '2400', '1900']) expect(closing(tb3, c)).toBe(closing(tb0, c));
    expect((await salesInvoice(inv.id)).paidAmount.toString()).toBe('0');
    expect(((await run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: inv.id }))) as InvoiceJson).status).toBe('cancelled');
    // a cancelled payment is read-only; its allocations cannot be touched
    await expect(run({}, (ctx) => runAction(ctx, 'payment.update', { id: p1.id, patch: { note: 'x' } }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, PaymentAllocation).delete(d1.lines.payment_allocation[0]?.id ?? ''))).rejects.toBeInstanceOf(StateError);
  });

  it('AC-5 payment.outstanding: open invoices with balances per direction (and partner) as a TableResult; role gates', async () => {
    const c = (await run({}, (ctx) => repo(ctx, Partner).create({ name: 'C工業', isCustomer: true, isSupplier: true }))).id;
    const i1 = await postSalesInvoice(c, '1000', '2026-07-01');
    const i2 = await postSalesInvoice(c, '2000', '2026-07-02');
    const i3 = await postSalesInvoice(c, '500', '2026-07-03');
    const b1 = await postBill(c, '800', '2026-07-04');
    const half = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: c, amount: '1500', date: '2026-07-10' }, [{ invoiceEntity: 'sales_invoice', invoiceId: i2.id, amount: '1500' }]));
    await run({}, (ctx) => submitPayment(ctx, half.id));
    const full = await run({}, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: c, amount: '500', date: '2026-07-11' }, [{ invoiceEntity: 'sales_invoice', invoiceId: i3.id, amount: '500' }]));
    await run({}, (ctx) => submitPayment(ctx, full.id));
    await run({}, (ctx) => runAction(ctx, 'sales_invoice.create', { partnerId: c, date: '2026-07-05', lines: { sales_invoice_line: [{ description: 'draft', unitPrice: '9', taxCategory: 'exempt' }] } }));
    const t = (await run(viewer, (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'receive', partnerId: c }))) as Table;
    expect(tableResult.safeParse(t).success).toBe(true);
    expect(t.title).toEqual({ ja: '未入金の売上請求書', en: 'Outstanding sales invoices' });
    expect(t.columns.map((col) => [col.key, col.kind, col.ref ?? null])).toEqual([
      ['number', 'text', null],
      ['partnerName', 'text', null],
      ['date', 'date', null],
      ['dueDate', 'date', null],
      ['total', 'decimal', null],
      ['paidAmount', 'decimal', null],
      ['balance', 'decimal', null],
      ['invoiceId', 'ref', 'sales_invoice'],
      ['partnerId', 'ref', 'partner'],
    ]);
    expect(t.rows).toEqual([
      { invoiceId: i1.id, number: i1.number, partnerId: c, partnerName: 'C工業', date: '2026-07-01', dueDate: '2026-08-31', total: '1000', paidAmount: '0', balance: '1000' },
      { invoiceId: i2.id, number: i2.number, partnerId: c, partnerName: 'C工業', date: '2026-07-02', dueDate: '2026-08-31', total: '2000', paidAmount: '1500', balance: '500' },
    ]);
    expect(t.totals).toEqual({ total: '3000', paidAmount: '1500', balance: '1500' });
    expect(t.meta).toEqual({ direction: 'receive', invoiceEntity: 'sales_invoice', partnerId: c, truncated: false });
    // without a partner: every open invoice, oldest first; the pay direction lists bills
    const all = (await run(accounting, (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'receive' }))) as Table;
    expect(all.rows.map((r) => r.invoiceId)).toContain(i1.id);
    expect(all.rows.map((r) => r.invoiceId)).not.toContain(i3.id);
    expect(all.rows.map((r) => String(r.date))).toEqual([...all.rows.map((r) => String(r.date))].sort());
    expect(all.meta?.partnerId).toBeNull();
    const bills = (await run(purchasing, (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'pay', partnerId: c }))) as Table;
    expect(bills.title.en).toBe('Outstanding purchase invoices');
    expect(bills.columns.find((col) => col.key === 'invoiceId')?.ref).toBe('purchase_invoice');
    expect(bills.rows).toEqual([{ invoiceId: b1.id, number: b1.number, partnerId: c, partnerName: 'C工業', date: '2026-07-04', dueDate: '2026-08-31', total: '800', paidAmount: '0', balance: '800' }]);
    // gates: sales cannot list bills, purchasing cannot list invoices, nobody cannot read payments; input validated
    expect(((await run(sales, (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'receive', partnerId: c }))) as Table).rows).toHaveLength(2);
    await expect(run(sales, (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'pay' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(purchasing, (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'receive' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(asRole(['nobody']), (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'receive' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => runAction(ctx, 'payment.outstanding', {}))).rejects.toBeInstanceOf(ValidationError);
    await expect(run({}, (ctx) => runAction(ctx, 'payment.outstanding', { direction: 'in' }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-6 permissions: accounting all; sales receive only; purchasing pay only (hook + row rules); viewer read', async () => {
    const ops = (roles: string[], entity: string) => run(asRole(roles), async (ctx) => appMeta(ctx).entities.find((e) => e.name === entity)?.ops);
    expect(await ops(['accounting'], 'payment')).toEqual(['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend']);
    expect(await ops(['sales'], 'payment')).toEqual(['read', 'create', 'update', 'submit']);
    expect(await ops(['purchasing'], 'payment')).toEqual(['read', 'create', 'update', 'submit']);
    expect(await ops(['viewer'], 'payment')).toEqual(['read']);
    expect(await ops(['sales'], 'payment_allocation')).toEqual(['read', 'create', 'update', 'delete']);
    expect(await ops(['viewer'], 'payment_allocation')).toEqual(['read']);
    const inv = await postSalesInvoice(customerA, '100');
    const b = await postBill(supplierS, '100');
    // the hook: direction vs role on create, update and submit
    const salesPay = await caught(run(sales, (ctx) => createPayment(ctx, { direction: 'pay', partnerId: supplierS, amount: '1' })));
    expect(salesPay).toBeInstanceOf(PermissionDenied);
    expect(salesPay).toMatchObject({ code: 'PERMISSION_DENIED', details: { entity: 'payment', op: 'create:pay', roles: ['sales'] } });
    await expect(run(purchasing, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1' }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { op: 'create:receive' } });
    const receive = await run(sales, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '100' }, [{ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: '100' }]));
    await expect(run(sales, (ctx) => runAction(ctx, 'payment.update', { id: receive.id, patch: { direction: 'pay' } }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { op: 'update:pay' } });
    // row rules: a pay payment is invisible to sales (get/list/update/submit), a receive one to purchasing; accounting/viewer see both
    const pay = await run(accounting, (ctx) => createPayment(ctx, { direction: 'pay', partnerId: supplierS, amount: '100' }, [{ invoiceEntity: 'purchase_invoice', invoiceId: b.id, amount: '100' }]));
    await expect(run(sales, (ctx) => getPayment(ctx, pay.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(run(sales, (ctx) => runAction(ctx, 'payment.update', { id: pay.id, patch: { note: 'x' } }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(run(sales, (ctx) => submitPayment(ctx, pay.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(run(purchasing, (ctx) => getPayment(ctx, receive.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const listed = async (params: Partial<ContextParams>) => (await run(params, (ctx) => repo(ctx, Payment).list({ where: { id: { $in: [receive.id, pay.id] } } }))).items.map((p) => p.direction).sort();
    expect(await listed(sales)).toEqual(['receive']);
    expect(await listed(purchasing)).toEqual(['pay']);
    expect(await listed(accounting)).toEqual(['pay', 'receive']);
    expect(await listed(viewer)).toEqual(['pay', 'receive']);
    expect(await listed(asRole(['sales', 'purchasing']))).toEqual(['pay', 'receive']);
    const lines = async (params: Partial<ContextParams>) => (await run(params, (ctx) => repo(ctx, PaymentAllocation).list({ where: { paymentId: { $in: [receive.id, pay.id] } } }))).items.map((l) => l.invoiceEntity).sort();
    expect(await lines(sales)).toEqual(['sales_invoice']);
    expect(await lines(purchasing)).toEqual(['purchase_invoice']);
    expect(await lines(viewer)).toEqual(['purchase_invoice', 'sales_invoice']);
    // viewer: read with lines, nothing else; nobody: nothing
    expect((await run(viewer, (ctx) => getPayment(ctx, receive.id))).lines.payment_allocation).toHaveLength(1);
    await expect(run(viewer, (ctx) => createPayment(ctx, { direction: 'receive', partnerId: customerA, amount: '1' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(viewer, (ctx) => runAction(ctx, 'payment.update', { id: receive.id, patch: { note: 'x' } }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(viewer, (ctx) => submitPayment(ctx, receive.id))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(asRole(['nobody']), (ctx) => getPayment(ctx, receive.id))).rejects.toBeInstanceOf(PermissionDenied);
    // the operating roles complete their own cycle (applyPayment + posting run in their context); no cancel/delete/amend for them
    const p = await run(sales, (ctx) => submitPayment(ctx, receive.id));
    expect(p.docstatus).toBe(1);
    expect((await salesInvoice(inv.id)).status).toBe('paid');
    const q = await run(purchasing, (ctx) => submitPayment(ctx, pay.id));
    expect((await bill(b.id)).status).toBe('paid');
    for (const role of [sales, purchasing]) {
      await expect(run(role, (ctx) => runAction(ctx, 'payment.cancel', { id: p.id }))).rejects.toBeInstanceOf(PermissionDenied);
      await expect(run(role, (ctx) => runAction(ctx, 'payment.amend', { id: p.id }))).rejects.toBeInstanceOf(PermissionDenied);
      await expect(run(role, (ctx) => repo(ctx, Payment).delete(p.id))).rejects.toBeInstanceOf(PermissionDenied);
    }
    // accounting can cancel both directions and delete a draft (allocations cascade)
    await run(accounting, (ctx) => runAction(ctx, 'payment.cancel', { id: q.id }));
    expect((await bill(b.id)).status).toBe('open');
    const draft = await run(purchasing, (ctx) => createPayment(ctx, { direction: 'pay', partnerId: supplierS, amount: '5' }, [{ invoiceEntity: 'purchase_invoice', invoiceId: b.id, amount: '5' }]));
    await expect(run(purchasing, (ctx) => repo(ctx, Payment).delete(draft.id))).rejects.toBeInstanceOf(PermissionDenied);
    await run(accounting, (ctx) => repo(ctx, Payment).delete(draft.id));
    expect(await run({}, (ctx) => repo(ctx, PaymentAllocation).count({ paymentId: draft.id }))).toBe(0);
  });

  it('AC-7 trial balance consistency: the ledger balances and the AR/AP/advance accounts equal the open documents', async () => {
    const t = await trialBalance();
    expect(tableResult.safeParse(t).success).toBe(true);
    expect(t.totals?.periodDebit).toBe(t.totals?.periodCredit);
    expect(t.totals?.closingBalance).toBe('0');
    const sumBalance = async (entity: typeof SalesInvoice | typeof PurchaseInvoice) =>
      run({}, async (ctx) => {
        const rows = await repo(ctx, entity).aggregate({ where: { docstatus: DOCSTATUS.submitted, status: { $in: ['open', 'paid'] } }, metrics: { balance: { sum: 'balance' } } });
        return (rows[0]?.balance as Decimal).toString();
      });
    const sumUnallocated = async (direction: 'receive' | 'pay') =>
      run({}, async (ctx) => {
        const rows = await repo(ctx, Payment).aggregate({ where: { docstatus: DOCSTATUS.submitted, direction }, metrics: { unallocated: { sum: 'unallocatedAmount' } } });
        return (rows[0]?.unallocated as Decimal).toString();
      });
    expect(closing(t, '1300')).toBe(await sumBalance(SalesInvoice));
    expect(closing(t, '2100')).toBe(Decimal.from(await sumBalance(PurchaseInvoice)).neg().toString());
    expect(closing(t, '2400')).toBe(Decimal.from(await sumUnallocated('receive')).neg().toString());
    expect(closing(t, '1900')).toBe(await sumUnallocated('pay'));
    expect(Decimal.from(closing(t, '1300')).gt(0)).toBe(true);
    expect(Decimal.from(closing(t, '2400')).lt(0)).toBe(true);
  });
});
