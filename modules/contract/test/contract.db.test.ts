// Postgres tests for docs/specs/contract.md AC-1..AC-7. Test DB: daifuku_test_contract (TEST_DATABASE_URL*).
// The dependency modules (partner, product, tax, accounting, sales) are registered by importing ../src/index.ts
// (sales imports accounting). mod-accounting is not a dependency of this package, so accounts and the fiscal year are
// seeded through the generic `account.create` and `accounting.open_fiscal_year` actions.
import { allowedOps, DOCSTATUS, newId, PermissionDenied, registerCrudActions, registry, repo, runAction, setSetting, StateError, systemParams, ValidationError, withContext, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { Product, seedUoms } from '@daifuku/mod-product';
import { SalesInvoice } from '@daifuku/mod-sales';
import { TAX_PRICE_INCLUDES_TAX_KEY, TaxModule, taxPriceIncludesTaxSchema } from '@daifuku/mod-tax';
import { tableResult } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTRACT_AUTO_SUBMIT_KEY,
  CONTRACT_DEFAULT_PRORATION_KEY,
  Contract,
  ContractBilling,
  ContractLine,
  ContractModule,
  DATE_RANGE_HINT,
  END_STATE_HINT,
  INVOICE_GENERATED_EVENT,
  LIVE_INVOICES_HINT,
  NO_LINES_HINT,
  contractAutoSubmitSchema,
  contractDefaultProrationSchema,
} from '../src/index.ts';

type Row = Record<string, unknown>;
type ContractLineJson = Row & { id: string; seq: number; productId: string | null; description: string; quantity: string; unitPrice: string; taxCategory: string; amount: string };
type ContractJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  version: number;
  partnerId: string;
  title: string;
  startDate: string;
  endDate: string | null;
  billingDay: number;
  billingTiming: string;
  intervalMonths: number;
  prorationRule: string;
  roundingMode: string;
  status: string;
  nextPeriod: string | null;
  amendedFrom: string | null;
};
type ContractWithLines = ContractJson & { lines: { contract_line: ContractLineJson[] } };
type InvoiceLineJson = Row & { seq: number; productId: string | null; description: string; quantity: string; unitPrice: string; taxCategory: string; amount: string };
type InvoiceJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  partnerId: string;
  date: string;
  dueDate: string | null;
  note: string | null;
  priceIncludesTax: boolean;
  subtotal: string;
  taxTotal: string;
  total: string;
  status: string;
  journalEntryId: string | null;
  taxSummary: { category: string; taxable: string; tax: string }[];
  lines: { sales_invoice_line: InvoiceLineJson[] };
};
type Generated = { created: { contractId: string; invoiceId: string; number: string | null; total: string }[]; skipped: { contractId: string; reason: string; invoiceId?: string; number?: string | null }[] };
type Table = { title: { ja: string; en: string }; columns: { key: string; kind: string; ref?: string }[]; rows: Row[]; totals?: Record<string, string>; meta?: Row };

