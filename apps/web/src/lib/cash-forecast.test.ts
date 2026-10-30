// /finance/cash-forecast pure logic (docs/specs/cash-forecast.md AC-20..AC-25): URL conditions, quick ranges,
// validation, hiding quiet days, chart coordinates, the minimum-balance warning and the guidance list.
import type { CashForecastMeta } from '@daifuku/mod-banking/contract';
import { describe, expect, it } from 'vitest';
import type { TableResult } from '../api/types.ts';
import {
  actionInput,
  cashNotices,
  chartLabel,
  chartModel,
  LABEL_GAP,
  columnGroup,
  conditionErrors,
  conditionsFromSearch,
  defaultConditions,
  documentLink,
  hasNothing,
  hideQuietDays,
  minBalanceWarning,
  parseCashSearch,
  quickRange,
  sameConditions,
  searchFromConditions,
  yen,
} from './cash-forecast.ts';

const TODAY = '2026-11-10';

function meta(over: Partial<CashForecastMeta> = {}): CashForecastMeta {
  return {
    from: '2026-11-10',
    to: '2027-02-07',
    today: TODAY,
    includeDrafts: false,
    includeOverdue: false,
    sources: [
      { source: 'sales_invoice', included: true },
      { source: 'contract', included: true },
      { source: 'purchase_invoice', included: true },
      { source: 'bank_transfer', included: true },
      { source: 'payroll', included: true },
    ],
    overdue: { count: 0, inflow: '0', outflow: '0' },
    beforeFrom: { count: 0, inflow: '0', outflow: '0' },
    truncated: false,
    openingBalance: '1000000',
    openingBasis: 'ledger',
    ledgerBalance: '1000000',
    closingBalance: '640000',
    minBalance: { date: '2026-11-12', balance: '640000' },
    cashAccounts: [],
    missingAccountCodes: [],
    unallocated: { receive: { count: 0, amount: '0' }, pay: { count: 0, amount: '0' } },
    uncountedPaymentAccounts: [],
    notices: [],
    ...over,
  };
}

