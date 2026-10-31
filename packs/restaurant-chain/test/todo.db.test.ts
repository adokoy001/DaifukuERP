// docs/specs/inbox.md AC-1..AC-3: restaurant_chain.todo counts missing (last 7 planned days through yesterday),
// returned, review-pending and finalize-pending daily reports inside the caller's store boundary, only while the pack
// is applied to the company. Fixture "now" is 2026-09-30 12:00 JST.
import { appMeta, companies, newId, PermissionDenied, todoResult, type ContextParams } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restaurantTodo } from '../src/actions/todo.ts';
import { setup, type Fixture, type Row } from './fixture.ts';

let s: Fixture;
const planningNow = { now: () => new Date('2026-09-20T15:00:00Z') }; // 2026-09-21 JST
const todo = async (params: Partial<ContextParams> = {}) =>
  todoResult.parse(await s.act('restaurant_chain.todo', {}, params));
const counts = async (params: Partial<ContextParams> = {}) =>
  Object.fromEntries((await todo(params)).items.map((item) => [item.key, item.count]));
const store = (code: string) => String(s.ids[code]);
const scoped = (role: string, code: string): Partial<ContextParams> => ({
  roles: [role],
  actor: { type: 'user', id: newId() },
  accessScope: 'stores',
  storeIds: [store(code)],
});
async function report(code: string, date: string): Promise<Row> {
  const created = await s.act('restaurant_chain.record_day_status', {
    storeId: store(code),
    date,
    dayStatus: 'no_sales',
    reason: '受信箱の試験',
  });
  return s.act('restaurant_chain.submit_for_review', { closingId: created.id });
}
const review = (row: Row, decision: 'approve' | 'return') =>
  s.act('restaurant_chain.review', {
    closingId: row.id,
    decision,
    ...(decision === 'return' ? { note: '金額を確認してください' } : {}),
  });

beforeAll(async () => {
  s = await setup();
});
afterAll(async () => {
  await s?.db.close();
});

describe('restaurant_chain.todo (docs/specs/inbox.md)', () => {
  it('AC-1 AC-2: missing, returned, review and finalize counts with links to the operations board', async () => {
    expect(await todo()).toEqual({ items: [] });
    for (const code of ['RC-A', 'RC-B'])
      await s.act(
        'restaurant_chain.plan_days',
        {
          storeId: store(code),
          from: '2026-09-21',
          to: '2026-09-30',
          openWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
          dailyGrossSalesTarget: '10000',
        },
        planningNow,
      );
    expect(await todo()).toEqual({
      items: [
        {
          key: 'missing_reports',
          label: {
            ja: '未提出の日次報告（直近7日の営業予定日）',
            en: 'Missing daily reports (planned days, last 7 days)',
          },
          count: 14,
          href: '/operations?from=2026-09-23&to=2026-09-29',
          severity: 'warn',
        },
      ],
    });
    await report('RC-A', '2026-09-29'); // awaiting store review
    await review(await report('RC-B', '2026-09-27'), 'return');
    await review(await report('RC-B', '2026-09-26'), 'approve'); // awaiting headquarters posting
    await report('RC-B', '2026-09-10'); // older than the missing window, still awaiting review
    await s.act('restaurant_chain.record_day_status', {
      storeId: store('RC-A'),
      date: '2026-09-28',
      dayStatus: 'no_sales',
      reason: '受信箱の試験（未提出の下書き）',
    }); // a draft that was never submitted is still missing
    const result = await todo();
    expect(result.items.map((item) => [item.key, item.count, item.href, item.severity])).toEqual([
      ['missing_reports', 11, '/operations?from=2026-09-23&to=2026-09-29', 'warn'],
      ['returned_reports', 1, '/operations?from=2026-09-27&to=2026-09-30', 'warn'],
      ['review_reports', 2, '/operations?from=2026-09-10&to=2026-09-30', 'info'],
      ['finalize_reports', 1, '/operations?from=2026-09-26&to=2026-09-30', 'info'],
    ]);
  });

  it('AC-1: store staff and managers count only their stores and only what their role acts on', async () => {
    expect(await counts(scoped('chain_staff', 'RC-A'))).toEqual({ missing_reports: 6 });
    expect(await counts(scoped('chain_manager', 'RC-A'))).toEqual({ missing_reports: 6, review_reports: 1 });
    expect(await counts(scoped('chain_manager', 'RC-B'))).toEqual({
      missing_reports: 5,
      returned_reports: 1,
      review_reports: 1,
    });
  });

  it('AC-2: when the window holds more store-days than the limit, only the missing count is left out', async () => {
    const result = await s.run((ctx) => restaurantTodo(ctx, { storeDays: 5 }));
    expect(result.items.map((item) => [item.key, item.count])).toEqual([
      ['returned_reports', 1],
      ['review_reports', 2],
      ['finalize_reports', 1],
    ]);
    expect((await s.run((ctx) => restaurantTodo(ctx, { storeDays: 14 }))).items[0]).toMatchObject({
      key: 'missing_reports',
      count: 11,
    });
  });

  it('AC-3: refused for roles outside store reporting and for a company without the pack', async () => {
    const reader = { roles: ['inventory'], actor: { type: 'user' as const, id: newId() } };
    await expect(todo(reader)).rejects.toBeInstanceOf(PermissionDenied);
    const otherCompanyId = newId();
    await s.db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: s.db.tenantId, code: 'NOPACK', name: 'パック未適用' });
    await expect(todo({ companyId: otherCompanyId })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const names = (params: Partial<ContextParams>) =>
      s.run(async (ctx) => appMeta(ctx).actions.map((a) => a.name), params);
    expect(await names({ companyId: otherCompanyId })).not.toContain('restaurant_chain.todo');
    expect(await names(reader)).not.toContain('restaurant_chain.todo');
    expect(await names(scoped('chain_staff', 'RC-A'))).toContain('restaurant_chain.todo');
  });
});
