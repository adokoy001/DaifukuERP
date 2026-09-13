// Postgres tests for docs/specs/inventory.md AC-5: hooks on purchase_invoice / sales_invoice (auto receipt / issue and
// their cancellation), run through the generic actions in the purchasing / sales roles. Test DB: daifuku_test_inventory.
import { DOCSTATUS, repo, setSetting, StateError, type ContextParams } from '@daifuku/kernel';
import { JournalEntry } from '@daifuku/mod-accounting';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTO_ISSUE_ON_SALES_KEY,
  AUTO_RECEIPT_ON_PURCHASE_KEY,
  boolSettingSchema,
  DEFAULT_WAREHOUSE_HINT,
  DEFAULT_WAREHOUSE_KEY,
  loadBalance,
  warehouseCodeSchema,
} from '../src/index.ts';
import { asRole, caught, setupFixture, type EntryWithLines, type Fixture, type Row } from './fixture.ts';

type InvoiceJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  status: string;
  journalEntryId: string | null;
  total: string;
};

let fx: Fixture;
const purchasing = asRole(['purchasing']);
const sales = asRole(['sales']);
const admin: Partial<ContextParams> = {};

const createSubmit = async (
  params: Partial<ContextParams>,
  entity: 'purchase_invoice' | 'sales_invoice',
  head: Row,
  lines: Row[],
): Promise<InvoiceJson> => {
  const lineKey = `${entity}_line`;
  const created = await fx.act<InvoiceJson>(params, `${entity}.create`, { ...head, lines: { [lineKey]: lines } });
  const submitted = await caught(fx.act<InvoiceJson>(params, `${entity}.submit`, { id: created.id }));
  if (submitted instanceof Error) throw Object.assign(submitted, { invoiceId: created.id });
  return fx.act<InvoiceJson>(params, `${entity}.get`, { id: created.id });
};
const linkedEntries = async (sourceEntity: string, sourceId: string): Promise<EntryWithLines[]> => {
  const list = await fx.act<{ items: { id: string }[] }>(admin, 'stock_entry.list', {
    where: { sourceEntity, sourceId },
  });
  return Promise.all(list.items.map((e) => fx.act<EntryWithLines>(admin, 'stock_entry.get', { id: e.id })));
};
const balanceOf = (productId: string, warehouseId: string) =>
  fx.run(admin, async (ctx) => {
    const b = await loadBalance(ctx, { productId, warehouseId });
    return b ? [b.qty.toString(), b.avgCost.toString(), b.value.toString()] : null;
  });
const setBool = (key: string, value: boolean) => fx.run(admin, (ctx) => setSetting(ctx, key, boolSettingSchema, value));
const bill = (lines: Row[], head: Row = {}) =>
  createSubmit(
    purchasing,
    'purchase_invoice',
    { partnerId: fx.partner.supplier, date: '2026-09-01', priceIncludesTax: false, ...head },
    lines,
  );
const invoice = (lines: Row[], head: Row = {}) =>
  createSubmit(sales, 'sales_invoice', { partnerId: fx.partner.customer, date: '2026-09-05', ...head }, lines);

beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.db.close();
});

