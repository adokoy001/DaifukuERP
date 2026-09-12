import { registerCrudActions, registerPackActions } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealEstatePack } from '../src/index.ts';
import { scenario, type ListJson, type Row } from './support.ts';

let db: TestDb;
const s = scenario(() => db);
const D = '2026-11-01';
let partnerId = '';
let unitId = '';
let otherUnitId = '';
beforeAll(async () => {
  registerCrudActions();
  registerPackActions();
  db = await freshDb();
  await s.seedModules(D);
  await s.act(D, 'pack.apply', { name: RealEstatePack.name, sample: true, force: true });
  const partners = await s.act<ListJson>(D, 'partner.list', { where: { code: 'T3' } });
  partnerId = String(partners.items[0]?.id);
  const units = await s.act<ListJson>(D, 'real_estate_unit.list', {});
  unitId = String(units.items.find((r) => r.code === '201')?.id);
  otherUnitId = String(units.items.find((r) => r.code === '101')?.id);
});
afterAll(async () => { await db.close(); });

async function draft(startDate: string, endDate: string, unit = unitId): Promise<string> {
  const row = await s.act<Row>(D, 'contract.create', { partnerId, title: 'Lease', startDate, endDate, ext: { unitId: unit }, lines: { contract_line: [{ description: 'Rent', quantity: '1', unitPrice: '1000', taxCategory: 'non_taxable' }] } });
  return String(row.id);
}
const submit = (id: string) => s.act(D, 'contract.submit', { id });

describe('lease occupancy intervals', () => {
  it('allows only one of two overlapping concurrent lease submissions', async () => {
    const ids = await Promise.all([draft('2027-01-01', '2027-02-28'), draft('2027-02-01', '2027-03-31')]);
    const settled = await Promise.allSettled(ids.map(submit));
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = settled.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({ code: 'CONFLICT' });
    const rows = await s.act<ListJson>(D, 'contract.list', { where: { id: { $in: ids } } });
    expect(rows.items.filter((r) => r.docstatus === 1)).toHaveLength(1);
  });
  it('permits nonoverlapping terms and other units, but refuses shared boundary days and submitted unit changes', async () => {
    const id = await draft('2027-04-01', '2027-04-30');
    await submit(id);
    const boundary = await draft('2027-04-30', '2027-05-31');
    await expect(submit(boundary)).rejects.toMatchObject({ code: 'CONFLICT' });
    await submit(await draft('2027-05-01', '2027-05-31'));
    await submit(await draft('2027-04-01', '2027-04-30', otherUnitId));
    await expect(s.act(D, 'contract.update', { id, patch: { ext: { unitId: otherUnitId } } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(s.act(D, 'contract.update', { id, patch: { endDate: '2027-05-01' } })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
