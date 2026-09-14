import {
  auditTrail,
  Conflict,
  PermissionDenied,
  StateError,
  ValidationError,
  type ContextParams,
} from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, stock, type Fixture, type Page, type Row } from './fixture.ts';
let s: Fixture;
let staff: Partial<ContextParams>;
let manager: Partial<ContextParams>;
beforeAll(async () => {
  s = await setup();
  staff = {
    accessScope: 'stores',
    storeIds: [String(s.ids['RC-A'])],
    roles: ['chain_staff'],
    actor: { type: 'user', id: '11111111-1111-4111-8111-111111111111' },
  };
  manager = { ...staff, roles: ['chain_manager'], actor: { type: 'user', id: '22222222-2222-4222-8222-222222222222' } };
});
afterAll(async () => {
  await s?.db.close();
});
async function draft(date: string, params = staff): Promise<Row> {
  return s.act(
    'restaurant_chain_closing.create',
    {
      storeId: s.ids['RC-A'],
      date,
      cashAmount: '1100',
      cashSalesCounted: '1090',
      lines: { restaurant_chain_closing_line: [{ recipeId: s.ids['RC-CURRY-V1'], quantity: '1' }] },
    },
    params,
  );
}
const review = (row: Row) =>
  s.act('restaurant_chain.submit_for_review', { closingId: row.id, expectedVersion: row.version }, staff);
