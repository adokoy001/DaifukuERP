// Pure cash forecast (docs/specs/cash-forecast.md): the golden example, placement rules, schedule order and
// truncation, keyset reading, the input schema and fast-check properties of the balances (AC-12) and of the
// independence from `from` (AC-28). No DB.
import { Decimal, MAX_REPORT_ROWS } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildCashPlan,
  datesBetween,
  placeItem,
  postedFlow,
  readKeyset,
  type CashPlanInput,
  type EntryCursor,
  type PlannedItem,
  type PostedEntry,
} from '../src/cash-plan.ts';
import { contractItems, payrollItems } from '../src/cash-sources.ts';
import { forecastResult, scheduleResult, type CashForecastFacts, type CashTableQuery } from '../src/cash-tables.ts';
import {
  cashAddDays,
  cashForecastInput,
  cashForecastMeta,
  cashForecastRow,
  cashScheduleMeta,
  cashScheduleRow,
  CASH_SOURCES,
  type CashSource,
} from '../src/contract.ts';
import golden from './golden/cash-forecast-basic.json' with { type: 'json' };

type GoldenItem = (typeof golden.input.items)[number];

function plannedItem(
  raw: Partial<PlannedItem> & Pick<PlannedItem, 'source' | 'dueDate' | 'amount' | 'key'>,
): PlannedItem {
  return {
    state: 'submitted',
    documentDueDate: null,
    count: 1,
    number: null,
    period: null,
    partnerId: null,
    partnerName: null,
    salesInvoiceId: null,
    purchaseInvoiceId: null,
    contractId: null,
    ...raw,
  };
}

function fromGolden(raw: GoldenItem): PlannedItem {
  const r = raw as GoldenItem & { documentDueDate?: string; count?: number; number?: string | null; period?: string };
  return plannedItem({
    key: r.key,
    source: r.source as CashSource,
    state: r.state as 'submitted' | 'draft',
    dueDate: r.dueDate,
    documentDueDate: r.documentDueDate ?? null,
    amount: Decimal.from(r.amount),
    count: r.count ?? 1,
    number: r.number ?? null,
    period: r.period ?? null,
  });
}

const goldenPosted: PostedEntry[] = golden.input.posted.map((p) => ({
  ...p,
  debit: Decimal.from(p.debit),
  credit: Decimal.from(p.credit),
}));

function goldenInput(overrides: Partial<CashPlanInput> = {}): CashPlanInput {
  return {
    from: golden.input.from,
    to: golden.input.to,
    today: golden.input.today,
    includeDrafts: golden.input.includeDrafts,
    includeOverdue: golden.input.includeOverdue,
    ledgerBalance: Decimal.from(golden.input.ledgerBalance),
    posted: goldenPosted,
    items: golden.input.items.map(fromGolden),
    ...overrides,
  };
}

const allIncluded = CASH_SOURCES.map((source) => ({ source, included: true }));

function query(input: CashPlanInput, sources = allIncluded): CashTableQuery {
  return {
    from: input.from,
    to: input.to,
    today: input.today,
    includeDrafts: input.includeDrafts,
    includeOverdue: input.includeOverdue,
    sources,
  };
}

const facts = (ledgerBalance: Decimal): CashForecastFacts => ({
  ledgerBalance,
  cashAccounts: [{ accountId: 'a1', code: '1100', name: '普通預金', balance: ledgerBalance }],
  missingAccountCodes: [],
  unscheduledPayroll: { count: 0, netPay: Decimal.zero() },
  contractBacklog: { count: 0, subtotal: Decimal.zero() },
  unallocated: {
    receive: { count: 0, amount: Decimal.zero() },
    pay: { count: 0, amount: Decimal.zero() },
  },
  uncountedPaymentAccounts: [],
  notices: ['payroll_posted_overlap'],
});

