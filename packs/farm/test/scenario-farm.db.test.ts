import { Decimal, repo, setSetting } from '@daifuku/kernel';
import { DEFAULT_WAREHOUSE_KEY, StockBalance, warehouseCodeSchema } from '@daifuku/mod-inventory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleIds, setup, type List, type Scenario, type Table } from './fixture.ts';
let s: Scenario;
beforeAll(async () => {
  s = await setup();
});
afterAll(async () => {
  await s?.db.close();
});

describe('farm: northern field tomato scenario (AC-1..9)', () => {
  it('seeds only drafts, preserves edits and does not duplicate samples on forced apply', async () => {
    const ids = await sampleIds(s);
    expect((await s.act<List>('stock_entry.list', {})).total).toBe(0);
    expect((await s.act<List>('journal_entry.list', {})).total).toBe(0);
    await s.act('farm_work.update', { id: ids.workId, patch: { note: '利用者が確認した作業メモ' } });
    await s.act('pack.apply', { name: 'farm', force: true, sample: true });
    for (const entity of ['farm_field', 'farm_crop', 'farm_season', 'farm_work', 'farm_harvest', 'farm_material_line'])
      expect((await s.act<List>(`${entity}.list`, {})).total).toBe(1);
    expect(await s.act('farm_work.get', { id: ids.workId })).toMatchObject({
      note: '利用者が確認した作業メモ',
      docstatus: 0,
    });
    expect(await s.act('farm_harvest.get', { id: ids.harvestId })).toMatchObject({
      quantity: '100',
      uomCode: 'KGM',
      valuationAmount: '20000',
      docstatus: 0,
    });
  });
  it('runs purchase -> work/material issue -> harvest -> sale -> receipt and season summary', async () => {
    const ids = await sampleIds(s);
    await expect(s.act('farm_harvest.submit', { id: ids.harvestId })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await s.act('farm_season.submit', { id: ids.seasonId });
    await s.run((ctx) => setSetting(ctx, DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, 'FARM'));
    await s.submit('purchase_invoice', {
      partnerId: ids.supplierId,
      date: '2026-05-01',
      lines: { purchase_invoice_line: [{ productId: ids.materialId, quantity: '50', unitPrice: '100' }] },
    });
    const work = await s.act('farm_work.submit', { id: ids.workId }, { roles: ['inventory', 'viewer'] });
    expect(work).toMatchObject({ docstatus: 1, laborHours: '3', stockEntryId: expect.any(String) });
    const materialBalance = await s.run((ctx) =>
      repo(ctx, StockBalance).list({ where: { productId: ids.materialId, warehouseId: ids.warehouseId } }),
    );
    expect(materialBalance.items[0]?.qty.toString()).toBe('40');
    const harvest = await s.act('farm_harvest.submit', { id: ids.harvestId }, { roles: ['inventory', 'viewer'] });
    expect(harvest).toMatchObject({ docstatus: 1, valuationAmount: '20000', stockEntryId: expect.any(String) });
    expect((await s.act<List>('journal_entry.list', {})).total).toBe(1); // only the purchase; no invented farm GL
    const sale = await s.submit('sales_invoice', {
      partnerId: ids.customerId,
      date: '2026-07-02',
      lines: { sales_invoice_line: [{ productId: ids.tomatoId, quantity: '30', unitPrice: '400' }] },
    });
    expect(sale.total).toBe('12960');
    await s.submit('payment', {
      direction: 'receive',
      partnerId: ids.customerId,
      date: '2026-07-03',
      amount: sale.total,
      method: 'cash',
      lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: sale.id, amount: sale.total }] },
    });
    const paid = await s.act('sales_invoice.get', { id: sale.id });
    expect(paid.paidAmount).toBe('12960');
    expect(Decimal.from(String(paid.total)).minus(String(paid.paidAmount)).toString()).toBe('0');
    const tomatoBalance = await s.run((ctx) =>
      repo(ctx, StockBalance).list({ where: { productId: ids.tomatoId, warehouseId: ids.warehouseId } }),
    );
    expect(tomatoBalance.items[0]?.qty.toString()).toBe('70');
    const summary = await s.act<Table>('farm.season_summary', {
      from: '2026-04-01',
      to: '2026-10-31',
      asOf: '2026-10-31',
    });
    expect(summary.rows).toEqual([
      expect.objectContaining({
        field: '北畑（デモ）',
        season: '2026年トマト（デモ）',
        harvestQuantity: '100',
        unit: 'KGM',
        harvestValuation: '20000',
        laborHours: '3',
        workCount: 1,
        harvestCount: 1,
      }),
    ]);
    expect(summary.totals).toEqual({ harvestValuation: '20000', laborHours: '3' });
    await expect(
      s.act('farm_harvest.cancel', { id: ids.harvestId, correctionDate: '2026-07-04' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await s.act('farm_harvest.get', { id: ids.harvestId })).toMatchObject({ docstatus: 1, cancelledDate: null });
    await s.act('farm.close_season', { seasonId: ids.seasonId, closedDate: '2026-10-31' });
    expect(await s.act('farm.close_season', { seasonId: ids.seasonId, closedDate: '2026-10-31' })).toMatchObject({
      closedDate: '2026-10-31',
    });
    await expect(
      s.act('farm_work.create', { seasonId: ids.seasonId, date: '2026-07-04', activity: 'other', laborHours: '1' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
