import { repo } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StockCountLine, StockLedger } from '../src/index.ts';
import { setupFixture, type Fixture, type Row } from './fixture.ts';

let fx: Fixture;
beforeAll(async () => { fx = await setupFixture(); });
afterAll(async () => { await fx.db.close(); });
const act = <T = Row>(name: string, input: unknown) => fx.act<T>({}, name, input);
async function receipt(date: string) {
  const draft = await act<{ id: string }>('stock_entry.create', { type: 'receipt', date, warehouseId: fx.wh.main, lines: { stock_entry_line: [{ productId: fx.product.a, quantity: '10', unitCost: '100' }] } });
  await act('stock_entry.submit', { id: draft.id });
  return draft;
}

describe('inventory foundation invariants', () => {
  it('cannot move a submitted stock-count line to a draft parent', async () => {
    await receipt('2026-09-01');
    const head = { date: '2026-09-02', warehouseId: fx.wh.main, lines: { stock_count_line: [{ productId: fx.product.a, countedQty: '10' }] } };
    const posted = await act<{ id: string }>('stock_count.create', head);
    await act('stock_count.submit', { id: posted.id });
    const other = await act<{ id: string }>('stock_count.create', head);
    const line = await fx.run({}, async (ctx) => (await repo(ctx, StockCountLine).list({ where: { countId: posted.id } })).items[0]);
    await expect(act('stock_count_line.update', { id: line?.id, patch: { countId: other.id, countedQty: '0' } })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await fx.run({}, (ctx) => repo(ctx, StockCountLine).count({ countId: posted.id }))).toBe(1);
    expect((await fx.run({}, (ctx) => repo(ctx, StockCountLine).get(line?.id ?? ''))).countedQty.toString()).toBe('10');
  });

  it('refuses backdated stock posting and zero-variance counts without changing the ledger', async () => {
    const later = await receipt('2026-09-05');
    const before = await fx.run({}, (ctx) => repo(ctx, StockLedger).count());
    const old = await act<{ id: string }>('stock_count.create', { date: '2026-09-04', warehouseId: fx.wh.main, lines: { stock_count_line: [{ productId: fx.product.a, countedQty: '20' }] } });
    await expect(act('stock_count.submit', { id: old.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(act('stock_entry.cancel', { id: later.id, correctionDate: '2026-09-03' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await fx.run({}, (ctx) => repo(ctx, StockLedger).count())).toBe(before);
    await act('stock_entry.cancel', { id: later.id, correctionDate: '2026-09-06' });
    expect(await fx.run({}, (ctx) => repo(ctx, StockLedger).count())).toBe(before + 1);
  });
});