describe('inventory hooks on invoices (docs/specs/inventory.md AC-5)', () => {
  let bill1: InvoiceJson;
  let sale1: InvoiceJson;

  it('AC-5 a purchase invoice with 1 goods + 1 service line (+ 1 expense line) → 1 submitted receipt with 1 line, purchasing role', async () => {
    bill1 = await bill([
      { productId: fx.product.a, quantity: '10', unitPrice: '100' },
      { productId: fx.product.svc, quantity: '1', unitPrice: '5000' },
      { accountId: fx.acc['6400'], description: '事務用品', unitPrice: '300', taxCategory: 'standard' },
    ]);
    expect(bill1).toMatchObject({ docstatus: DOCSTATUS.submitted, status: 'open' });
    const entries = await linkedEntries('purchase_invoice', bill1.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'receipt',
      docstatus: DOCSTATUS.submitted,
      warehouseId: fx.wh.main,
      partnerId: fx.partner.supplier,
      date: '2026-09-01',
      note: `仕入請求書 ${bill1.number ?? ''}`,
      sourceEntity: 'purchase_invoice',
      sourceId: bill1.id,
    });
    expect(entries[0]?.number).toMatch(/^STK-2026-\d{6}$/);
    expect(
      entries[0]?.lines.stock_entry_line.map((l) => [l.productId, l.quantity, l.sign, l.unitCost, l.amount]),
    ).toEqual([[fx.product.a, '10', null, '100', '1000']]);
    expect(await balanceOf(fx.product.a, fx.wh.main)).toEqual(['10', '100', '1000']);
  });

  it('AC-5 tax-inclusive bill: unitCost = 税抜 unit price = unitPrice ÷ (1 + the line rate), 6 decimals', async () => {
    const b = await bill(
      [
        { productId: fx.product.b, quantity: '3', unitPrice: '1100' },
        { productId: fx.product.food, quantity: '2', unitPrice: '1000' },
      ],
      { priceIncludesTax: true },
    );
    const [entry] = await linkedEntries('purchase_invoice', b.id);
    // standard 10%: 1100 / 1.1 = 1000; reduced 8%: 1000 / 1.08 = 925.925925… → 925.925926
    expect(entry?.lines.stock_entry_line.map((l) => [l.productId, l.quantity, l.unitCost, l.amount])).toEqual([
      [fx.product.b, '3', '1000', '3000'],
      [fx.product.food, '2', '925.925926', '1851.851852'],
    ]);
    expect(await balanceOf(fx.product.food, fx.wh.main)).toEqual(['2', '925.925926', '1851.851852']);
  });

  it('AC-5 no goods line → no stock entry; inventory.auto_receipt_on_purchase = false → no stock entry', async () => {
    const onlyService = await bill([
      { productId: fx.product.svc, quantity: '1', unitPrice: '5000' },
      { accountId: fx.acc['6400'], description: '消耗品', unitPrice: '100', taxCategory: 'standard' },
    ]);
    expect(onlyService.docstatus).toBe(DOCSTATUS.submitted);
    expect(await linkedEntries('purchase_invoice', onlyService.id)).toEqual([]);
    await setBool(AUTO_RECEIPT_ON_PURCHASE_KEY, false);
    const off = await bill([{ productId: fx.product.c, quantity: '5', unitPrice: '10' }]);
    expect(await linkedEntries('purchase_invoice', off.id)).toEqual([]);
    expect(await balanceOf(fx.product.c, fx.wh.main)).toBeNull();
    await setBool(AUTO_RECEIPT_ON_PURCHASE_KEY, true);
  });

  it('AC-5 a sales invoice issues its goods lines from the default warehouse at the moving average, sales role', async () => {
    sale1 = await invoice([
      { productId: fx.product.a, quantity: '4' },
      { productId: fx.product.svc, quantity: '1' },
    ]);
    expect(sale1).toMatchObject({ docstatus: DOCSTATUS.submitted, status: 'open' });
    const entries = await linkedEntries('sales_invoice', sale1.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'issue',
      docstatus: DOCSTATUS.submitted,
      warehouseId: fx.wh.main,
      partnerId: fx.partner.customer,
      date: '2026-09-05',
      note: `売上請求書 ${sale1.number ?? ''}`,
    });
    expect(entries[0]?.lines.stock_entry_line.map((l) => [l.productId, l.quantity, l.unitCost, l.amount])).toEqual([
      [fx.product.a, '4', '100', '400'],
    ]);
    expect(await balanceOf(fx.product.a, fx.wh.main)).toEqual(['6', '100', '600']);
  });

  it('AC-5 insufficient stock fails the sales invoice submit as a whole: invoice stays a draft, no journal entry, no movement', async () => {
    const err = await caught(invoice([{ productId: fx.product.a, quantity: '7' }]));
    expect(err).toBeInstanceOf(StateError);
    expect((err as StateError).details).toMatchObject({ available: '6', requested: '7' });
    const id = (err as { invoiceId?: string }).invoiceId ?? '';
    expect(await fx.act<InvoiceJson>(sales, 'sales_invoice.get', { id })).toMatchObject({
      docstatus: DOCSTATUS.draft,
      status: 'draft',
      journalEntryId: null,
    });
    expect(await fx.run(admin, (ctx) => repo(ctx, JournalEntry).count({ sourceId: id }))).toBe(0);
    expect(await linkedEntries('sales_invoice', id)).toEqual([]);
    expect(await balanceOf(fx.product.a, fx.wh.main)).toEqual(['6', '100', '600']);
    await setBool(AUTO_ISSUE_ON_SALES_KEY, false);
    const off = await invoice([{ productId: fx.product.a, quantity: '7' }]);
    expect(off.docstatus).toBe(DOCSTATUS.submitted);
    expect(await linkedEntries('sales_invoice', off.id)).toEqual([]);
    await setBool(AUTO_ISSUE_ON_SALES_KEY, true);
  });

  it('AC-5 cancel: the sales invoice cancel cancels its issue; a bill whose goods were sold cannot be cancelled until the sale is', async () => {
    const refused = await caught(
      fx.act(purchasing, 'purchase_invoice.cancel', { id: bill1.id, correctionDate: '2026-09-10' }),
    );
    expect(refused).toBeInstanceOf(StateError);
    expect((refused as StateError).details).toMatchObject({ available: '6', requested: '10', reversal: true });
    expect(await fx.act<InvoiceJson>(purchasing, 'purchase_invoice.get', { id: bill1.id })).toMatchObject({
      docstatus: DOCSTATUS.submitted,
      status: 'open',
    });

    await fx.act(sales, 'sales_invoice.cancel', { id: sale1.id });
    const [issue] = await linkedEntries('sales_invoice', sale1.id);
    expect(issue?.docstatus).toBe(DOCSTATUS.cancelled);
    expect(await balanceOf(fx.product.a, fx.wh.main)).toEqual(['10', '100', '1000']);

    expect(
      await fx.act<InvoiceJson>(purchasing, 'purchase_invoice.cancel', { id: bill1.id, correctionDate: '2026-09-10' }),
    ).toMatchObject({ docstatus: DOCSTATUS.cancelled, status: 'cancelled' });
    const [receipt] = await linkedEntries('purchase_invoice', bill1.id);
    expect(receipt?.docstatus).toBe(DOCSTATUS.cancelled);
    expect(await balanceOf(fx.product.a, fx.wh.main)).toEqual(['0', '100', '0']);
    // the amended bill posts a new receipt
    const amended = await fx.act<InvoiceJson>(purchasing, 'purchase_invoice.amend', { id: bill1.id });
    await fx.act(purchasing, 'purchase_invoice.update', { id: amended.id, patch: { date: '2026-09-10' } });
    await fx.act(purchasing, 'purchase_invoice.submit', { id: amended.id });
    expect(
      (await linkedEntries('purchase_invoice', amended.id)).map((e) => [e.docstatus, e.lines.stock_entry_line.length]),
    ).toEqual([[DOCSTATUS.submitted, 1]]);
    expect(await balanceOf(fx.product.a, fx.wh.main)).toEqual(['10', '100', '1000']);
  });

  it('AC-5 default warehouse: inventory.default_warehouse code, else the isDefault warehouse, else INVALID_STATE (the invoice stays a draft)', async () => {
    const setCode = (code: string) =>
      fx.run(admin, (ctx) => setSetting(ctx, DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, code));
    await setCode('SUB');
    const toSub = await bill([{ productId: fx.product.c, quantity: '1', unitPrice: '10' }]);
    expect((await linkedEntries('purchase_invoice', toSub.id))[0]?.warehouseId).toBe(fx.wh.sub);
    await setCode('NOPE');
    const toMain = await bill([{ productId: fx.product.c, quantity: '1', unitPrice: '10' }]);
    expect((await linkedEntries('purchase_invoice', toMain.id))[0]?.warehouseId).toBe(fx.wh.main);
    await fx.act(admin, 'warehouse.update', { id: fx.wh.main, patch: { isDefault: false } });
    const err = await caught(bill([{ productId: fx.product.c, quantity: '1', unitPrice: '10' }]));
    expect(err).toBeInstanceOf(StateError);
    expect((err as StateError).hint).toBe(DEFAULT_WAREHOUSE_HINT);
    expect(
      (
        await fx.act<InvoiceJson>(purchasing, 'purchase_invoice.get', {
          id: (err as { invoiceId?: string }).invoiceId ?? '',
        })
      ).docstatus,
    ).toBe(DOCSTATUS.draft);
    await fx.act(admin, 'warehouse.update', { id: fx.wh.main, patch: { isDefault: true } });
    await setCode('MAIN');
  });
});
