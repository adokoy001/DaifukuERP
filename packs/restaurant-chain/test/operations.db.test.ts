import {
  checkActionExport,
  Decimal,
  registry,
  Repository,
  runAction,
  StateError,
  ValidationError,
  type EntityDef,
  type TableResult,
} from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OperationsSnapshot } from '../src/index.ts';
import { closing, setup, stock, submit, type Fixture, type Page, type Row } from './fixture.ts';
let s: Fixture, current: Row;
const planningNow = { now: () => new Date('2026-09-10T15:00:00Z') };
const input = { from: '2026-09-12', to: '2026-09-12', asOf: '2026-09-12' };
const snapshot = (range = input) => s.act<OperationsSnapshot>('restaurant_chain.operations_snapshot', range);
beforeAll(async () => {
  s = await setup();
});
afterAll(async () => {
  await s?.db.close();
});
describe('チェーン運営の予定母集団・期間比較・根拠', () => {
  it('今日から営業日・目標を冪等登録し、過去・上書き・重複を拒否する', async () => {
    for (const code of ['RC-A', 'RC-B']) {
      const plan = {
        storeId: s.ids[code],
        from: '2026-09-11',
        to: '2026-09-13',
        openWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        dailyGrossSalesTarget: code === 'RC-A' ? '10000' : '20000',
      };
      expect(await s.act('restaurant_chain.plan_days', plan, planningNow)).toEqual({ created: 3, kept: 0 });
      expect(await s.act('restaurant_chain.plan_days', plan, planningNow)).toEqual({ created: 0, kept: 3 });
      await expect(
        s.act('restaurant_chain.plan_days', { ...plan, dailyGrossSalesTarget: '9999' }, planningNow),
      ).rejects.toBeInstanceOf(StateError);
    }
    const plan = (
      await s.act<Page>('restaurant_chain_day_plan.list', { where: { storeId: s.ids['RC-A'], date: '2026-09-11' } })
    ).items[0];
    await expect(s.act('restaurant_chain_day_plan.cancel', { id: plan?.id })).rejects.toBeInstanceOf(StateError);
    await expect(
      s.act(
        'restaurant_chain.plan_days',
        { storeId: s.ids['RC-A'], from: '2026-09-10', to: '2026-09-10', openWeekdays: [], dailyGrossSalesTarget: '0' },
        planningNow,
      ),
    ).rejects.toBeInstanceOf(StateError);
    expect((await snapshot()).overview).toMatchObject({
      expectedOpenDays: 2,
      missingDays: 2,
      targetSales: '30000',
      grossSales: '0',
      achievementPct: '0',
      previousGrossSales: '0',
      changePct: null,
    });
  });
  it('売上・原価の合計と等日数比較を元伝票まで照合し、実収未点検をゼロにしない', async () => {
    await stock(s, 'RC-A');
    await stock(s, 'RC-B');
    await submit(s, await closing(s, 'RC-A', { date: '2026-09-11', cashSalesCounted: '9990' }));
    current = await submit(s, await closing(s, 'RC-A', { cashSalesCounted: '10000' }));
    await submit(
      s,
      await closing(s, 'RC-B', {
        cashAmount: '4400',
        cardAmount: '0',
        qrAmount: '0',
        lines: { restaurant_chain_closing_line: [{ recipeId: s.ids['RC-CURRY-V1'], quantity: '4' }] },
      }),
    );
    const savedPlan = (
      await s.act<Page>('restaurant_chain_day_plan.list', { where: { storeId: s.ids['RC-A'], date: '2026-09-12' } })
    ).items[0];
    await expect(
      s.act('restaurant_chain_day_plan.cancel', { id: savedPlan?.id }, { now: () => new Date('2026-09-12T03:00:00Z') }),
    ).rejects.toBeInstanceOf(StateError);
    const result = await snapshot();
    expect(result.range).toMatchObject({
      previousFrom: '2026-09-11',
      previousTo: '2026-09-11',
      timeZone: 'Asia/Tokyo',
      workflowBasis: 'current',
    });
    expect(result.overview).toMatchObject({
      grossSales: '20800',
      consumptionCost: '3800',
      wasteCost: '50',
      targetSales: '30000',
      achievementPct: '69.33',
      previousGrossSales: '16400',
      changeAmount: '4400',
      changePct: '26.83',
      cashDifference: null,
      missingDays: 0,
      submittedDays: 2,
    });
    expect(result.sourceTable.rows).toHaveLength(2);
    expect(
      result.sourceTable.rows.every(
        (row) => typeof row.closingNumber === 'string' && String(row.closingNumber).startsWith('RDAY-'),
      ),
    ).toBe(true);
    const sum = Decimal.sum(result.sourceTable.rows.map((row) => Decimal.from(String(row.grossSales)))).toString();
    expect(sum).toBe(result.overview.grossSales);
    expect(result.series.rows[0]?.grossSales).toBe(sum);
    const evidence = await s.act<TableResult>('restaurant_chain.settlement_evidence', input);
    expect(evidence.totals).toMatchObject({ sales: '20800', settled: '14400', balance: '6400' });
  });
  it('店舗限定のBI・再実行CSVは他店舗行を含まず、店舗未許可指定を拒否する', async () => {
    const scope = { accessScope: 'stores' as const, storeIds: [String(s.ids['RC-A'])], roles: ['chain_staff'] };
    const result = await s.act<OperationsSnapshot>('restaurant_chain.operations_snapshot', input, scope);
    expect(result.overview.grossSales).toBe('16400');
    expect(result.stores.rows).toHaveLength(1);
    expect(result.submissions.rows.every((row) => row.storeId === s.ids['RC-A'])).toBe(true);
    const csvData = (await s.run(async (ctx) => {
      checkActionExport(ctx, registry.action('restaurant_chain.operations_sources'));
      return runAction(ctx, 'restaurant_chain.operations_sources', input);
    }, scope)) as TableResult;
    expect(csvData.rows).toHaveLength(1);
    expect(csvData.rows[0]?.storeId).toBe(s.ids['RC-A']);
    await expect(
      s.act('restaurant_chain.operations_snapshot', { ...input, storeId: s.ids['RC-B'] }, scope),
    ).rejects.toThrow();
  });
  it('取消は有効日のマイナスで過去の売上・債権を変えず、休業と未提出を別に数える', async () => {
    await s.act('restaurant_chain_closing.cancel', { id: current.id, correctionDate: '2026-09-14' });
    expect((await snapshot()).overview.grossSales).toBe('20800');
    expect((await s.act<TableResult>('restaurant_chain.settlement_evidence', input)).totals?.balance).toBe('6400');
    const cancelled = await snapshot({ from: '2026-09-14', to: '2026-09-14', asOf: '2026-09-14' });
    expect(cancelled.overview).toMatchObject({
      grossSales: '-16400',
      consumptionCost: '-3000',
      wasteCost: '-50',
      unplannedDays: 2,
    });
    expect(cancelled.sourceTable.rows[0]).toMatchObject({
      closingId: current.id,
      entryKind: 'cancellation',
      date: '2026-09-12',
      effectiveDate: '2026-09-14',
    });
    const zero = await s.act('restaurant_chain.record_day_status', {
      storeId: s.ids['RC-A'],
      date: '2026-09-13',
      dayStatus: 'no_sales',
      reason: '来客なし',
    });
    await submit(s, zero);
    const board = await snapshot({ from: '2026-09-13', to: '2026-09-13', asOf: '2026-09-13' });
    expect(board.overview).toMatchObject({ zeroSalesDays: 1, missingDays: 1, submittedDays: 1, grossSales: '0' });
  });
  it('請求取消と重なった債権集計は最新の請求ロック後の履歴だけで残高を返す', async () => {
    const posted = await submit(
      s,
      await closing(s, 'RC-B', {
        date: '2026-09-19',
        cashAmount: '0',
        cardAmount: '1100',
        qrAmount: '0',
        lines: { restaurant_chain_closing_line: [{ recipeId: s.ids['RC-CURRY-V1'], quantity: '1' }] },
      }),
    );
    let held: () => void = () => {},
      release: () => void = () => {},
      attempted: () => void = () => {};
    const atCancel = new Promise<void>((resolve) => {
      held = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atRead = new Promise<void>((resolve) => {
      attempted = resolve;
    });
    registry.registerHook('sales_invoice', 'before_cancel', async (_ctx, { row }) => {
      if (row.id === posted.salesInvoiceId) {
        held();
        await pause;
      }
    });
    const original = Repository.prototype.lock;
    const spy = vi.spyOn(Repository.prototype, 'lock').mockImplementation(async function (
      this: Repository<EntityDef>,
      id,
      op,
    ) {
      if (id === posted.salesInvoiceId && this.ctx.requestId === 'settlement-race-report') attempted();
      return original.call(this, id, op);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelling = s.act('restaurant_chain_closing.cancel', { id: posted.id, correctionDate: '2026-09-20' });
    await atCancel;
    const report = s.act<TableResult>(
      'restaurant_chain.settlement_evidence',
      { from: '2026-09-19', to: '2026-09-19', asOf: '2026-09-20' },
      { requestId: 'settlement-race-report' },
    );
    try {
      await Promise.race([
        atRead,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('report did not lock source invoice')), 3000);
        }),
      ]);
      release();
      await cancelling;
      expect((await report).totals).toMatchObject({ sales: '0', settled: '0', balance: '0' });
    } finally {
      release();
      if (timer) clearTimeout(timer);
      await Promise.allSettled([cancelling, report]);
      spy.mockRestore();
    }
  });
  it('同一予定の二重登録は並行実行でも一件だけ作成し、休業予定を未提出に数えない', async () => {
    const plan = {
      storeId: s.ids['RC-A'],
      from: '2026-09-30',
      to: '2026-09-30',
      openWeekdays: [],
      dailyGrossSalesTarget: '20000',
    };
    const results = await Promise.all([
      s.act<{ created: number; kept: number }>('restaurant_chain.plan_days', plan),
      s.act<{ created: number; kept: number }>('restaurant_chain.plan_days', plan),
    ]);
    expect(results.reduce((sum, row) => sum + row.created, 0)).toBe(1);
    expect(results.reduce((sum, row) => sum + row.kept, 0)).toBe(1);
    const result = await s.act<OperationsSnapshot>('restaurant_chain.operations_snapshot', {
      from: '2026-09-30',
      to: '2026-09-30',
      storeId: s.ids['RC-A'],
    });
    expect(result.overview).toMatchObject({ targetSales: '0', expectedOpenDays: 0, missingDays: 0 });
    expect(result.submissions.rows[0]?.status).toBe('scheduled_closed');
  });
  it('基準日を東京の営業日として解釈し、未来・逆転・過大期間を拒否する', async () => {
    const atMidnight = await s.act<OperationsSnapshot>(
      'restaurant_chain.operations_snapshot',
      { from: '2026-09-11', to: '2026-09-11' },
      planningNow,
    );
    expect(atMidnight.range.asOf).toBe('2026-09-11');
    await expect(
      s.act('restaurant_chain.operations_snapshot', { from: '2026-09-12', to: '2026-09-12' }, planningNow),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(snapshot({ from: '2026-09-13', to: '2026-09-12', asOf: '2026-09-12' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(snapshot({ from: '2025-01-01', to: '2026-09-12', asOf: '2026-09-12' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