/** 2026-09-10 12:00 JST: today for status (ended = endDate before 2026-09-01). */
const FIXED_NOW = new Date('2026-09-10T03:00:00Z');
let db: TestDb;
let partnerA: string;
let partnerB: string;
let partnerC: string;
let rentProduct: string;

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) => db.run({ now: () => FIXED_NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const caught = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);
const issues = (e: unknown) => ((e as ValidationError).details as { issues: { path: string; message: string }[] }).issues;

const rentLine = (unitPrice = '100000', over: Row = {}): Row => ({ description: '賃料', unitPrice, taxCategory: 'standard', ...over });

async function createContract(head: Row, lines: Row[], params: Partial<ContextParams> = {}): Promise<ContractWithLines> {
  return run(params, async (ctx) => (await runAction(ctx, 'contract.create', { partnerId: partnerA, title: '契約', startDate: '2026-05-22', ...head, lines: { contract_line: lines } })) as ContractWithLines);
}
async function getContract(id: string): Promise<ContractWithLines> {
  return run({}, async (ctx) => (await runAction(ctx, 'contract.get', { id })) as ContractWithLines);
}
async function submitContract(id: string, params: Partial<ContextParams> = {}): Promise<ContractJson> {
  return run(params, async (ctx) => (await runAction(ctx, 'contract.submit', { id })) as ContractJson);
}
/** create + submit in separate transactions. */
async function activeContract(head: Row, lines: Row[] = [rentLine()], params: Partial<ContextParams> = {}): Promise<ContractJson> {
  const draft = await createContract(head, lines, params);
  return submitContract(draft.id, params);
}
async function generate(input: Row, params: Partial<ContextParams> = {}): Promise<Generated> {
  return run(params, async (ctx) => (await runAction(ctx, 'contract.generate_invoices', input)) as Generated);
}
async function getInvoice(id: string): Promise<InvoiceJson> {
  return run({}, async (ctx) => (await runAction(ctx, 'sales_invoice.get', { id })) as InvoiceJson);
}
async function endContract(id: string, endDate: string, params: Partial<ContextParams> = {}): Promise<ContractJson> {
  return run(params, async (ctx) => (await runAction(ctx, 'contract.end', { id, endDate })) as ContractJson);
}
async function schedule(period: string, params: Partial<ContextParams> = {}): Promise<Table> {
  return run(params, async (ctx) => (await runAction(ctx, 'contract.schedule', { period })) as Table);
}
/** The one invoice created for `contractId` by a generate call. */
async function createdInvoice(result: Generated, contractId: string): Promise<InvoiceJson> {
  const item = result.created.find((c) => c.contractId === contractId);
  expect(item).toBeDefined();
  return getInvoice(item?.invoiceId ?? '');
}
const lineView = (inv: InvoiceJson) => inv.lines.sales_invoice_line.map((l) => [l.seq, l.description, l.quantity, l.unitPrice, l.taxCategory, l.amount]);
const taxView = (inv: InvoiceJson) => inv.taxSummary.map((g) => [g.category, g.taxable, g.tax]);

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => FIXED_NOW }), async (ctx) => {
    await seedUoms(ctx);
    await TaxModule.seed?.(ctx);
  });
  await run({}, async (ctx) => {
    await runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-01-01' });
    await runAction(ctx, 'account.create', { code: '1300', name: '売掛金', type: 'asset', subtype: '売掛金', partnerRequired: true });
    await runAction(ctx, 'account.create', { code: '4000', name: '売上高', type: 'revenue', subtype: '売上' });
    await runAction(ctx, 'account.create', { code: '2200', name: '仮受消費税', type: 'liability', subtype: '仮受消費税' });
  });
  partnerA = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '得意先A', isCustomer: true, closingDay: 31, paymentMonthOffset: 1, paymentDay: 31 }))).id;
  partnerB = (await run({}, (ctx) => repo(ctx, Partner).create({ name: 'B商事', isCustomer: true, closingDay: 31, paymentMonthOffset: 0, paymentDay: 31 }))).id;
  partnerC = (await run({}, (ctx) => repo(ctx, Partner).create({ name: 'C不動産', isCustomer: true, closingDay: 31, paymentMonthOffset: 1, paymentDay: 10 }))).id;
  rentProduct = (await run({}, (ctx) => repo(ctx, Product).create({ code: 'RENT', name: '事務所賃料', salePrice: '100000', taxCategory: 'standard' }))).id;
});
afterAll(async () => {
  await db.close();
});