describe('cash forecast golden example', () => {
  it('AC-1 AC-2 AC-5 AC-9 golden: day rows, totals and meta of the spec example (negative invoice, transfer netting)', () => {
    const input = goldenInput();
    const result = forecastResult(query(input), buildCashPlan(input), facts(input.ledgerBalance));
    expect(result.rows).toEqual(golden.forecast.rows);
    expect(result.totals).toEqual(golden.forecast.totals);
    expect(result.meta).toMatchObject(golden.forecast.meta);
    expect(result.title).toEqual({
      ja: '資金繰り表 2026-11-09〜2026-11-12',
      en: 'Cash forecast 2026-11-09..2026-11-12',
    });
    expect(result.columns.map((c) => c.key)).toEqual(Object.keys(golden.forecast.rows[0] ?? {}));
    // the wire schemas shared with the web parse what the action returns
    expect(cashForecastMeta.parse(result.meta)).toBeTruthy();
    for (const row of result.rows) expect(cashForecastRow.parse(row)).toBeTruthy();
  });

  it('AC-10 golden: includeOverdue places overdue receivables on today', () => {
    const input = goldenInput({ includeOverdue: true });
    const plan = buildCashPlan(input);
    expect(plan.days.map((d) => d.balance.toString())).toEqual(golden.withOverdue.balances);
    expect(plan.days[1]?.scheduled.sales_invoice.toString()).toBe('80000');
    expect(plan.overdue.count).toBe(1);
  });

  it('AC-3 AC-6 golden: schedule rows in the documented order, transfer on its transfer date, totals', () => {
    const input = goldenInput();
    const plan = buildCashPlan(input);
    const result = scheduleResult(query(input), plan);
    expect(plan.rows.map((r) => r.key)).toEqual(golden.schedule.order);
    expect(
      result.rows.map((r, i) => ({
        key: plan.rows[i]?.key,
        date: r.date,
        dueDate: r.dueDate,
        direction: r.direction,
        overdue: r.overdue,
        inBalance: r.inBalance,
        count: r.count,
        amount: r.amount,
      })),
    ).toEqual(golden.schedule.rows);
    expect(result.totals).toEqual(golden.schedule.totals);
    expect(result.meta).toMatchObject({ truncated: false, rowCount: 8 });
    expect(cashScheduleMeta.parse(result.meta)).toBeTruthy();
    for (const row of result.rows) expect(cashScheduleRow.parse(row)).toBeTruthy();
    // a reserved invoice is never also a payable on its due date
    expect(plan.days.at(-1)?.scheduled.purchase_invoice.toString()).toBe('300000');
  });

  it('AC-4: per day, submitted in-balance schedule rows equal the day columns per source', () => {
    for (const includeOverdue of [false, true]) {
      const input = goldenInput({ includeOverdue });
      const plan = buildCashPlan(input);
      for (const day of plan.days)
        for (const source of CASH_SOURCES) {
          const rows = plan.rows.filter(
            (r) => r.date === day.date && r.source === source && r.inBalance && r.state === 'submitted',
          );
          expect(Decimal.sum(rows.map((r) => r.amount)).toString()).toBe(day.scheduled[source].toString());
        }
    }
  });
});

