import { getCompany } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closing, setup, stock, submit, type Fixture, type Page, type Row } from './fixture.ts';

let s: Fixture;
let a: Row;
let b: Row;
beforeAll(async () => {
  s = await setup();
});
afterAll(async () => {
  await s?.db.close();
});

describe('飲食店二店舗の手計算台本', () => {
  it('通常のsample導入は既存設定を保全し、再適用してもマスタ・確定レシピを変更しない', async () => {
    expect((await s.run(getCompany)).settings['tax.price_includes_tax']).toBe(false);
    const before = await s.act('restaurant_chain_recipe.get', { id: s.ids['RC-CURRY-V1'] });
    await s.act('pack.apply', { name: 'restaurant_chain', sample: true });
    await s.act('pack.apply', { name: 'restaurant_chain', sample: true, force: true });
    expect(await s.act('restaurant_chain_recipe.get', { id: before.id })).toEqual(before);
    expect((await s.act<Page>('restaurant_chain_store.list', {})).total).toBe(2);
    expect((await s.act<Page>('stock_entry.list', {})).total).toBe(0);
  });
  it('青葉店: 店内10食・持帰5食、現金と売掛、材料消費と廃棄が一致する', async () => {
    await stock(s, 'RC-A');
    a = await submit(s, await closing(s));
    expect(a).toMatchObject({
      docstatus: 1,
      subtotal: '15000',
      taxTotal: '1400',
      total: '16400',
      quantity: '15',
      consumptionCost: '3000',
      wasteCost: '50',
    });
    const invoice = await s.act('sales_invoice.get', { id: a.salesInvoiceId });
    expect(invoice).toMatchObject({ total: '16400', paidAmount: '10000', balance: '6400', priceIncludesTax: true });
    expect(await s.act('payment.get', { id: a.paymentId })).toMatchObject({ amount: '10000', method: 'cash' });
    const store = await s.act('restaurant_chain_store.get', { id: s.ids['RC-A'] });
    const balances = await s.act<Page>('stock_balance.list', { where: { warehouseId: store.warehouseId } });
    expect(balances.items.find((row) => row.productId === s.ids['RC-RICE'])).toMatchObject({
      qty: '6.9',
      value: '3450',
    });
    expect(balances.items.find((row) => row.productId === s.ids['RC-CHICKEN'])).toMatchObject({
      qty: '3.5',
      value: '3500',
    });
    // Menu is a service: stock entry count proves there was no extra finished-product issue.
    expect((await s.act<Page>('stock_entry.list', {})).total).toBe(3);
  });
  it('港店: 同日4食は別店舗で確定でき、全店と店舗指定の集計が一致する', async () => {
    await stock(s, 'RC-B', '6', '3');
    b = await submit(
      s,
      await closing(s, 'RC-B', {
        cashAmount: '4400',
        cardAmount: '0',
        qrAmount: '0',
        lines: { restaurant_chain_closing_line: [{ recipeId: s.ids['RC-CURRY-V1'], quantity: '4' }] },
      }),
    );
    expect(b).toMatchObject({ total: '4400', consumptionCost: '800', wasteCost: '0', wasteEntryId: null });
    const report = await s.act<{ rows: Row[]; totals: Row }>('restaurant_chain.daily_summary', {
      from: '2026-09-12',
      to: '2026-09-12',
    });
    expect(report.rows).toHaveLength(2);
    expect(report.totals).toMatchObject({
      subtotal: '19000',
      taxTotal: '1800',
      total: '20800',
      cashAmount: '14400',
      cardAmount: '5000',
      qrAmount: '1400',
      quantity: '19',
      consumptionCost: '3800',
      wasteCost: '50',
    });
    const single = await s.act<{ rows: Row[]; totals: Row }>('restaurant_chain.daily_summary', {
      from: '2026-09-12',
      to: '2026-09-12',
      storeId: s.ids['RC-B'],
    });
    expect(single.rows).toHaveLength(1);
    expect(single.totals.total).toBe('4400');
  });
  it('カード・QRの後日銀行入金は既存入出金で消込み、追加入金がある締めの取消は全体を保全する', async () => {
    const invoice = await s.act('sales_invoice.get', { id: a.salesInvoiceId });
    const receipt = await s.act('payment.create', {
      direction: 'receive',
      partnerId: invoice.partnerId,
      date: '2026-09-20',
      amount: '6400',
      method: 'bank_transfer',
      accountId: s.ids['1100'],
      lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: invoice.id, amount: '6400' }] },
    });
    await s.act('payment.submit', { id: receipt.id });
    expect(await s.act('sales_invoice.get', { id: invoice.id })).toMatchObject({ paidAmount: '16400', balance: '0' });
    await expect(s.act('restaurant_chain_closing.cancel', { id: a.id })).rejects.toThrow();
    expect(await s.act('restaurant_chain_closing.get', { id: a.id })).toMatchObject({ docstatus: 1 });
    expect(await s.act('payment.get', { id: a.paymentId })).toMatchObject({ docstatus: 1 });
    expect(await s.act('sales_invoice.get', { id: invoice.id })).toMatchObject({ paidAmount: '16400', balance: '0' });
    await s.act('payment.cancel', { id: receipt.id });
    expect(await s.act('sales_invoice.get', { id: invoice.id })).toMatchObject({
      paidAmount: '10000',
      balance: '6400',
    });
  });
  it('生成伝票の単独取消は禁止し、閉期後は訂正日へ売上・現金・材料を一括取消する', async () => {
    await expect(s.act('sales_invoice.cancel', { id: a.salesInvoiceId })).rejects.toThrow();
    await expect(s.act('stock_entry.cancel', { id: a.consumptionEntryId })).rejects.toThrow();
    const period = (await s.act<Page>('fiscal_period.list', { where: { code: '2026-09' } })).items[0];
    expect(period).toBeDefined();
    await s.act('accounting.close_period', { periodId: period?.id });
    await expect(s.act('restaurant_chain_closing.cancel', { id: a.id })).rejects.toThrow();
    a = await s.act('restaurant_chain_closing.cancel', {
      id: a.id,
      correctionDate: '2026-10-01',
      expectedVersion: a.version,
    });
    expect(a).toMatchObject({ docstatus: 2, cancelledDate: '2026-10-01' });
    for (const [entity, id] of [
      ['sales_invoice', a.salesInvoiceId],
      ['payment', a.paymentId],
      ['stock_entry', a.consumptionEntryId],
      ['stock_entry', a.wasteEntryId],
    ]) {
      expect(await s.act(`${entity}.get`, { id })).toMatchObject({ docstatus: 2 });
    }
    const september = await s.act<{ totals: Row }>('restaurant_chain.daily_summary', {
      from: '2026-09-01',
      to: '2026-09-30',
    });
    const october = await s.act<{ totals: Row }>('restaurant_chain.daily_summary', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(september.totals.total).toBe('20800');
    expect(october.totals).toMatchObject({
      total: '-16400',
      taxTotal: '-1400',
      consumptionCost: '-3000',
      wasteCost: '-50',
    });
    const invoice = await s.act('sales_invoice.get', { id: a.salesInvoiceId });
    const reversals = await s.act<Page>('journal_entry.list', { where: { reversalOf: invoice.journalEntryId } });
    expect(reversals.items).toHaveLength(1);
    expect(reversals.items[0]?.date).toBe('2026-10-01');
    const stockReversals = await s.act<Page>('stock_ledger.list', {
      where: { sourceId: a.consumptionEntryId, reversal: true },
    });
    expect(stockReversals.items).toHaveLength(2);
    expect(stockReversals.items.every((row) => row.date === '2026-10-01')).toBe(true);
    const store = await s.act('restaurant_chain_store.get', { id: s.ids['RC-A'] });
    const balances = await s.act<Page>('stock_balance.list', { where: { warehouseId: store.warehouseId } });
    expect(balances.items.find((row) => row.productId === s.ids['RC-RICE'])).toMatchObject({
      qty: '10',
      value: '5000',
    });
  });
});
