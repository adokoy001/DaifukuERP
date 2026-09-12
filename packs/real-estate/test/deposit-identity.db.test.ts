import { registerCrudActions, registerPackActions, repo } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { JournalLine } from '@daifuku/mod-accounting';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealEstateDeposit, RealEstatePack } from '../src/index.ts';
import { caught, scenario, type ListJson, type Row } from './support.ts';

let db: TestDb;
const s = scenario(() => db);
const D = '2026-11-01';
let contractId = '';
let partnerId = '';
let otherPartnerId = '';
let unitId = '';
let otherUnitId = '';

beforeAll(async () => {
  registerCrudActions();
  registerPackActions();
  db = await freshDb();
  await s.act(D, 'accounting.open_fiscal_year', { startDate: '2026-01-01' });
  await s.seedModules(D);
  await s.act(D, 'pack.apply', { name: RealEstatePack.name, sample: true });
  const partners = await s.act<ListJson>(D, 'partner.list', {});
  partnerId = String(partners.items.find((row) => row.code === 'T3')?.id);
  otherPartnerId = String(partners.items.find((row) => row.code === 'T1')?.id);
  const leases = await s.act<ListJson>(D, 'contract.list', {});
  contractId = String(leases.items.find((row) => row.partnerId === partnerId)?.id);
  const units = await s.act<ListJson>(D, 'real_estate_unit.list', {});
  unitId = String(units.items.find((row) => row.code === '201')?.id);
  otherUnitId = String(units.items.find((row) => row.code === '101')?.id);
  await s.act(D, 'contract.submit', { id: contractId });
});
afterAll(async () => { await db?.close(); });

async function createDeposit(): Promise<string> {
  const row = await s.act<Row>(D, 'real_estate_deposit.create', { contractId, partnerId, unitId, amount: '100' });
  return String(row.id);
}
async function receive(id: string): Promise<Row> {
  return s.act(D, 'real_estate.receive_deposit', { depositId: id, date: D });
}

describe('deposit identity and ledger ownership (A3)', () => {
  it('rejects mismatched partner/unit/null on create and derives omitted references', async () => {
    for (const wrong of [{ partnerId: otherPartnerId }, { unitId: otherUnitId }, { unitId: null }]) {
      const error = await caught(s.act(D, 'real_estate_deposit.create', { contractId, partnerId, unitId, amount: '100', ...wrong }));
      expect(error).toMatchObject({ code: 'VALIDATION', details: { issues: expect.arrayContaining([expect.objectContaining({ path: Object.keys(wrong)[0] })]) } });
    }
    const row = await s.act<Row>(D, 'real_estate_deposit.create', { contractId, amount: '100' });
    expect(row).toMatchObject({ partnerId, unitId });
  });
  it('rejects retargeting and amount changes after receipt; return keeps the original counterparty', async () => {
    const id = await createDeposit();
    const received = await receive(id);
    for (const patch of [{ partnerId: otherPartnerId }, { unitId: otherUnitId }, { unitId: null }, { amount: '1' }]) {
      expect(await caught(s.act(D, 'real_estate_deposit.update', { id, patch }, { roles: ['sales'] }))).toMatchObject({ code: 'INVALID_STATE' });
    }
    expect(await s.act(D, 'real_estate_deposit.get', { id })).toMatchObject({ partnerId, unitId, amount: '100', journalEntryId: received.journalEntryId });
    const returned = await s.act<Row>('2026-11-02', 'real_estate.return_deposit', { depositId: id, date: '2026-11-02', amount: '100' });
    const lines = await s.run(D, (ctx) => repo(ctx, JournalLine).list({ where: { entryId: { $in: [String(received.journalEntryId), String(returned.returnJournalEntryId)] } }, limit: 20 }));
    expect(lines.items).toHaveLength(4);
    expect([...new Set(lines.items.map((line) => line.partnerId))]).toEqual([partnerId]);
  });
  it('rejects public ledger field writes while private receipt/return remain usable', async () => {
    const id = await createDeposit();
    for (const patch of [{ receivedDate: D }, { returnedAmount: '0' }, { returnJournalEntryId: null }]) {
      expect(await caught(s.act(D, 'real_estate_deposit.update', { id, patch }))).toMatchObject({ code: 'PERMISSION_DENIED' });
    }
    expect(await caught(s.act(D, 'real_estate_deposit.create', { contractId, partnerId, unitId, amount: '100', receivedDate: D }))).toMatchObject({ code: 'PERMISSION_DENIED' });
    await receive(id);
    expect(await s.run(D, (ctx) => repo(ctx, RealEstateDeposit).get(id))).toMatchObject({ receivedDate: D });
  });
  it('serializes concurrent receipt/return and never posts a second return', async () => {
    const id = await createDeposit();
    const receipts = await Promise.allSettled([receive(id), receive(id)]);
    expect(receipts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(receipts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const returns = await Promise.allSettled([s.act('2026-11-03', 'real_estate.return_deposit', { depositId: id, date: '2026-11-03', amount: '100' }), s.act('2026-11-03', 'real_estate.return_deposit', { depositId: id, date: '2026-11-03', amount: '100' })]);
    expect(returns.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = returns.find((r) => r.status === 'rejected');
    expect(failed?.status === 'rejected' ? failed.reason : null).toMatchObject({ code: 'INVALID_STATE' });
    const entries = await s.act<ListJson>(D, 'journal_entry.list', { where: { sourceEntity: 'real_estate_deposit_return', sourceId: id } });
    expect(entries.total).toBe(1);
  });
});
