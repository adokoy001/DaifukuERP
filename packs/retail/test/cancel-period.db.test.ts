import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSubmit, seedModules, setupScenario, type Scenario, type ListJson, type DocJson, type Row, type Table } from './fixture.ts';

let s: Scenario;
beforeAll(async () => {
  s = await setupScenario();
  await seedModules(s);
  await s.act('pack.apply', { name: 'retail', sample: true, force: true });
});
afterAll(async () => { await s.close(); });

describe('retail cancellation after accounting and inventory close', () => {
  it('propagates the chosen correction date through cash, invoice and stock reversals', async () => {
    const productId = String((await s.act<ListJson>('product.list', { where: { code: 'P1' } })).items[0]?.id);
    const warehouseId = String((await s.act<ListJson>('warehouse.list', { where: { code: 'MAIN' } })).items[0]?.id);
    await createSubmit(s, 'stock_entry', { type: 'receipt', date: '2026-11-01', warehouseId, lines: { stock_entry_line: [{ productId, quantity: '10', unitCost: '100' }] } });
    const closing = await createSubmit<DocJson>(s, 'retail_closing', { date: '2026-11-02', warehouseId, cashAmount: '540', cardAmount: '0', lines: { retail_closing_line: [{ productId, quantity: '1' }] } });
    expect(await s.act('retail.close_month', { period: '2026-11' })).toMatchObject({ valuationTotal: '900' });
    const period = (await s.act<ListJson>('fiscal_period.list', { where: { code: '2026-11' } })).items[0];
    await s.act('accounting.close_period', { periodId: period?.id });
    await expect(s.act('retail_closing.cancel', { id: closing.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await s.act('retail_closing.get', { id: closing.id })).toMatchObject({ docstatus: 1 });
    expect(await s.act('payment.get', { id: closing.paymentId })).toMatchObject({ docstatus: 1 });
    expect(await s.act('retail_closing.cancel', { id: closing.id, correctionDate: '2026-12-02' })).toMatchObject({ docstatus: 2 });
    const payment = await s.act<Row>('payment.get', { id: closing.paymentId });
    const invoice = await s.act<Row>('sales_invoice.get', { id: closing.salesInvoiceId });
    expect(payment).toMatchObject({ docstatus: 2, cancelledDate: '2026-12-02' });
    expect(invoice).toMatchObject({ docstatus: 2, cancelledDate: '2026-12-02' });
    const reversals = await s.act<ListJson>('journal_entry.list', { where: { reversalOf: { $in: [payment.journalEntryId, invoice.journalEntryId] } } });
    expect(reversals.items.map((row) => row.date)).toEqual(['2026-12-02', '2026-12-02']);
    expect((await s.act<Table>('inventory.valuation', { asOf: '2026-11-30' })).totals?.value).toBe('900');
    expect((await s.act<Table>('inventory.valuation', { asOf: '2026-12-02' })).totals?.value).toBe('1000');
  });
});
