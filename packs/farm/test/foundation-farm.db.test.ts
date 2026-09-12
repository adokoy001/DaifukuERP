import { newId, repo } from '@daifuku/kernel';
import { closeInventoryThrough, StockBalance } from '@daifuku/mod-inventory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleIds, setup, type Doc, type List, type Scenario, type Table } from './fixture.ts';
let s: Scenario;
let ids: Awaited<ReturnType<typeof sampleIds>>;
beforeAll(async () => { s = await setup(); ids = await sampleIds(s); });
afterAll(async () => { await s?.db.close(); });
async function season(name: string): Promise<Doc> {
  const fieldId = await s.id('farm_field', 'code', 'FARM-DEMO-NORTH');
  const cropId = await s.id('farm_crop', 'code', 'FARM-DEMO-TOMATO');
  return s.submit('farm_season', { name, fieldId, cropId, startDate: '2026-04-01', endDate: '2026-10-31' });
}
async function harvest(seasonId: string, extra: Record<string, unknown> = {}): Promise<Doc> {
  return s.act('farm_harvest.create', { seasonId, date: '2026-07-01', warehouseId: ids.warehouseId, quantity: '5', valuationUnitCost: '10', ...extra });
}

describe('farm integrity and effective history', () => {
  it('rejects service crops, invalid dates, nonpositive quantities, and forged owned fields', async () => {
    const serviceId = await s.id('product', 'code', 'SAMPLE-SERVICE');
    await expect(s.act('farm_crop.create', { code: 'BAD', name: 'bad', productId: serviceId })).rejects.toMatchObject({ code: 'VALIDATION' });
    const active = await season('Validation');
    await expect(harvest(active.id, { quantity: '0' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(harvest(active.id, { date: '2026-03-31' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(harvest(active.id, { valuationUnitCost: undefined })).rejects.toMatchObject({ code: 'VALIDATION' });
    const future = await harvest(active.id, { valuationUnitCost: '0' });
    await expect(s.act('farm_harvest.submit', { id: future.id }, { now: () => new Date('2026-06-30T03:00:00Z') })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await s.act('farm_harvest.get', { id: future.id })).toMatchObject({ docstatus: 0, stockEntryId: null });
    await expect(harvest(active.id, { productId: ids.materialId })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(harvest(active.id, { stockEntryId: newId() })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(s.act('farm_season.update', { id: active.id, patch: { closedDate: '2026-10-31' } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(s.act('farm_harvest.create', { seasonId: active.id, date: '2026-07-01', warehouseId: ids.warehouseId, quantity: '1', valuationUnitCost: '0' }, { roles: ['viewer'] })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('rolls back parent submit on material shortage and freezes all submitted material edits', async () => {
    const active = await season('Materials');
    const work = await s.act('farm_work.create', { seasonId: active.id, date: '2026-05-02', activity: 'fertilizing', laborHours: '1', warehouseId: ids.warehouseId, lines: { farm_material_line: [{ productId: ids.materialId, quantity: '10' }] } });
    await expect(s.act('farm_work.submit', { id: work.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await s.act('farm_work.get', { id: work.id })).toMatchObject({ docstatus: 0, stockEntryId: null });
    expect((await s.act<List>('stock_entry.list', {})).total).toBe(0);
    await s.submit('stock_entry', { type: 'receipt', date: '2026-05-01', warehouseId: ids.warehouseId, lines: { stock_entry_line: [{ productId: ids.materialId, quantity: '20', unitCost: '100' }] } });
    const posted = await s.act('farm_work.submit', { id: work.id });
    const line = (await s.act<List>('farm_material_line.list', { where: { workId: work.id } })).items[0];
    if (!line) throw new Error('Material fixture missing');
    expect(line.uomCode).toBe('KGM');
    await expect(s.act('farm_material_line.update', { id: line.id, patch: { quantity: '9' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(s.act('farm_material_line.delete', { id: line.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(s.act('stock_entry.cancel', { id: posted.stockEntryId })).rejects.toMatchObject({ code: 'HAS_DEPENDENTS' });
    await s.act('farm_work.cancel', { id: work.id, correctionDate: '2026-05-03' });
    const balance = await s.run((ctx) => repo(ctx, StockBalance).list({ where: { productId: ids.materialId, warehouseId: ids.warehouseId } }));
    expect(balance.items[0]?.qty.toString()).toBe('20');
    const amended = await s.act('farm_work.amend', { id: work.id });
    expect(amended).toMatchObject({ docstatus: 0, stockEntryId: null, cancelledDate: null });
  });
  it('serializes duplicate harvest submission, blocks child cancellation, and drops owned links on amend', async () => {
    const active = await season('Duplicate harvest');
    const draft = await harvest(active.id, { quantity: '1.234567', valuationUnitCost: '2.345678' });
    const results = await Promise.allSettled([s.act('farm_harvest.submit', { id: draft.id }), s.act('farm_harvest.submit', { id: draft.id })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const posted = await s.act('farm_harvest.get', { id: draft.id });
    const entry = await s.act('stock_entry.get', { id: posted.stockEntryId });
    expect(entry).toMatchObject({ type: 'receipt', docstatus: 1 });
    const lines = (await s.act<List>('stock_entry_line.list', { where: { entryId: entry.id } })).items;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.amount).toBe(posted.valuationAmount);
    await expect(s.act('farm_harvest.update', { id: draft.id, patch: { quantity: '1' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(s.act('farm_harvest.update', { id: draft.id, patch: { stockEntryId: null } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(s.act('stock_entry.cancel', { id: entry.id })).rejects.toMatchObject({ code: 'HAS_DEPENDENTS' });
    await s.act('farm_harvest.cancel', { id: draft.id });
    const amended = await s.act('farm_harvest.amend', { id: draft.id });
    expect(amended).toMatchObject({ docstatus: 0, stockEntryId: null, cancelledDate: null, sampleKey: null });
  });
  it('refuses closing drafts and serializes creation against closing without orphan records', async () => {
    await s.act('farm_season.submit', { id: ids.seasonId });
    await expect(s.act('farm.close_season', { seasonId: ids.seasonId, closedDate: '2026-10-31' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const late = await season('Close date boundary');
    await s.submit('farm_work', { seasonId: late.id, date: '2026-09-30', activity: 'other', laborHours: '1' });
    await expect(s.act('farm.close_season', { seasonId: late.id, closedDate: '2026-09-29' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const active = await season('Concurrent close');
    const results = await Promise.allSettled([
      s.act('farm_work.create', { seasonId: active.id, date: '2026-08-01', activity: 'other', laborHours: '1' }),
      s.act('farm.close_season', { seasonId: active.id, closedDate: '2026-10-31' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const final = await s.act('farm_season.get', { id: active.id });
    const drafts = await s.act<List>('farm_work.list', { where: { seasonId: active.id, docstatus: 0 } });
    expect(Boolean(final.closedDate) && drafts.total > 0).toBe(false);
    await expect(s.act('farm.close_season', { seasonId: active.id, closedDate: '2027-01-01' })).rejects.toMatchObject({ code: expect.stringMatching(/VALIDATION|INVALID_STATE/) });
  });
  it('keeps company and tenant references isolated and enables only applied pack companies', async () => {
    const companyId = newId();
    await s.db.owner.sql`insert into companies (id, tenant_id, code, name) values (${companyId}, ${s.db.tenantId}, 'FARM-B', 'Farm B')`;
    await expect(s.act('farm_field.list', {}, { companyId })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await s.act('pack.apply', { name: 'farm', sample: true }, { companyId });
    const other = await s.act<List>('farm_season.list', {}, { companyId });
    expect(other.total).toBe(1);
    expect(other.items[0]?.id).not.toBe(ids.seasonId);
    await expect(s.act('farm_harvest.get', { id: ids.harvestId }, { companyId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(s.act('farm_harvest.create', { seasonId: ids.seasonId, date: '2026-07-01', warehouseId: ids.warehouseId, quantity: '1', valuationUnitCost: '10' }, { companyId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const tenantId = newId();
    await s.db.owner.sql`insert into tenants (id, name) values (${tenantId}, 'Other farm tenant')`;
    const tenantCompany = newId();
    await s.db.owner.sql`insert into companies (id, tenant_id, code, name) values (${tenantCompany}, ${tenantId}, 'OTHER', 'Other')`;
    await s.act('pack.apply', { name: 'farm' }, { tenantId, companyId: tenantCompany });
    await expect(s.act('farm_harvest.get', { id: ids.harvestId }, { tenantId, companyId: tenantCompany })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('aggregates beyond the repository 500-row page without losing labor hours', async () => {
    const active = await season('Pagination');
    // Bulk fixture only: no material movements. The production report must read both pages of this valid history.
    await s.db.owner.sql`insert into farm_work (id, tenant_id, company_id, season_id, date, activity, labor_hours, docstatus, number)
      select gen_random_uuid(), ${s.db.tenantId}, ${s.db.companyId}, ${active.id}, '2026-09-01', 'other', 1, 1, 'PAGE-' || n from generate_series(1,501) n`;
    const report = await s.act<Table>('farm.season_summary', { from: '2026-09-01', to: '2026-09-01', asOf: '2026-09-01' });
    expect(report.rows).toEqual([expect.objectContaining({ seasonId: active.id, laborHours: '501', workCount: 501 })]);
    expect(report.totals.laborHours).toBe('501');
  });
  it('propagates correction dates after inventory close and keeps earlier reports stable', async () => {
    const active = await season('Period correction');
    const draft = await harvest(active.id, { date: '2026-08-01' });
    const posted = await s.act('farm_harvest.submit', { id: draft.id });
    const input = { from: '2026-08-01', to: '2026-08-01', asOf: '2026-08-01' };
    const before = await s.act<Table>('farm.season_summary', input);
    await s.run((ctx) => closeInventoryThrough(ctx, '2026-08-01', { entity: 'test_fixture', id: newId() }));
    await expect(s.act('farm_harvest.cancel', { id: draft.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await s.act('farm_harvest.get', { id: draft.id })).toMatchObject({ docstatus: 1, cancelledDate: null });
    expect(await s.act('stock_entry.get', { id: posted.stockEntryId })).toMatchObject({ docstatus: 1 });
    await s.act('farm_harvest.cancel', { id: draft.id, correctionDate: '2026-08-02' });
    expect(await s.act('farm_harvest.get', { id: draft.id })).toMatchObject({ docstatus: 2, cancelledDate: '2026-08-02' });
    expect((await s.act<Table>('farm.season_summary', input)).rows).toEqual(before.rows);
    const after = await s.act<Table>('farm.season_summary', { ...input, asOf: '2026-08-02' });
    expect(after.rows.every((row) => row.seasonId !== active.id)).toBe(true);
    const ledger = await s.act<List>('stock_ledger.list', { where: { sourceId: posted.stockEntryId } });
    expect(ledger.items.map((row) => row.date).sort()).toEqual(['2026-08-01', '2026-08-02']);
  });
});