describe('店舗提出・店長確認・本部転記', () => {
  it('店舗スコープは参照・新規・付替えと本部操作を制限する', async () => {
    expect((await s.act<Page>('restaurant_chain_store.list', {}, staff)).items.map((row) => row.id)).toEqual([
      s.ids['RC-A'],
    ]);
    expect((await s.act<Page>('product.list', {}, staff)).total).toBeGreaterThan(0);
    await expect(s.act('restaurant_chain_closing.create', { storeId: s.ids['RC-B'] }, staff)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(s.act('account.list', {}, staff)).rejects.toBeInstanceOf(PermissionDenied);
    const row = await draft('2026-09-12');
    await expect(
      s.act(
        'restaurant_chain_closing.update',
        { id: row.id, patch: { storeId: s.ids['RC-B'] } },
        { ...staff, storeIds: [String(s.ids['RC-A']), String(s.ids['RC-B'])] },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      s.act('restaurant_chain_closing.update', { id: row.id, patch: { reviewStatus: 'approved' } }, staff),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(s.act('restaurant_chain_closing.submit', { id: row.id }, staff)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(
      s.act('restaurant_chain.settlement_evidence', { from: '2026-09-12', to: '2026-09-12' }, staff),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
  it('提出後の直接ヘッダ・子CRUD・親移動・saveLinesを凍結し、店長が理由付きで差し戻せる', async () => {
    const row = await review(await draft('2026-09-13'));
    expect(row).toMatchObject({
      docstatus: 0,
      reviewStatus: 'submitted',
      submittedBy: '11111111-1111-4111-8111-111111111111',
    });
    const child = (await s.act<Page>('restaurant_chain_closing_line.list', { where: { closingId: row.id } }, staff))
      .items[0];
    const other = await draft('2026-09-15');
    for (const [name, input] of [
      ['restaurant_chain_closing.update', { id: row.id, patch: { note: '改変' } }],
      ['restaurant_chain_closing.delete', { id: row.id }],
      ['restaurant_chain_closing_line.create', { closingId: row.id, recipeId: s.ids['RC-CURRY-V1'] }],
      ['restaurant_chain_closing_line.update', { id: child?.id, patch: { quantity: '2' } }],
      ['restaurant_chain_closing_line.delete', { id: child?.id }],
      ['restaurant_chain_closing.update', { id: row.id, patch: { lines: { restaurant_chain_closing_line: [] } } }],
    ] as const)
      await expect(s.act(name, input, staff)).rejects.toBeInstanceOf(StateError);
    await expect(
      s.act('restaurant_chain_closing_line.update', { id: child?.id, patch: { closingId: other.id } }, staff),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      s.act('restaurant_chain.review', { closingId: row.id, decision: 'approve' }, staff),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      s.act('restaurant_chain.review', { closingId: row.id, decision: 'return' }, manager),
    ).rejects.toBeInstanceOf(StateError);
    const returned = await s.act(
      'restaurant_chain.review',
      { closingId: row.id, decision: 'return', note: '実収額を確認' },
      manager,
    );
    expect(returned).toMatchObject({
      reviewStatus: 'returned',
      reviewedBy: '22222222-2222-4222-8222-222222222222',
      reviewNote: '実収額を確認',
    });
    await expect(review(row)).rejects.toBeInstanceOf(Conflict);
    const updated = await s.act(
      'restaurant_chain_closing.update',
      { id: row.id, patch: { cashSalesCounted: '1100' } },
      staff,
    );
    const resubmitted = await review(updated);
    const approved = await s.act(
      'restaurant_chain.review',
      { closingId: row.id, decision: 'approve', expectedVersion: resubmitted.version },
      manager,
    );
    expect(approved.reviewStatus).toBe('approved');
    const trail = await s.run((ctx) => auditTrail(ctx, 'restaurant_chain_closing', row.id), staff);
    expect(trail.some((entry) => (entry.after as Record<string, unknown> | null)?.reviewNote === '実収額を確認')).toBe(
      true,
    );
    const board = await s.act<{ overview: Record<string, unknown> }>(
      'restaurant_chain.operations_snapshot',
      { from: '2026-09-13', to: '2026-09-13' },
      staff,
    );
    expect(board.overview).toMatchObject({ finalizePendingDays: 1, grossSales: '0' });
    await expect(s.act('restaurant_chain_closing_line.delete', { id: child?.id }, staff)).rejects.toBeInstanceOf(
      StateError,
    );
    await expect(s.act('restaurant_chain.finalize', { closingId: row.id }, manager)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(s.act('restaurant_chain.finalize', { closingId: row.id })).rejects.toThrow();
    expect(await s.act('restaurant_chain_closing.get', { id: row.id })).toMatchObject({
      docstatus: 0,
      reviewStatus: 'approved',
      salesInvoiceId: null,
    });
    expect((await s.act<Page>('sales_invoice.list', {})).total).toBe(0);
    await stock(s, 'RC-A');
    const posted = await s.act('restaurant_chain.finalize', { closingId: row.id, expectedVersion: approved.version });
    expect(await s.act('restaurant_chain_closing.get', { id: posted.id })).toMatchObject({
      docstatus: 1,
      total: '1100',
      consumptionCost: '200',
    });
  });
  it('同日同店舗の二重提出を競合時も拒否し、将来日を提出できない', async () => {
    const a = await draft('2026-09-16');
    const b = await draft('2026-09-16');
    const results = await Promise.allSettled([review(a), review(b)]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1);
    await expect(review(await draft('2026-10-01'))).rejects.toBeInstanceOf(ValidationError);
  });
  it('休業・売上ゼロは明示理由を持ち、会計売上伝票を作らずに提出確認できる', async () => {
    let row = await s.act(
      'restaurant_chain.record_day_status',
      { storeId: s.ids['RC-A'], date: '2026-09-17', dayStatus: 'closed', reason: '設備点検' },
      staff,
    );
    row = await review(row);
    row = await s.act('restaurant_chain.review', { closingId: row.id, decision: 'approve' }, manager);
    row = await s.act('restaurant_chain.finalize', { closingId: row.id });
    expect(await s.act('restaurant_chain_closing.get', { id: row.id })).toMatchObject({
      docstatus: 1,
      total: '0',
      salesInvoiceId: null,
      paymentId: null,
      consumptionEntryId: null,
    });
    const bad = await s.act(
      'restaurant_chain.record_day_status',
      { storeId: s.ids['RC-A'], date: '2026-09-18', dayStatus: 'closed', reason: '設備点検' },
      staff,
    );
    await s.act(
      'restaurant_chain_waste_line.create',
      { closingId: bad.id, productId: s.ids['RC-RICE'], quantity: '0.1' },
      staff,
    );
    await expect(s.act('restaurant_chain.submit_for_review', { closingId: bad.id }, staff)).rejects.toBeInstanceOf(
      ValidationError,
    );
    let waste = await s.act(
      'restaurant_chain_closing.update',
      { id: bad.id, patch: { dayStatus: 'no_sales', note: '仕込後に営業中止' } },
      staff,
    );
    waste = await review(waste);
    waste = await s.act('restaurant_chain.review', { closingId: waste.id, decision: 'approve' }, manager);
    await s.act('restaurant_chain.finalize', { closingId: waste.id });
    expect(await s.act('restaurant_chain_closing.get', { id: waste.id })).toMatchObject({
      docstatus: 1,
      total: '0',
      salesInvoiceId: null,
      consumptionCost: '0',
      wasteCost: '50',
    });
    await s.act('restaurant_chain_closing.cancel', { id: waste.id });
    expect(await s.act('restaurant_chain_closing.get', { id: waste.id })).toMatchObject({ docstatus: 2 });
  });
});
