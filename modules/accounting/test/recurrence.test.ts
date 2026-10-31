// Unit tests for docs/specs/recurring-journals.md AC-5, AC-6, AC-7, AC-8 (derivation), AC-11, AC-13, AC-15, AC-21:
// occurrence dates (month end, leap years), next run date by month, allocation shares, template rules and the plan.
import { Decimal } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { assertCanGenerate, entryDescription } from '../src/actions/generate-recurring.ts';
import {
  allocationAmount,
  allocationShares,
  checkHeader,
  checkLines,
  checkTemplate,
  dueOccurrences,
  lastAllocationDate,
  minorUnit,
  nextOccurrence,
  occurrenceAt,
  periodState,
  planTemplate,
  type Schedule,
  type TemplateLine,
} from '../src/services/recurrence.ts';

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  kind: 'fixed',
  frequency: 'monthly',
  dayOfMonth: 31,
  startDate: '2026-01-01',
  endDate: null,
  allocationPeriods: null,
  ...over,
});
const dates = (s: Schedule, n: number) => Array.from({ length: n }, (_, i) => occurrenceAt(s, i + 1)?.date);
const d = (v: string) => Decimal.from(v);
const ln = (debit: string, credit: string, extra: Partial<TemplateLine> = {}): TemplateLine => ({
  debit: d(debit),
  credit: d(credit),
  partnerId: null,
  partnerRequired: false,
  ...extra,
});

describe('occurrence dates (AC-6)', () => {
  it('AC-6 monthly on day 31 clamps to the month end, including February in leap and common years', () => {
    expect(dates(sched({ startDate: '2028-01-01' }), 4)).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
    ]);
    expect(dates(sched({ startDate: '2029-01-01' }), 2)).toEqual(['2029-01-31', '2029-02-28']);
  });

  it('AC-6 days 30 and 29 clamp only where the month is shorter', () => {
    expect(dates(sched({ dayOfMonth: 30, startDate: '2026-01-01' }), 3)).toEqual([
      '2026-01-30',
      '2026-02-28',
      '2026-03-30',
    ]);
    expect(dates(sched({ dayOfMonth: 29, startDate: '2028-01-15' }), 2)).toEqual(['2028-01-29', '2028-02-29']);
    expect(dates(sched({ dayOfMonth: 29, startDate: '2029-01-15' }), 2)).toEqual(['2029-01-29', '2029-02-28']);
  });

  it('AC-6 Gregorian leap years: 2000 has Feb 29, 2100 does not', () => {
    expect(dates(sched({ startDate: '2000-02-01' }), 1)).toEqual(['2000-02-29']);
    expect(dates(sched({ startDate: '2100-02-01' }), 1)).toEqual(['2100-02-28']);
    expect(dates(sched({ frequency: 'yearly', dayOfMonth: 29, startDate: '2027-02-10' }), 3)).toEqual([
      '2027-02-28',
      '2028-02-29',
      '2029-02-28',
    ]);
  });

  it('AC-6 quarterly and yearly start from the start month; a start day after dayOfMonth skips to the next slot', () => {
    expect(dates(sched({ frequency: 'quarterly', dayOfMonth: 25, startDate: '2026-02-01' }), 4)).toEqual([
      '2026-02-25',
      '2026-05-25',
      '2026-08-25',
      '2026-11-25',
    ]);
    expect(dates(sched({ frequency: 'yearly', dayOfMonth: 10, startDate: '2026-04-11' }), 2)).toEqual([
      '2027-04-10',
      '2028-04-10',
    ]);
    // start 2026-03-20 with day 15: March 15 is before the start, so the first occurrence is April 15 (no 1)
    expect(occurrenceAt(sched({ dayOfMonth: 15, startDate: '2026-03-20' }), 1)).toEqual({ date: '2026-04-15', no: 1 });
    // a start day equal to dayOfMonth counts that day
    expect(occurrenceAt(sched({ dayOfMonth: 20, startDate: '2026-03-20' }), 1)?.date).toBe('2026-03-20');
  });
});

