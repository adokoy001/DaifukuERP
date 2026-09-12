import { repo } from '@daifuku/kernel';
import { JournalEntry } from '@daifuku/mod-accounting';
import { InventoryPeriodClose, StockLedger } from '@daifuku/mod-inventory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetailMonthClose } from '../src/index.ts';
import { createSubmit, seedModules, setupScenario, type Scenario, type Row, type ListJson } from './fixture.ts';

let s: Scenario;
let productId = '';
let warehouseId = '';
beforeAll(async () => {
  s = await setupScenario();
  await seedModules(s);
  await s.act('pack.apply', { name: 'retail', sample: true, force: true });
  productId = String((await s.act<ListJson>('product.list', { where: { code: 'P1' } })).items[0]?.id);
  warehouseId = String((await s.act<ListJson>('warehouse.list', { where: { code: 'MAIN' } })).items[0]?.id);
  await createSubmit(s, 'stock_entry', { type: 'receipt', date: '2026-11-01', warehouseId, lines: { stock_entry_line: [{ productId, quantity: '10', unitCost: '100' }] } });
});
afterAll(async () => { await s.close(); });

describe('retail month close serialization and inventory cutoff', () => {
  it('concurrent calls for one month store one close, posting and cutoff', async () => {
    const results = await Promise.all([s.act<Row>('retail.close_month', { period: '2026-11' }), s.act<Row>('retail.close_month', { period: '2026-11' })]);
    expect(results.map((r) => r.alreadyClosed).sort()).toEqual([false, true]);
    expect(results[0]?.journalEntryId).toBe(results[1]?.journalEntryId);
    expect(await s.run((ctx) => repo(ctx, RetailMonthClose).count())).toBe(1);
    expect(await s.run((ctx) => repo(ctx, InventoryPeriodClose).count())).toBe(1);
    expect(await s.run((ctx) => repo(ctx, JournalEntry).count({ sourceEntity: 'retail_month_close' }))).toBe(1);
  });
  it('rejects inventory changes through the closed date, and carries the stored closing into the next month', async () => {
    const before = await s.run((ctx) => repo(ctx, StockLedger).count());
    await expect(createSubmit(s, 'stock_entry', { type: 'receipt', date: '2026-11-30', warehouseId, lines: { stock_entry_line: [{ productId, quantity: '1', unitCost: '999' }] } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await s.run((ctx) => repo(ctx, StockLedger).count())).toBe(before);
    await createSubmit(s, 'stock_entry', { type: 'receipt', date: '2026-12-01', warehouseId, lines: { stock_entry_line: [{ productId, quantity: '1', unitCost: '200' }] } });
    const next = await s.act<Row>('retail.close_month', { period: '2026-12' });
    expect(next).toMatchObject({ openingAmount: '1000', valuationTotal: '1200' });
    await expect(s.act('retail.close_month', { period: '2026-10' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