describe('placement and balances', () => {
  const q = { from: '2026-11-01', to: '2026-11-30', today: '2026-11-10', includeOverdue: false };
  it('AC-10 D-5: after `to` excluded, from today placed, overdue counted, overdue payroll treated as paid', () => {
    expect(placeItem({ source: 'sales_invoice', dueDate: '2026-12-01' }, q)).toEqual({ kind: 'excluded' });
    expect(placeItem({ source: 'sales_invoice', dueDate: '2026-11-10' }, q)).toEqual({
      kind: 'day',
      date: '2026-11-10',
      overdue: false,
    });
    expect(placeItem({ source: 'purchase_invoice', dueDate: '2026-11-09' }, q)).toEqual({
      kind: 'unplaced',
      overdue: true,
    });
    expect(placeItem({ source: 'purchase_invoice', dueDate: '2026-11-09' }, { ...q, includeOverdue: true })).toEqual({
      kind: 'day',
      date: '2026-11-10',
      overdue: true,
    });
    expect(placeItem({ source: 'payroll', dueDate: '2026-11-09' }, { ...q, includeOverdue: true })).toEqual({
      kind: 'excluded',
    });
    // from > today: placed before `from` goes to the opening balance
    expect(placeItem({ source: 'contract', dueDate: '2026-11-15' }, { ...q, from: '2026-11-20' })).toEqual({
      kind: 'before',
      date: '2026-11-15',
      overdue: false,
    });
  });

  it('AC-10: a period entirely before today places no scheduled item and keeps the posted movements', () => {
    const input = goldenInput({ from: '2026-11-01', to: '2026-11-09', today: '2026-11-10', includeOverdue: true });
    const plan = buildCashPlan(input);
    expect(plan.rows.every((r) => !r.inBalance)).toBe(true);
    expect(plan.days.every((d) => CASH_SOURCES.every((s) => d.scheduled[s].isZero()))).toBe(true);
    expect(plan.days.at(-1)?.postedIn.toString()).toBe('50000');
    expect(plan.overdue.count).toBe(1);
    expect(plan.rows.map((r) => r.key)).toEqual(['B']);
  });

  it('AC-10 D-6: from > today projects the opening balance from today .. from − 1 and counts it in beforeFrom', () => {
    const input = goldenInput({ from: '2026-11-12', to: '2026-11-12', posted: [] });
    const plan = buildCashPlan(input);
    // payroll 11-10 (−250,000), A +200,000, C −150,000 before 11-12
    expect(plan.openingBalance.toString()).toBe('800000');
    expect(plan.openingBasis).toBe('projected');
    expect(plan.beforeFrom).toMatchObject({ count: 3 });
    expect(plan.beforeFrom.inflow.toString()).toBe('200000');
    expect(plan.beforeFrom.outflow.toString()).toBe('400000');
    expect(plan.rows.map((r) => r.key)).toEqual(['G', 'F', 'E:2026-11', 'D', 'B']);
    expect(plan.closingBalance.toString()).toBe('590000');
  });

  it('AC-9 D-3: per-entry netting; a transfer between cash accounts moves nothing; future posted entries count', () => {
    expect(postedFlow({ debit: Decimal.from('100'), credit: Decimal.from('30') })).toEqual({
      inflow: Decimal.from('70'),
      outflow: Decimal.zero(),
    });
    expect(postedFlow({ debit: Decimal.from('30'), credit: Decimal.from('100') }).outflow.toString()).toBe('70');
    expect(postedFlow({ debit: Decimal.from('30'), credit: Decimal.from('30') }).inflow.isZero()).toBe(true);
    const input = goldenInput({
      posted: [{ entryDate: '2026-11-12', entryId: 'future', debit: Decimal.zero(), credit: Decimal.from('5000') }],
      items: [],
    });
    expect(buildCashPlan(input).days.at(-1)?.postedOut.toString()).toBe('5000');
  });

  it('AC-8: payroll paid and posted on its payment date is counted twice (documented overlap)', () => {
    const input = goldenInput({
      posted: [{ entryDate: '2026-11-10', entryId: 'salary', debit: Decimal.zero(), credit: Decimal.from('250000') }],
      items: payrollItems({
        days: [{ paymentDate: '2026-11-10', count: 2, netPay: Decimal.from('250000') }],
      }),
    });
    const day = buildCashPlan(input).days[1];
    expect(day?.postedOut.toString()).toBe('250000');
    expect(day?.scheduled.payroll.toString()).toBe('250000');
    expect(day?.outflow.toString()).toBe('500000');
  });

  it('AC-14 AC-8: payroll schedule results become one item per payment date with no employee data', () => {
    const items = payrollItems({
      days: [
        { paymentDate: '2026-11-25', count: 3, netPay: Decimal.from('600000') },
        { paymentDate: '2026-12-10', count: 1, netPay: Decimal.from('210000') },
      ],
    });
    expect(items.map((i) => [i.source, i.dueDate, i.count, i.amount.toString(), i.number, i.partnerId])).toEqual([
      ['payroll', '2026-11-25', 3, '600000', null, null],
      ['payroll', '2026-12-10', 1, '210000', null, null],
    ]);
    const plan = buildCashPlan(goldenInput({ from: '2026-11-20', to: '2026-12-31', items, posted: [] }));
    expect(plan.closingBalance.toString()).toBe('190000');
  });

  it('AC-7: contract receipts become items with period and contract reference', () => {
    const items = contractItems({
      receipts: [
        {
          contractId: 'c1',
          contractNumber: 'CTR-1',
          partnerId: 'p1',
          period: '2026-11',
          billingDate: '2026-11-01',
          dueDate: '2026-12-31',
          subtotal: Decimal.from('100000'),
          tax: Decimal.from('10000'),
          total: Decimal.from('110000'),
        },
      ],
    });
    expect(items[0]).toMatchObject({ source: 'contract', number: 'CTR-1', period: '2026-11', contractId: 'c1' });
    expect(items[0]?.amount.toString()).toBe('110000');
  });

  it('AC-11: without includeDrafts no draft column, total, meta key or amount appears', () => {
    const input = goldenInput({ includeDrafts: false });
    const plan = buildCashPlan(input);
    const result = forecastResult(query(input), plan, facts(input.ledgerBalance));
    expect(result.columns.map((c) => c.key)).not.toEqual(expect.arrayContaining(['draftInflow']));
    expect(Object.keys(result.totals ?? {})).not.toEqual(expect.arrayContaining(['balanceWithDrafts']));
    expect(result.meta).not.toHaveProperty('closingBalanceWithDrafts');
    expect(result.meta?.overdue).not.toHaveProperty('draftInflow');
    expect(plan.rows.some((r) => r.state === 'draft')).toBe(false);
    expect(result.rows.at(-1)?.balance).toBe('640000');
    const schedule = scheduleResult(query(input), plan);
    expect(schedule.totals).not.toHaveProperty('draftInflow');
  });

  it('AC-14: an excluded source has no column and is reported as excluded for permission', () => {
    const input = goldenInput({ items: golden.input.items.map(fromGolden).filter((i) => i.source !== 'payroll') });
    const sources = CASH_SOURCES.map((source) => ({ source, included: source !== 'payroll' }));
    const result = forecastResult(query(input, sources), buildCashPlan(input), {
      ...facts(input.ledgerBalance),
      unscheduledPayroll: undefined,
      notices: [],
    });
    expect(result.columns.map((c) => c.key)).not.toContain('payroll');
    expect(result.rows[0]).not.toHaveProperty('payroll');
    expect(result.totals).not.toHaveProperty('payroll');
    expect(result.meta?.sources).toContainEqual({ source: 'payroll', included: false, reason: 'permission' });
    expect(result.meta).not.toHaveProperty('unscheduledPayroll');
  });

  it('AC-3 AC-4: more than 10,000 rows are truncated, totals cover every row and unplaced overdue rows come last', () => {
    const items: PlannedItem[] = [];
    for (let i = 0; i < MAX_REPORT_ROWS; i++)
      items.push(
        plannedItem({
          key: `s${String(i).padStart(5, '0')}`,
          source: 'sales_invoice',
          dueDate: '2026-11-20',
          amount: Decimal.from('1'),
        }),
      );
    items.push(plannedItem({ key: 'old', source: 'sales_invoice', dueDate: '2026-01-05', amount: Decimal.from('7') }));
    items.push(
      plannedItem({ key: 'last', source: 'purchase_invoice', dueDate: '2026-11-25', amount: Decimal.from('3') }),
    );
    const input = goldenInput({ from: '2026-11-10', to: '2026-11-30', posted: [], items });
    const plan = buildCashPlan(input);
    const result = scheduleResult(query(input), plan);
    expect(result.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(result.meta).toMatchObject({ truncated: true, rowCount: MAX_REPORT_ROWS + 2 });
    expect(result.totals).toMatchObject({ inflow: '10000', outflow: '3', overdueInflow: '7' });
    expect(plan.rows.at(-1)?.key).toBe('old');
    expect(plan.rows.at(-2)?.key).toBe('last');
  });
});

describe('keyset reading of posted entries (AC-9)', () => {
  const entries = (n: number): PostedEntry[] =>
    Array.from({ length: n }, (_, i) => ({
      entryDate: i < 5 ? '2026-11-01' : '2026-11-02',
      entryId: `e${String(i).padStart(3, '0')}`,
      debit: Decimal.from(1),
      credit: Decimal.zero(),
    }));
  async function readWith(all: PostedEntry[], pageSize: number) {
    const cursors: (EntryCursor | undefined)[] = [];
    const out = await readKeyset(async (after) => {
      cursors.push(after);
      const rest = after
        ? all.filter(
            (e) => e.entryDate > after.entryDate || (e.entryDate === after.entryDate && e.entryId > after.entryId),
          )
        : all;
      return rest.slice(0, pageSize);
    }, pageSize);
    return { out, cursors };
  }
  it('AC-9: one short page reads once', async () => {
    const { out, cursors } = await readWith(entries(3), 4);
    expect(out).toHaveLength(3);
    expect(cursors).toEqual([undefined]);
  });
  it('AC-9: a page exactly at the cap reads on until a short page, even inside one day', async () => {
    const { out, cursors } = await readWith(entries(8), 4);
    expect(out.map((e) => e.entryId)).toEqual(entries(8).map((e) => e.entryId));
    expect(cursors).toEqual([
      undefined,
      { entryDate: '2026-11-01', entryId: 'e003' },
      { entryDate: '2026-11-02', entryId: 'e007' },
    ]);
  });
  it('AC-9: more than the cap within one day is not truncated', async () => {
    const sameDay = Array.from({ length: 9 }, (_, i) => ({
      entryDate: '2026-11-01',
      entryId: `x${i}`,
      debit: Decimal.from(1),
      credit: Decimal.zero(),
    }));
    const { out } = await readWith(sameDay, 2);
    expect(out).toHaveLength(9);
  });
});

describe('input schema (AC-17)', () => {
  it('AC-17: real dates, from <= to, at most 366 days both ends included, strict keys', () => {
    expect(cashForecastInput.safeParse({ from: '2026-11-01', to: '2027-11-01' }).success).toBe(true);
    expect(cashForecastInput.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(true);
    const tooLong = cashForecastInput.safeParse({ from: '2026-11-01', to: '2027-11-02' });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.path).toEqual(['to']);
    const reversed = cashForecastInput.safeParse({ from: '2026-11-02', to: '2026-11-01' });
    expect(reversed.error?.issues[0]?.path).toEqual(['to']);
    expect(cashForecastInput.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(cashForecastInput.safeParse({ from: '2026-11-01', to: '2026-11-02', extra: 1 }).success).toBe(false);
    expect(cashForecastInput.safeParse({ from: '2026-11-01', to: '2026-11-02', includeDrafts: 'yes' }).success).toBe(
      false,
    );
  });
  it('AC-17: calendar helpers', () => {
    expect(cashAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(cashAddDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(datesBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });
});

// Arbitrary scenario around a fixed today: posted entries over a wide range and scheduled items of every source.
const TODAY = '2026-11-10';
const dayOffset = (min: number, max: number) => fc.integer({ min, max }).map((n) => cashAddDays(TODAY, n));
const money = fc.integer({ min: -500_000, max: 500_000 }).map((n) => Decimal.from(n));
const postedArb = fc.array(
  fc.record({
    entryDate: dayOffset(-60, 60),
    entryId: fc.uuid(),
    debit: fc.integer({ min: 0, max: 300_000 }).map((n) => Decimal.from(n)),
    credit: fc.integer({ min: 0, max: 300_000 }).map((n) => Decimal.from(n)),
  }),
  { maxLength: 30 },
);
const itemArb = fc
  .record({
    source: fc.constantFrom(...CASH_SOURCES),
    state: fc.constantFrom<'submitted' | 'draft'>('submitted', 'submitted', 'draft'),
    dueDate: dayOffset(-60, 80),
    amount: money,
    key: fc.uuid(),
  })
  .map((r) =>
    plannedItem({
      ...r,
      state: r.source === 'sales_invoice' || r.source === 'purchase_invoice' ? r.state : 'submitted',
    }),
  );
const scenario = fc.record({
  posted: postedArb,
  items: fc.array(itemArb, { maxLength: 40 }),
  base: money,
  includeDrafts: fc.boolean(),
  includeOverdue: fc.boolean(),
});

/** The plan input for a `from`: ledger balance = base + every posted entry before `from` (D-6). */
function planFor(
  s: { posted: PostedEntry[]; items: PlannedItem[]; base: Decimal; includeDrafts: boolean; includeOverdue: boolean },
  from: string,
  to: string,
): CashPlanInput {
  const before = s.posted.filter((p) => p.entryDate < from);
  return {
    from,
    to,
    today: TODAY,
    includeDrafts: s.includeDrafts,
    includeOverdue: s.includeOverdue,
    ledgerBalance: s.base.plus(Decimal.sum(before.map((p) => p.debit.minus(p.credit)))),
    posted: s.posted.filter((p) => p.entryDate >= from && p.entryDate <= to),
    items: s.items,
  };
}

describe('properties', () => {
  it('AC-12 property: closing = opening + Σinflow − Σoutflow and balance(d) = balance(d − 1) + net(d), drafts too', () => {
    fc.assert(
      fc.property(scenario, dayOffset(-40, 40), fc.integer({ min: 0, max: 40 }), (s, from, length) => {
        const plan = buildCashPlan(planFor(s, from, cashAddDays(from, length)));
        const inflow = Decimal.sum(plan.days.map((d) => d.inflow));
        const outflow = Decimal.sum(plan.days.map((d) => d.outflow));
        expect(plan.closingBalance.eq(plan.openingBalance.plus(inflow).minus(outflow))).toBe(true);
        let prev = plan.openingBalance;
        let prevDrafts = plan.openingBalanceWithDrafts;
        for (const day of plan.days) {
          expect(day.balance.eq(prev.plus(day.net))).toBe(true);
          expect(day.balanceWithDrafts.eq(prevDrafts.plus(day.net).plus(day.draftInflow).minus(day.draftOutflow))).toBe(
            true,
          );
          prev = day.balance;
          prevDrafts = day.balanceWithDrafts;
        }
        expect(plan.closingBalanceWithDrafts.eq(prevDrafts)).toBe(true);
        expect(plan.days.every((d) => d.balance.gte(plan.minBalance.balance))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('AC-28 property: overdue and balance(d) for d >= max(from1, from2, today) do not depend on `from`', () => {
    fc.assert(
      fc.property(
        scenario,
        dayOffset(-40, 30),
        dayOffset(-40, 30),
        fc.integer({ min: 31, max: 60 }),
        (s, from1, from2, end) => {
          const to = cashAddDays(TODAY, end);
          const a = buildCashPlan(planFor(s, from1, to));
          const b = buildCashPlan(planFor(s, from2, to));
          const flat = (p: typeof a) => ({
            count: p.overdue.count,
            inflow: p.overdue.inflow.toString(),
            outflow: p.overdue.outflow.toString(),
            draftCount: p.overdue.draftCount,
            draftInflow: p.overdue.draftInflow.toString(),
            draftOutflow: p.overdue.draftOutflow.toString(),
          });
          expect(flat(a)).toEqual(flat(b));
          const start = [from1, from2, TODAY].sort().at(-1) ?? TODAY;
          const tail = (p: typeof a) =>
            p.days.filter((d) => d.date >= start).map((d) => [d.balance.toString(), d.balanceWithDrafts.toString()]);
          expect(tail(a)).toEqual(tail(b));
        },
      ),
      { numRuns: 200 },
    );
  });
});