describe('next run date (AC-5, AC-8)', () => {
  it('AC-5 without history the first occurrence on or after startDate; an endDate on the day is included', () => {
    expect(nextOccurrence(sched({ dayOfMonth: 25, startDate: '2026-10-01' }), null)).toEqual({
      date: '2026-10-25',
      no: 1,
    });
    const ending = sched({ dayOfMonth: 25, startDate: '2026-10-01', endDate: '2026-11-25' });
    expect(nextOccurrence(ending, '2026-10-25')?.date).toBe('2026-11-25');
    expect(nextOccurrence(ending, '2026-11-25')).toBeNull();
    expect(nextOccurrence(sched({ dayOfMonth: 25, startDate: '2026-10-01', endDate: '2026-10-24' }), null)).toBeNull();
  });

  it('AC-5 after the last generated occurrence: the next one; an allocation ends after its N-th', () => {
    expect(nextOccurrence(sched(), '2026-03-31')).toEqual({ date: '2026-04-30', no: 4 });
    const alloc = sched({ kind: 'allocation', allocationPeriods: 3, startDate: '2026-01-01' });
    expect(nextOccurrence(alloc, '2026-02-28')).toEqual({ date: '2026-03-31', no: 3 });
    expect(nextOccurrence(alloc, '2026-03-31')).toBeNull();
    expect(lastAllocationDate(alloc)).toBe('2026-03-31');
  });

  it('AC-8 a fixed template changed after generation never gets a second occurrence in a generated month', () => {
    // generated up to 2026-10-15, then the day changed 15 -> 31: next is November's end, not 2026-10-31
    expect(nextOccurrence(sched({ dayOfMonth: 31, startDate: '2026-01-15' }), '2026-10-15')?.date).toBe('2026-11-30');
    // the start date moved into the last generated month: next month
    expect(nextOccurrence(sched({ dayOfMonth: 31, startDate: '2026-10-20' }), '2026-10-15')?.date).toBe('2026-11-30');
    // frequency changed to quarterly (from January): the next quarter slot after October is January
    expect(nextOccurrence(sched({ frequency: 'quarterly', startDate: '2026-01-01' }), '2026-10-31')?.date).toBe(
      '2027-01-31',
    );
    // the start date moved later than the history: the first occurrence from the new start
    expect(nextOccurrence(sched({ dayOfMonth: 10, startDate: '2027-03-01' }), '2026-10-15')?.date).toBe('2027-03-10');
  });

  it('AC-9 due occurrences up to asOf in date order, at most max', () => {
    const s = sched({ startDate: '2026-01-01' });
    expect(dueOccurrences(s, null, '2026-03-31', 10).map((o) => o.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(dueOccurrences(s, null, '2026-03-30', 10)).toHaveLength(2);
    expect(dueOccurrences(s, null, '2026-12-31', 5)).toHaveLength(5);
    expect(dueOccurrences(s, '2026-02-28', '2026-03-31', 10).map((o) => o.no)).toEqual([3]);
  });
});

describe('allocation amounts (AC-13)', () => {
  it('AC-13 100,000 yen over 12: 8,333 × 11 and 8,337 on the last one', () => {
    const shares = allocationShares(d('100000'), 12, 0);
    expect(shares.slice(0, 11).every((s) => s.eq('8333'))).toBe(true);
    expect(shares[11]?.toString()).toBe('8337');
    expect(Decimal.sum(shares).eq('100000')).toBe(true);
  });

  it('AC-13 1,000 / 3 and 12 / 12 in yen; 100.00 / 3 with two decimals (rounded toward zero)', () => {
    expect(allocationShares(d('1000'), 3, 0).map(String)).toEqual(['333', '333', '334']);
    expect(allocationShares(d('12'), 12, 0).every((s) => s.eq('1'))).toBe(true);
    expect(allocationShares(d('100.00'), 3, 2).map(String)).toEqual(['33.33', '33.33', '33.34']);
    expect(minorUnit(0).toString()).toBe('1');
    expect(minorUnit(2).toString()).toBe('0.01');
  });

  it('AC-13 the amount depends only on the occurrence number', () => {
    for (const k of [1, 6, 12])
      expect(allocationAmount(d('100000'), 12, 0, k).eq(allocationShares(d('100000'), 12, 0)[k - 1] ?? 0)).toBe(true);
    expect(allocationAmount(d('100000'), 12, 0, 12).toString()).toBe(
      allocationAmount(d('100000'), 12, 0, 12).toString(),
    );
  });
});

describe('template rules (AC-7)', () => {
  it('AC-7 header rules: endDate before startDate; allocationPeriods present iff allocation; allocation endDate vs N-th date', () => {
    expect(checkHeader(sched({ endDate: '2025-12-31' }))).toEqual([{ path: 'endDate', message: expect.any(String) }]);
    expect(checkHeader(sched({ endDate: '2026-01-01' }))).toEqual([]);
    expect(checkHeader(sched({ allocationPeriods: 3 })).map((i) => i.path)).toEqual(['allocationPeriods']);
    expect(checkHeader(sched({ kind: 'allocation' })).map((i) => i.path)).toEqual(['allocationPeriods']);
    const alloc = sched({ kind: 'allocation', allocationPeriods: 3 });
    expect(checkHeader({ ...alloc, endDate: '2026-03-30' }).map((i) => i.path)).toEqual(['endDate']);
    expect(checkHeader({ ...alloc, endDate: '2026-03-31' })).toEqual([]);
  });

  it('AC-7 line rules: at least 2 lines, debit XOR credit, balanced, partner where required, issues on grid cells', () => {
    expect(checkLines(sched(), [ln('100', '0')], 0).map((i) => i.path)).toContain('lines');
    expect(checkLines(sched(), [ln('100', '100'), ln('0', '0')], 0).map((i) => i.path)).toEqual([
      'lines.recurring_journal_line.0.debit',
      'lines.recurring_journal_line.1.debit',
    ]);
    expect(checkLines(sched(), [ln('100', '0'), ln('0', '90')], 0).map((i) => i.path)).toEqual(['lines']);
    expect(
      checkLines(sched(), [ln('100', '0', { partnerRequired: true }), ln('0', '100')], 0).map((i) => i.path),
    ).toEqual(['lines.recurring_journal_line.0.partnerId']);
    expect(checkLines(sched(), [ln('60', '0'), ln('40', '0'), ln('0', '100')], 0)).toEqual([]);
  });

  it('AC-7 allocation: one debit + one credit line, total in the currency scale and at least N minor units (11 yen / 12 refused)', () => {
    const alloc = sched({ kind: 'allocation', allocationPeriods: 12 });
    expect(checkLines(alloc, [ln('12', '0'), ln('0', '12')], 0)).toEqual([]);
    expect(checkLines(alloc, [ln('11', '0'), ln('0', '11')], 0).map((i) => i.path)).toEqual([
      'lines.recurring_journal_line.0.debit',
    ]);
    expect(checkLines(alloc, [ln('12.5', '0'), ln('0', '12.5')], 0).map((i) => i.path)).toEqual([
      'lines.recurring_journal_line.0.debit',
    ]);
    expect(checkLines(alloc, [ln('6', '0'), ln('6', '0'), ln('0', '12')], 0).map((i) => i.path)).toEqual(['lines']);
    expect(checkTemplate({ ...alloc, allocationPeriods: null }, [ln('12', '0'), ln('0', '12')], 0)).toHaveLength(1);
  });
});

describe('plan against fiscal periods (AC-11, AC-21)', () => {
  const years = [{ id: 'y1', code: 'FY2026', isClosed: false }];
  const period = (code: string, startDate: string, endDate: string, isClosed = false) => ({
    code,
    startDate,
    endDate,
    isClosed,
    fiscalYearId: 'y1',
  });
  const periods = [
    period('2026-01', '2026-01-01', '2026-01-31', true),
    period('2026-02', '2026-02-01', '2026-02-28'),
    period('2026-03', '2026-03-01', '2026-03-31'),
  ];

  it('AC-11 period state follows assertOpenPeriod: closed period, closed year, no period', () => {
    expect(periodState(periods, years, '2026-02-10')).toMatchObject({ state: 'open', periodCode: '2026-02' });
    expect(periodState(periods, years, '2026-01-10')).toMatchObject({ state: 'closed_period', periodCode: '2026-01' });
    expect(periodState(periods, [{ ...years[0], isClosed: true } as never], '2026-02-10').state).toBe('closed_year');
    expect(periodState(periods, years, '2026-04-10').state).toBe('no_period');
  });

  it('AC-21 due until the first stop, then blocked and after_blocked; an invalid template is invalid_template first', () => {
    const lines = [ln('1000', '0'), ln('0', '1000')];
    const base = { lastOccurrenceDate: null, lines, scale: 0, max: 100, periods, years };
    const fromFeb = planTemplate({ ...base, schedule: sched({ startDate: '2026-02-01' }), asOf: '2026-05-31' });
    expect(fromFeb.map((p) => [p.date, p.status, p.reason])).toEqual([
      ['2026-02-28', 'due', null],
      ['2026-03-31', 'due', null],
      ['2026-04-30', 'blocked', 'no_period'],
      ['2026-05-31', 'after_blocked', null],
    ]);
    expect(fromFeb[0]?.amount.toString()).toBe('1000');
    const closed = planTemplate({ ...base, schedule: sched(), asOf: '2026-02-28' });
    expect(closed.map((p) => p.status)).toEqual(['blocked', 'after_blocked']);
    const invalid = planTemplate({
      ...base,
      lines: [ln('1', '0')],
      schedule: sched({ startDate: '2026-02-01' }),
      asOf: '2026-03-31',
    });
    expect(invalid.map((p) => [p.status, p.reason])).toEqual([
      ['invalid_template', 'invalid_template'],
      ['after_blocked', null],
    ]);
    const alloc = planTemplate({
      ...base,
      lines: [ln('100', '0'), ln('0', '100')],
      schedule: sched({ kind: 'allocation', allocationPeriods: 3, startDate: '2026-02-01' }),
      asOf: '2026-12-31',
    });
    expect(alloc.map((p) => [p.no, p.amount.toString()])).toEqual([
      [1, '33'],
      [2, '33'],
      [3, '34'],
    ]);
  });
});

describe('generation helpers (AC-9, AC-15)', () => {
  it('AC-9 entry description: the description, else the name; allocations append (k/N)', () => {
    expect(entryDescription({ name: '家賃', description: null, kind: 'fixed', allocationPeriods: null }, 3)).toBe(
      '家賃',
    );
    expect(
      entryDescription({ name: '家賃', description: '事務所家賃', kind: 'fixed', allocationPeriods: null }, 3),
    ).toBe('事務所家賃');
    expect(entryDescription({ name: '保険', description: '  ', kind: 'allocation', allocationPeriods: 12 }, 3)).toBe(
      '保険 (3/12)',
    );
  });

  it('AC-15 defense in depth: a context that cannot create journal entries (or submit them with auto-submit) is refused', () => {
    expect(() => assertCanGenerate({ roles: ['accounting'] }, true)).not.toThrow();
    expect(() => assertCanGenerate({ roles: ['admin'] }, true)).not.toThrow();
    expect(() => assertCanGenerate({ roles: ['viewer'] }, false)).toThrow(/journal_entry/);
    // sales may create journal entries (posting from sources) but the action itself needs recurring_journal update
    expect(() => assertCanGenerate({ roles: ['sales'] }, true)).not.toThrow();
    expect(() => assertCanGenerate({ roles: ['accounting'], accessScope: 'stores' }, false)).toThrow(/journal_entry/);
  });
});