describe('URL conditions (AC-20)', () => {
  it('AC-20: only real dates and the two flags survive the URL', () => {
    expect(parseCashSearch({ from: '2026-11-01', to: '2026-11-31', drafts: '1', overdue: '0', x: 'y' })).toEqual({
      from: '2026-11-01',
      drafts: 1,
    });
    expect(parseCashSearch({ from: 20261101, overdue: 1 })).toEqual({ overdue: 1 });
  });

  it('AC-20: valid URL values are used, otherwise today .. today + 89 with the flags kept', () => {
    expect(conditionsFromSearch({}, TODAY)).toEqual({
      from: TODAY,
      to: '2027-02-07',
      includeDrafts: false,
      includeOverdue: false,
    });
    expect(conditionsFromSearch({ from: '2026-12-01', to: '2026-12-31', overdue: 1 }, TODAY)).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
      includeDrafts: false,
      includeOverdue: true,
    });
    // reversed or too long: back to the default period
    expect(conditionsFromSearch({ from: '2026-12-31', to: '2026-12-01', drafts: 1 }, TODAY)).toEqual({
      ...defaultConditions(TODAY),
      includeDrafts: true,
    });
    expect(conditionsFromSearch({ from: '2026-01-01', to: '2027-01-02' }, TODAY).from).toBe(TODAY);
  });

  it('AC-20: the URL and the action input carry flags only when on; a round trip keeps the conditions', () => {
    const c = { from: '2026-11-10', to: '2026-12-09', includeDrafts: true, includeOverdue: false };
    expect(searchFromConditions(c)).toEqual({ from: '2026-11-10', to: '2026-12-09', drafts: 1 });
    expect(actionInput(c)).toEqual({ from: '2026-11-10', to: '2026-12-09', includeDrafts: true });
    expect(sameConditions(conditionsFromSearch(searchFromConditions(c), TODAY), c)).toBe(true);
  });

  it('AC-17 AC-20: checks before sending — real dates, order, 366 days and 730 days ahead', () => {
    expect(conditionErrors({ from: '2026-11-31', to: '2026-12-01' }, TODAY).from).toBeDefined();
    expect(conditionErrors({ from: '2026-12-02', to: '2026-12-01' }, TODAY).to?.ja).toContain('開始日以後');
    expect(conditionErrors({ from: '2026-01-01', to: '2027-01-02' }, TODAY).to?.ja).toContain('366日');
    expect(conditionErrors({ from: '2026-01-01', to: '2027-01-01' }, TODAY)).toEqual({});
    expect(conditionErrors({ from: '2028-11-01', to: '2028-11-10' }, TODAY).to?.en).toContain('730 days');
    expect(conditionErrors({ from: '2028-11-01', to: '2028-11-09' }, TODAY)).toEqual({});
  });

  it('AC-20: quick ranges in Japanese calendar dates', () => {
    expect(quickRange('next30', TODAY)).toEqual({ from: TODAY, to: '2026-12-09' });
    expect(quickRange('next90', TODAY)).toEqual({ from: TODAY, to: '2027-02-07' });
    expect(quickRange('thisMonth', TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(quickRange('nextMonth', TODAY)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(quickRange('nextMonth', '2027-12-20')).toEqual({ from: '2028-01-01', to: '2028-01-31' });
    expect(quickRange('nextMonth', '2028-01-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

const table = (rows: Record<string, unknown>[]): TableResult => ({
  title: { ja: '資金繰り表', en: 'Cash forecast' },
  columns: [],
  rows,
  totals: { inflow: '5', balance: '10' },
});

describe('daily table and chart (AC-21, AC-23)', () => {
  it('AC-23: quiet days are hidden, totals stay the action values', () => {
    const result = hideQuietDays(
      table([
        { date: '2026-11-10', postedIn: '0', postedOut: '0', receivables: '0', balance: '5' },
        { date: '2026-11-11', postedIn: '0', postedOut: '0', receivables: '5', balance: '10' },
        { date: '2026-11-12', postedIn: '0', postedOut: '0', draftInflow: '-1', balance: '10' },
      ]),
    );
    expect(result.rows.map((r) => r.date)).toEqual(['2026-11-11', '2026-11-12']);
    expect(result.totals).toEqual({ inflow: '5', balance: '10' });
    expect(hasNothing(table([{ date: TODAY, postedIn: '0', postedOut: '0' }]), 0, meta())).toBe(true);
    expect(hasNothing(table([{ date: TODAY, postedIn: '0', postedOut: '0' }]), 1, meta())).toBe(false);
    expect(
      hasNothing(
        table([{ date: TODAY, postedIn: '0', postedOut: '0' }]),
        0,
        meta({ overdue: { count: 1, inflow: '1', outflow: '0' } }),
      ),
    ).toBe(false);
  });

  it('AC-23: column groups for headings and colour', () => {
    expect(['postedIn', 'payables', 'draftOutflow', 'balanceWithDrafts', 'balance', 'date'].map(columnGroup)).toEqual([
      'posted',
      'scheduled',
      'draft',
      'draft',
      'total',
      undefined,
    ]);
  });

  it('AC-21: the zero line sits between positive and negative balances; drafts only when shown', () => {
    const rows = [
      { date: '2026-11-10', balance: '1000', balanceWithDrafts: '1200' },
      { date: '2026-11-11', balance: '-500', balanceWithDrafts: '-100' },
      { date: '2026-11-12', balance: '250', balanceWithDrafts: '400' },
    ];
    const m = chartModel(rows, true);
    expect(m.points.map((p) => p.x)).toEqual([m.left, (m.left + m.right) / 2, m.right]);
    const [first, second] = m.points;
    expect(first && first.y < m.zeroY).toBe(true);
    expect(second && second.y > m.zeroY).toBe(true);
    expect(m.zeroY).toBeGreaterThan(m.top);
    expect(m.zeroY).toBeLessThan(m.bottom);
    expect(m.max).toBe('1200');
    expect(m.min).toBe('-500');
    expect(m.drafts).toHaveLength(3);
    expect(m.draftPath.startsWith('M')).toBe(true);
    const plain = chartModel(rows, false);
    expect(plain.drafts).toEqual([]);
    expect(plain.draftPath).toBe('');
    // all positive: zero at the bottom; one day: centred
    const single = chartModel([{ date: TODAY, balance: '10' }], false);
    expect(single.zeroY).toBeCloseTo(single.bottom);
    expect(single.points[0]?.x).toBeCloseTo((single.left + single.right) / 2);
  });

  it('AC-21: y-axis labels name the value at their position and never overlap', () => {
    const labels = (balances: string[]) => {
      const m = chartModel(
        balances.map((balance, i) => ({ date: `2026-11-${String(10 + i)}`, balance })),
        false,
      );
      for (let i = 1; i < m.axis.length; i++)
        expect((m.axis[i]?.y ?? 0) - (m.axis[i - 1]?.y ?? 0)).toBeGreaterThanOrEqual(LABEL_GAP);
      return { m, values: m.axis.map((a) => a.value) };
    };
    // mixed: max at the top, 0 between, min at the bottom
    const mixed = labels(['1000', '-500', '250']);
    expect(mixed.values).toEqual(['1000', '0', '-500']);
    expect(mixed.m.axis.map((a) => a.y)).toEqual([mixed.m.top, mixed.m.zeroY, mixed.m.bottom]);
    // all positive: 0 at the bottom, no min label
    const positive = labels(['5000', '8000']);
    expect(positive.values).toEqual(['8000', '0']);
    expect(positive.m.axis[1]?.y).toBeCloseTo(positive.m.bottom);
    // all negative: 0 is the top (no negative number printed there), min at the bottom
    const negative = labels(['-50000', '-120000']);
    expect(negative.values).toEqual(['0', '-120000']);
    expect(negative.m.axis[0]?.y).toBeCloseTo(negative.m.top);
    // a slight dip below zero: the min label would touch the 0 label and is left out
    expect(labels(['5000000', '-50000']).values).toEqual(['5000000', '0']);
    // a slight rise above zero over a deep negative: the max label is left out
    expect(labels(['50000', '-5000000']).values).toEqual(['0', '-5000000']);
    // all zero: only the baseline
    expect(labels(['0', '0']).values).toEqual(['0']);
  });

  it('AC-21: the chart label names opening, closing and the lowest balance with its date', () => {
    expect(chartLabel(meta(), 0).ja).toBe(
      '残高の推移のグラフ。期首残高 ¥1,000,000、期末残高 ¥640,000、最低残高 ¥640,000（2026-11-12）。正確な値は日別の表で確認できます。',
    );
  });
});

describe('warning and guidance (AC-22, AC-24, AC-25)', () => {
  it('AC-22: warns only when the balance without drafts goes below zero', () => {
    expect(minBalanceWarning(meta(), 0)).toBeUndefined();
    expect(minBalanceWarning(meta({ minBalance: { date: '2026-12-25', balance: '-35000' } }), 0)?.ja).toBe(
      '残高がマイナスになる日があります（最初の日 2026-12-25、最低残高 -¥35,000）',
    );
    expect(yen('1234.5', 2)).toBe('¥1,234.50');
  });

  it('AC-25: guidance for excluded sources, overdue, payroll, backlog, unallocated, uncounted and missing accounts', () => {
    const notices = cashNotices(
      meta({
        sources: [
          { source: 'sales_invoice', included: true },
          { source: 'payroll', included: false, reason: 'permission' },
        ],
        overdue: { count: 2, inflow: '80000', outflow: '1000' },
        unscheduledPayroll: { count: 1, netPay: '297000' },
        notices: ['payroll_posted_overlap'],
        contractBacklog: { count: 5, subtotal: '250000' },
        unallocated: { receive: { count: 1, amount: '12000' }, pay: { count: 0, amount: '0' } },
        uncountedPaymentAccounts: [
          { accountId: 'a', code: '1110', name: '当座預金', count: 1, receive: '0', pay: '7000' },
        ],
        missingAccountCodes: ['1000'],
      }),
      0,
    );
    expect(notices.map((n) => n.id)).toEqual([
      'source-payroll',
      'overdue',
      'unscheduled-payroll',
      'payroll-overlap',
      'contract-backlog',
      'unallocated',
      'uncounted-accounts',
      'missing-accounts',
    ]);
    expect(notices[0]?.text.ja).toBe('給与は閲覧・出力の権限がないため含めていません。');
    expect(notices[1]?.text.ja).toContain('「期日超過を今日に含める」');
    expect(notices[1]?.text.ja).toContain('入金 ¥80,000');
    expect(notices[2]?.link?.to).toBe('/workforce/payroll');
    expect(notices[3]?.text.ja).toContain('二重に数えます');
    expect(notices[4]?.text.ja).toContain('税抜 ¥250,000');
    expect(notices[6]?.text.ja).toContain('1110 当座預金（1 件、入金 ¥0、支払 ¥7,000）');
    expect(notices[7]?.text.ja).toContain('1000');
    expect(cashNotices(meta(), 0)).toEqual([]);
    expect(
      cashNotices(meta({ includeOverdue: true, overdue: { count: 1, inflow: '5', outflow: '0' } }), 0)[0]?.text.ja,
    ).toContain('今日の日付に含めています');
  });

  it('AC-24: schedule rows link to their document; payroll links nowhere', () => {
    const base = { salesInvoiceId: null, purchaseInvoiceId: null, contractId: null };
    expect(documentLink({ ...base, source: 'sales_invoice', salesInvoiceId: 's' })).toEqual({
      entity: 'sales_invoice',
      id: 's',
    });
    expect(documentLink({ ...base, source: 'bank_transfer', purchaseInvoiceId: 'p' })?.entity).toBe('purchase_invoice');
    expect(documentLink({ ...base, source: 'contract', contractId: 'c' })?.entity).toBe('contract');
    expect(documentLink({ ...base, source: 'payroll' })).toBeUndefined();
  });
});