describe('contract module (docs/specs/contract.md)', () => {
  it('AC-1 / AC-2 draft defaults, lines from the product, validation, submit -> active + nextPeriod, frozen after submit', async () => {
    await expect(createContract({ status: 'active', nextPeriod: '2020-01' }, [rentLine()])).rejects.toBeInstanceOf(PermissionDenied);
    const c = await createContract({ title: '渋谷オフィス' }, [{ productId: rentProduct }, { description: '住宅部分', unitPrice: '50000', taxCategory: 'non_taxable', quantity: '1' }]);
    expect(c).toMatchObject({ docstatus: 0, number: null, status: 'draft', nextPeriod: null, billingDay: 1, billingTiming: 'advance', intervalMonths: 1, prorationRule: 'daily', roundingMode: 'down', endDate: null, startDate: '2026-05-22' });
    expect(c.lines.contract_line.map((l) => [l.seq, l.productId, l.description, l.quantity, l.unitPrice, l.taxCategory, l.amount])).toEqual([
      [1, rentProduct, '事務所賃料', '1', '100000', 'standard', '100000'],
      [2, null, '住宅部分', '1', '50000', 'non_taxable', '50000'],
    ]);
    // validation
    const range = await caught(createContract({ startDate: '2026-05-22', endDate: '2026-05-21' }, [rentLine()]));
    expect(range).toMatchObject({ code: 'VALIDATION', hint: DATE_RANGE_HINT, details: { issues: [{ path: 'endDate' }] } });
    const patchRange = await caught(run({}, (ctx) => runAction(ctx, 'contract.update', { id: c.id, patch: { endDate: '2026-01-01' } })));
    expect(issues(patchRange)[0]?.path).toBe('endDate');
    await expect(createContract({ billingDay: 32 }, [rentLine()])).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'billingDay' }] } });
    await expect(createContract({ intervalMonths: 0 }, [rentLine()])).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'intervalMonths' }] } });
    await expect(createContract({ title: undefined }, [rentLine()])).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'title' }] } });
    await expect(createContract({ billingTiming: 'monthly' }, [rentLine()])).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'billingTiming' }] } });
    await expect(createContract({}, [{ description: 'x', unitPrice: '1' }])).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'taxCategory' }] } });
    // submit: at least one line
    const empty = await createContract({}, []);
    const noLines = await caught(submitContract(empty.id));
    expect(noLines).toBeInstanceOf(ValidationError);
    expect(noLines).toMatchObject({ hint: NO_LINES_HINT, details: { issues: [{ path: 'lines' }] } });
    expect((await getContract(empty.id)).docstatus).toBe(0);
    // submit -> active, nextPeriod = month of startDate
    const s = await submitContract(c.id);
    expect(s).toMatchObject({ docstatus: 1, status: 'active', nextPeriod: '2026-05' });
    expect(s.number).toMatch(/^CTR-\d{4}-\d{6}$/);
    // frozen: lines on every path, header fields outside allowOnSubmit; system-owned fields are re-derived, not taken from the patch
    const lineId = c.lines.contract_line[0]?.id ?? '';
    expect(await caught(run({}, (ctx) => repo(ctx, ContractLine).update(lineId, { quantity: '2' })))).toMatchObject({ code: 'INVALID_STATE', hint: 'Use the owning module operation, or cancel and amend.' });
    await expect(run({}, (ctx) => repo(ctx, ContractLine).delete(lineId))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, ContractLine).create({ contractId: c.id, description: 'x', unitPrice: '1', taxCategory: 'standard' }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => runAction(ctx, 'contract.update', { id: c.id, patch: { lines: { contract_line: [] } } }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => runAction(ctx, 'contract.update', { id: c.id, patch: { title: '変更' } }))).rejects.toMatchObject({ code: 'INVALID_STATE', details: { blocked: ['title'] } });
    await expect(run({}, (ctx) => runAction(ctx, 'contract.update', { id: c.id, patch: { status: 'cancelled', nextPeriod: '2030-01' } }))).rejects.toBeInstanceOf(PermissionDenied);
    expect(await getContract(c.id)).toMatchObject({ docstatus: 1, status: 'active', nextPeriod: '2026-05' });
    // a draft ignores them too
    await expect(run({}, (ctx) => runAction(ctx, 'contract.update', { id: empty.id, patch: { status: 'active', nextPeriod: '2026-01' } }))).rejects.toBeInstanceOf(PermissionDenied);
    expect(await getContract(empty.id)).toMatchObject({ status: 'draft', nextPeriod: null });
    // setting contract.default_proration fills an omitted prorationRule; an explicit value is kept
    await run({}, (ctx) => setSetting(ctx, CONTRACT_DEFAULT_PRORATION_KEY, contractDefaultProrationSchema, 'none'));
    try {
      expect((await createContract({}, [rentLine()])).prorationRule).toBe('none');
      expect((await createContract({ prorationRule: 'daily' }, [rentLine()])).prorationRule).toBe('daily');
    } finally {
      await run({}, (ctx) => setSetting(ctx, CONTRACT_DEFAULT_PRORATION_KEY, contractDefaultProrationSchema, 'daily'));
    }
  });

  it('AC-3 / AC-4 start month prorated, full month, idempotent second call, nextPeriod; totals and tax through sales', async () => {
    const a = await activeContract({ title: '渋谷オフィス', billingDay: 27 }, [{ productId: rentProduct }, { description: '住宅部分', unitPrice: '50000', taxCategory: 'non_taxable' }]);
    // start month 2026-05: 10 of 31 days. 100,000 × 10/31 = 32,258.06 → 32,258 (down); 50,000 × 10/31 = 16,129.03 → 16,129
    const may = await generate({ period: '2026-05', contractId: a.id });
    expect(may.skipped).toEqual([]);
    expect(may.created).toEqual([{ contractId: a.id, invoiceId: expect.any(String), number: null, total: '51612' }]);
    const mayInv = await createdInvoice(may, a.id);
    expect(mayInv).toMatchObject({ docstatus: 0, partnerId: partnerA, date: '2026-05-27', dueDate: '2026-06-30', priceIncludesTax: false, note: `契約 ${a.number} 2026-05 分`, subtotal: '48387', taxTotal: '3225', total: '51612' });
    expect(lineView(mayInv)).toEqual([
      [1, '事務所賃料', '1', '32258', 'standard', '32258'],
      [2, '住宅部分', '1', '16129', 'non_taxable', '16129'],
    ]);
    expect(mayInv.lines.sales_invoice_line[0]?.productId).toBe(rentProduct);
    expect(taxView(mayInv)).toEqual([
      ['standard', '32258', '3225'],
      ['non_taxable', '16129', '0'],
    ]);
    expect((await getContract(a.id)).nextPeriod).toBe('2026-06');
    // full month 2026-06, submitted: 100,000 standard → tax 10,000; non_taxable 50,000 → tax 0
    const june = await generate({ period: '2026-06', contractId: a.id, submit: true });
    expect(june.created).toEqual([{ contractId: a.id, invoiceId: expect.any(String), number: expect.stringMatching(/^INV-2026-\d{6}$/), total: '160000' }]);
    const juneInv = await createdInvoice(june, a.id);
    expect(juneInv).toMatchObject({ docstatus: 1, status: 'open', date: '2026-06-27', subtotal: '150000', taxTotal: '10000', total: '160000', note: `契約 ${a.number} 2026-06 分` });
    expect(juneInv.journalEntryId).toEqual(expect.any(String));
    expect(taxView(juneInv)).toEqual([
      ['standard', '100000', '10000'],
      ['non_taxable', '50000', '0'],
    ]);
    expect(lineView(juneInv)).toEqual([
      [1, '事務所賃料', '1', '100000', 'standard', '100000'],
      [2, '住宅部分', '1', '50000', 'non_taxable', '50000'],
    ]);
    expect((await getContract(a.id)).nextPeriod).toBe('2026-07');
    // idempotent: the second call creates nothing and returns the existing invoice
    const invoicesBefore = await run({}, (ctx) => repo(ctx, SalesInvoice).count({ partnerId: partnerA }));
    const again = await generate({ period: '2026-06', contractId: a.id, submit: true });
    expect(again).toEqual({ created: [], skipped: [{ contractId: a.id, reason: 'already_generated', invoiceId: juneInv.id, number: juneInv.number }] });
    const mayAgain = await generate({ period: '2026-05', contractId: a.id });
    expect(mayAgain.skipped).toEqual([{ contractId: a.id, reason: 'already_generated', invoiceId: mayInv.id, number: null }]);
    expect(await run({}, (ctx) => repo(ctx, SalesInvoice).count({ partnerId: partnerA }))).toBe(invoicesBefore);
    const ledger = await run({}, (ctx) => repo(ctx, ContractBilling).list({ where: { contractId: a.id }, orderBy: [{ field: 'period', dir: 'asc' }] }));
    expect(ledger.items.map((b) => [b.period, b.invoiceId])).toEqual([
      ['2026-05', mayInv.id],
      ['2026-06', juneInv.id],
    ]);
    expect((await getContract(a.id)).nextPeriod).toBe('2026-07');
    // not due before the start month
    expect(await generate({ period: '2026-04', contractId: a.id })).toEqual({ created: [], skipped: [{ contractId: a.id, reason: 'not_started' }] });
    // one event per generated invoice
    const events = await db.owner.sql<{ payload: Row }[]>`select payload from outbox where topic = ${INVOICE_GENERATED_EVENT} and tenant_id = ${db.tenantId}`;
    expect(events.map((e) => e.payload)).toContainEqual({ contractId: a.id, invoiceId: juneInv.id, number: juneInv.number, total: '160000', contractNumber: a.number, period: '2026-06', factor: '1', submitted: true });
    // the ledger is written only by generation: generic create / update / delete are refused, admin included
    const direct = await caught(run({}, (ctx) => repo(ctx, ContractBilling).create({ contractId: a.id, period: '2026-07', invoiceId: mayInv.id })));
    expect(direct).toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(run(asRole(['sales']), (ctx) => runAction(ctx, 'contract_billing.create', { contractId: a.id, period: '2026-08', invoiceId: mayInv.id }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(run({}, (ctx) => repo(ctx, ContractBilling).delete(ledger.items[0]?.id ?? ''))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(run(asRole(['sales']), (ctx) => repo(ctx, ContractBilling).delete(ledger.items[0]?.id ?? ''))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(generate({ period: '2026-6', contractId: a.id })).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'period' }] } });
    // two concurrent runs for the same period: the unique (contractId, period) ledger lets exactly one invoice survive —
    // the other run either sees the row (skipped) or loses the insert race (CONFLICT, its draft invoice rolled back)
    const race = await activeContract({ title: '同時実行', startDate: '2026-06-01' });
    const settled = await Promise.allSettled([generate({ period: '2026-06', contractId: race.id }), generate({ period: '2026-06', contractId: race.id })]);
    const created = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value.created : []));
    expect(created).toHaveLength(1);
    for (const s of settled) {
      if (s.status === 'rejected') expect(s.reason).toMatchObject({ code: 'CONFLICT' });
      else if (s.value.created.length === 0) expect(s.value.skipped).toEqual([{ contractId: race.id, reason: 'already_generated', invoiceId: created[0]?.invoiceId, number: null }]);
    }
    expect(await run({}, (ctx) => repo(ctx, SalesInvoice).count({ note: `契約 ${race.number} 2026-06 分` }))).toBe(1);
    expect(await run({}, (ctx) => repo(ctx, ContractBilling).count({ contractId: race.id }))).toBe(1);
  });

  it('AC-2 / AC-3 end month prorated to endDate, contract.end status rule, a skipped month stays next', async () => {
    const e = await activeContract({ title: '恵比寿店舗', startDate: '2026-06-01' });
    await generate({ period: '2026-06', contractId: e.id });
    // end before this month (today 2026-09-10) -> ended; the months up to endDate stay billable
    const ended = await endContract(e.id, '2026-08-15');
    expect(ended).toMatchObject({ endDate: '2026-08-15', status: 'ended', nextPeriod: '2026-07', docstatus: 1 });
    // generate August first: 15 of 31 days. 100,000 × 15/31 = 48,387.09 → 48,387; tax 4,838 (10% 切捨て)
    const aug = await generate({ period: '2026-08', contractId: e.id });
    const augInv = await createdInvoice(aug, e.id);
    expect(augInv).toMatchObject({ date: '2026-08-01', subtotal: '48387', taxTotal: '4838', total: '53225' });
    expect((await getContract(e.id)).nextPeriod).toBe('2026-07'); // July was skipped: still next
    const jul = await generate({ period: '2026-07', contractId: e.id });
    expect((await createdInvoice(jul, e.id)).subtotal).toBe('100000');
    expect((await getContract(e.id)).nextPeriod).toBe('2026-09');
    expect(await generate({ period: '2026-09', contractId: e.id })).toEqual({ created: [], skipped: [{ contractId: e.id, reason: 'ended' }] });
    // moving endDate into this month re-activates; September is billed to the 20th: 100,000 × 20/30 = 66,666.67 → 66,666
    expect(await endContract(e.id, '2026-09-20')).toMatchObject({ status: 'active', endDate: '2026-09-20' });
    const sep = await generate({ period: '2026-09', contractId: e.id });
    expect((await createdInvoice(sep, e.id)).subtotal).toBe('66666');
    expect((await generate({ period: '2026-10', contractId: e.id })).skipped).toEqual([{ contractId: e.id, reason: 'ended' }]);
    // refusals
    const before = await caught(endContract(e.id, '2026-05-31'));
    expect(before).toMatchObject({ code: 'VALIDATION', hint: DATE_RANGE_HINT, details: { issues: [{ path: 'endDate' }] } });
    const draft = await createContract({}, [rentLine()]);
    expect(await caught(endContract(draft.id, '2026-12-31'))).toMatchObject({ code: 'INVALID_STATE', hint: END_STATE_HINT });
    await expect(endContract(newId(), '2026-12-31')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(run({}, (ctx) => runAction(ctx, 'contract.end', { id: e.id, endDate: '2026/09/30' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'endDate' }] } });
    expect(await generate({ period: '2026-09', contractId: draft.id })).toEqual({ created: [], skipped: [{ contractId: draft.id, reason: 'not_active' }] });
  });

  it('AC-3 arrears timing bills the next month (billingDay 31 = 月末), submit defaults to contract.auto_submit', async () => {
    const b = await activeContract({ partnerId: partnerB, title: '倉庫（後払い）', startDate: '2026-01-01', billingDay: 31, billingTiming: 'arrears' }, [rentLine('200000')]);
    const jan = await generate({ period: '2026-01', contractId: b.id });
    expect(await createdInvoice(jan, b.id)).toMatchObject({ docstatus: 0, date: '2026-02-28', subtotal: '200000', taxTotal: '20000', total: '220000', note: `契約 ${b.number} 2026-01 分` });
    await run({}, (ctx) => setSetting(ctx, CONTRACT_AUTO_SUBMIT_KEY, contractAutoSubmitSchema, true));
    try {
      const june = await generate({ period: '2026-06', contractId: b.id });
      expect(await createdInvoice(june, b.id)).toMatchObject({ docstatus: 1, status: 'open', date: '2026-07-31' });
      expect(june.created[0]?.number).toMatch(/^INV-2026-\d{6}$/);
      const feb = await generate({ period: '2026-02', contractId: b.id, submit: false });
      expect(await createdInvoice(feb, b.id)).toMatchObject({ docstatus: 0, date: '2026-03-31' });
    } finally {
      await run({}, (ctx) => setSetting(ctx, CONTRACT_AUTO_SUBMIT_KEY, contractAutoSubmitSchema, false));
    }
    // nextPeriod: January and February generated, March is the earliest without an invoice
    expect((await getContract(b.id)).nextPeriod).toBe('2026-03');
    // contract prices are tax-exclusive even when the company enters invoice prices tax-inclusive
    await run({}, (ctx) => setSetting(ctx, TAX_PRICE_INCLUDES_TAX_KEY, taxPriceIncludesTaxSchema, true));
    try {
      const mar = await generate({ period: '2026-03', contractId: b.id });
      expect(await createdInvoice(mar, b.id)).toMatchObject({ priceIncludesTax: false, date: '2026-04-30', subtotal: '200000', taxTotal: '20000', total: '220000' });
    } finally {
      await run({}, (ctx) => setSetting(ctx, TAX_PRICE_INCLUDES_TAX_KEY, taxPriceIncludesTaxSchema, false));
    }
    expect((await getContract(b.id)).nextPeriod).toBe('2026-04');
  });

  it('AC-3 intervalMonths bills k monthly prices per invoice (aligned periods only); prorationRule none bills full months', async () => {
    // quarterly from 2026-04-16: April 15/30 + May + June = 5/2 × 10,000 = 25,000
    const q = await activeContract({ title: '保守（四半期）', startDate: '2026-04-16', intervalMonths: 3, billingDay: 25 }, [rentLine('10000', { description: '保守料' })]);
    const apr = await generate({ period: '2026-04', contractId: q.id });
    expect(await createdInvoice(apr, q.id)).toMatchObject({ date: '2026-04-25', subtotal: '25000', taxTotal: '2500', total: '27500' });
    expect(await generate({ period: '2026-05', contractId: q.id })).toEqual({ created: [], skipped: [{ contractId: q.id, reason: 'not_aligned' }] });
    expect((await getContract(q.id)).nextPeriod).toBe('2026-07');
    const jul = await generate({ period: '2026-07', contractId: q.id });
    expect((await createdInvoice(jul, q.id)).subtotal).toBe('30000');
    // none: the start month is billed in full
    const n = await activeContract({ title: '看板（満額）', prorationRule: 'none', billingDay: 5 }, [rentLine('30000')]);
    const may = await generate({ period: '2026-05', contractId: n.id });
    expect(await createdInvoice(may, n.id)).toMatchObject({ date: '2026-05-05', subtotal: '30000' });
    // rounding mode up: 100,000 × 10/31 = 32,258.06 → 32,259
    const up = await activeContract({ title: '切上げ', roundingMode: 'up', billingDay: 27 }, [rentLine()]);
    expect((await createdInvoice(await generate({ period: '2026-05', contractId: up.id }), up.id)).subtotal).toBe('32259');
  });

  it('AC-5 schedule: due / generated / not_due per contract with billing date and prorated expected amount (税抜)', async () => {
    const s1 = await activeContract({ partnerId: partnerC, title: 'S1 10月11日入居', startDate: '2026-10-11', billingDay: 5 });
    const s2 = await activeContract({ partnerId: partnerC, title: 'S2 生成済み', startDate: '2026-09-01', billingDay: 1 });
    const s3 = await activeContract({ partnerId: partnerC, title: 'S3 11月開始', startDate: '2026-11-01' });
    const s4 = await activeContract({ partnerId: partnerC, title: 'S4 四半期', startDate: '2026-09-01', intervalMonths: 3 });
    const s5 = await createContract({ partnerId: partnerC, title: 'S5 下書き', startDate: '2026-09-01' }, [rentLine()]);
    const s6 = await activeContract({ partnerId: partnerC, title: 'S6 8月末終了', startDate: '2026-06-01' });
    await endContract(s6.id, '2026-08-31');
    const gen = await generate({ period: '2026-10', contractId: s2.id, submit: true });
    const s2Invoice = gen.created[0];
    const table = await schedule('2026-10', asRole(['accounting']));
    expect(tableResult.safeParse(table).success).toBe(true);
    expect(table.title).toEqual({ ja: '請求予定 2026-10', en: 'Billing schedule 2026-10' });
    expect(table.columns.map((c) => [c.key, c.kind])).toEqual([
      ['contractNumber', 'text'],
      ['partnerName', 'text'],
      ['title', 'text'],
      ['billingDate', 'date'],
      ['expectedAmount', 'decimal'],
      ['factor', 'text'],
      ['status', 'text'],
      ['reason', 'text'],
      ['invoiceNumber', 'text'],
      ['contractId', 'ref'],
      ['partnerId', 'ref'],
      ['invoiceId', 'ref'],
    ]);
    const byId = new Map(table.rows.map((r) => [r.contractId, r]));
    // 100,000 × 21/31 = 67,741.93 → 67,741
    expect(byId.get(s1.id)).toMatchObject({ partnerName: 'C不動産', title: 'S1 10月11日入居', billingDate: '2026-10-05', expectedAmount: '67741', factor: '21/31', status: 'due', reason: null, invoiceId: null, invoiceNumber: null, contractNumber: s1.number, partnerId: partnerC });
    expect(byId.get(s2.id)).toMatchObject({ billingDate: '2026-10-01', expectedAmount: '100000', factor: '1', status: 'generated', reason: 'already_generated', invoiceId: s2Invoice?.invoiceId, invoiceNumber: s2Invoice?.number });
    expect(byId.get(s3.id)).toMatchObject({ billingDate: null, expectedAmount: '0', factor: null, status: 'not_due', reason: 'not_started' });
    expect(byId.get(s4.id)).toMatchObject({ billingDate: null, expectedAmount: '0', status: 'not_due', reason: 'not_aligned' });
    expect(byId.has(s5.id)).toBe(false); // draft
    expect(byId.has(s6.id)).toBe(false); // ended before the period
    expect(table.rows.every((r) => ['due', 'generated', 'not_due'].includes(String(r.status)))).toBe(true);
    const sum = table.rows.reduce((acc, r) => acc + Number(r.expectedAmount), 0); // integer yen in this data set
    expect(table.totals).toEqual({ expectedAmount: String(sum) });
    expect(table.meta).toMatchObject({ period: '2026-10', truncated: false, counts: { due: table.rows.filter((r) => r.status === 'due').length, generated: table.rows.filter((r) => r.status === 'generated').length } });
    // ordered by billing date, rows without one last
    const dates = table.rows.map((r) => r.billingDate as string | null);
    const firstNull = dates.indexOf(null);
    expect(dates.slice(firstNull === -1 ? dates.length : firstNull).every((d) => d === null)).toBe(true);
    const nonNull = dates.filter((d): d is string => d !== null);
    expect([...nonNull].sort()).toEqual(nonNull);
    // the schedule agrees with a real run: generating October creates exactly the due rows with those amounts
    const run10 = await generate({ period: '2026-10' });
    const dueRows = table.rows.filter((r) => r.status === 'due');
    expect(run10.created.map((c) => c.contractId).sort()).toEqual(dueRows.map((r) => r.contractId).sort());
    for (const r of dueRows) {
      const inv = await createdInvoice(run10, String(r.contractId));
      expect([inv.subtotal, inv.date]).toEqual([r.expectedAmount, r.billingDate]);
    }
    expect(run10.skipped).toEqual(expect.arrayContaining([{ contractId: s2.id, reason: 'already_generated', invoiceId: s2Invoice?.invoiceId, number: s2Invoice?.number }, { contractId: s3.id, reason: 'not_started' }, { contractId: s4.id, reason: 'not_aligned' }]));
    expect(run10.skipped.map((s) => s.contractId)).not.toContain(s5.id);
    const after = await schedule('2026-10', asRole(['viewer']));
    expect(after.rows.filter((r) => r.status === 'due')).toEqual([]);
    await expect(schedule('2026-10', asRole(['nobody']))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-2 cancel is refused while generated invoices are live; deleting a draft invoice makes its period due again; amend starts clean', async () => {
    const x = await activeContract({ title: '取消テスト', startDate: '2026-07-01' });
    const first = await generate({ period: '2026-07', contractId: x.id });
    const draftId = first.created[0]?.invoiceId ?? '';
    const refused = await caught(run({}, (ctx) => runAction(ctx, 'contract.cancel', { id: x.id })));
    expect(refused).toMatchObject({ code: 'INVALID_STATE', hint: LIVE_INVOICES_HINT, details: { invoices: [{ period: '2026-07', invoiceId: draftId, number: null }] } });
    // deleting the draft invoice removes its ledger row: the period is due again
    await run({}, (ctx) => runAction(ctx, 'sales_invoice.delete', { id: draftId }));
    expect(await run({}, (ctx) => repo(ctx, ContractBilling).count({ contractId: x.id }))).toBe(0);
    const second = await generate({ period: '2026-07', contractId: x.id, submit: true });
    const invoiceId = second.created[0]?.invoiceId ?? '';
    expect(second.created).toHaveLength(1);
    await expect(run({}, (ctx) => runAction(ctx, 'contract.cancel', { id: x.id }))).rejects.toMatchObject({ code: 'INVALID_STATE', hint: LIVE_INVOICES_HINT });
    await run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: invoiceId }));
    const cancelled = (await run({}, (ctx) => runAction(ctx, 'contract.cancel', { id: x.id }))) as ContractJson;
    expect(cancelled).toMatchObject({ docstatus: 2, status: 'cancelled' });
    expect(await generate({ period: '2026-08', contractId: x.id })).toEqual({ created: [], skipped: [{ contractId: x.id, reason: 'not_active' }] });
    expect((await generate({ period: '2026-07', contractId: x.id })).skipped).toEqual([{ contractId: x.id, reason: 'not_active', invoiceId, number: second.created[0]?.number }]);
    await expect(endContract(x.id, '2026-12-31')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // amend: a new draft with the lines, system-owned fields reset
    const amended = (await run({}, (ctx) => runAction(ctx, 'contract.amend', { id: x.id }))) as ContractJson;
    expect(amended).toMatchObject({ docstatus: 0, number: null, status: 'draft', nextPeriod: null, amendedFrom: x.id, startDate: '2026-07-01' });
    expect((await getContract(amended.id)).lines.contract_line).toHaveLength(1);
    const resubmitted = await submitContract(amended.id);
    expect(resubmitted).toMatchObject({ number: `${x.number}-1`, status: 'active', nextPeriod: '2026-07' });
  });

  it('AC-6 permissions, settings and menus', async () => {
    expect(allowedOps({ roles: ['sales'] }, Contract).sort()).toEqual(['amend', 'cancel', 'create', 'delete', 'export', 'read', 'submit', 'update']);
    for (const role of ['accounting', 'viewer']) {
      expect(allowedOps({ roles: [role] }, Contract)).toEqual(['read']);
      expect(allowedOps({ roles: [role] }, ContractLine)).toEqual(['read']);
      expect(allowedOps({ roles: [role] }, ContractBilling)).toEqual(['read']);
    }
    expect(allowedOps({ roles: ['admin'] }, Contract)).toHaveLength(8);
    // sales runs the whole cycle
    const sales = asRole(['sales']);
    const c = await activeContract({ title: '営業担当の契約', startDate: '2026-08-01', billingDay: 10 }, [rentLine('80000')], sales);
    const gen = await generate({ period: '2026-08', contractId: c.id, submit: true }, sales);
    expect(gen.created[0]).toMatchObject({ total: '88000', number: expect.stringMatching(/^INV-2026-\d{6}$/) });
    expect(await endContract(c.id, '2026-08-31', sales)).toMatchObject({ status: 'ended' });
    expect((await schedule('2026-08', sales)).rows.some((r) => r.contractId === c.id && r.status === 'generated')).toBe(true);
    // accounting / viewer read only
    for (const role of ['accounting', 'viewer']) {
      await expect(generate({ period: '2026-09', contractId: c.id }, asRole([role]))).rejects.toBeInstanceOf(PermissionDenied);
      await expect(endContract(c.id, '2026-09-30', asRole([role]))).rejects.toBeInstanceOf(PermissionDenied);
      await expect(createContract({}, [rentLine()], asRole([role]))).rejects.toBeInstanceOf(PermissionDenied);
      expect((await run(asRole([role]), (ctx) => runAction(ctx, 'contract.get', { id: c.id }))) as ContractJson).toMatchObject({ id: c.id });
    }
    await expect(generate({ period: '2026-09' }, asRole(['nobody']))).rejects.toBeInstanceOf(PermissionDenied);
    // actions are public (not internal), settings are declared, menus exist
    for (const name of ['contract.generate_invoices', 'contract.end', 'contract.schedule']) expect(registry.actions().map((a) => a.name)).toContain(name);
    expect(registry.action('contract.schedule')).toMatchObject({ tx: 'none', mutates: false });
    expect(registry.action('contract.generate_invoices')).toMatchObject({ tx: 'required', mutates: true, permission: { entity: 'sales_invoice', op: 'create' } });
    expect(registry.hasSetting(CONTRACT_DEFAULT_PRORATION_KEY)).toBe(true);
    expect(registry.hasSetting(CONTRACT_AUTO_SUBMIT_KEY)).toBe(true);
    await expect(run({}, (ctx) => setSetting(ctx, CONTRACT_DEFAULT_PRORATION_KEY, contractDefaultProrationSchema, 'weekly'))).rejects.toBeInstanceOf(ValidationError);
    expect(ContractModule.menus?.map((m) => [m.label.ja, m.entity ?? m.route])).toEqual([
      ['契約一覧', 'contract'],
      ['請求予定', '/r/contract.schedule'],
    ]);
    expect(DOCSTATUS.submitted).toBe(1);
  });
});
