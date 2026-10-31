// The run refusals as pure functions (docs/specs/fixed-assets.md AC-11, AC-14, AC-15; D5, D13): the preview's blockers
// and the run's errors come from the same checks.
import { StateError, ValidationError } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import {
  assertPeriodRunnable,
  assertPlanRunnable,
  blockersOf,
  MAX_RUN_ASSETS,
  monthIndex,
  monthStart,
  type FiscalYearLike,
} from '../src/index.ts';
import { fiscalYears } from './fixture-rules.ts';

const year = fiscalYears(2026, 4, 1)[0] as FiscalYearLike;

/** The calendar months of `y` as periods (optionally only the first `count`). */
function periodsOf(y: FiscalYearLike, count = 12) {
  return Array.from({ length: count }, (_, i) => {
    const start = monthStart(monthIndex(y.startDate) + i);
    const next = monthStart(monthIndex(y.startDate) + i + 1);
    const end = new Date(Date.parse(`${next}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return {
      id: `P${i + 1}`,
      code: start.slice(0, 7),
      startDate: start,
      endDate: end,
      isClosed: false,
      fiscalYearId: y.id,
    };
  });
}

/** The error `fn` throws, or null. */
function thrown(fn: () => void): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

const periods = periodsOf(year);
const april = periods[0] as (typeof periods)[number];
const plan = (lines: number, laterYearCodes: string[] = []) => ({
  period: april,
  year,
  lines: Array.from({ length: lines }, () => ({}) as never),
  laterYearCodes,
});

describe('run refusals (AC-14, AC-15)', () => {
  it('AC-11 AC-15: 500 lines can run; 501 report over_limit and the run refuses with ValidationError', () => {
    expect(blockersOf(plan(MAX_RUN_ASSETS), periods, '2026-05-10', true)).toEqual([]);
    expect(blockersOf(plan(MAX_RUN_ASSETS + 1), periods, '2026-05-10', true)).toEqual(['over_limit']);
    expect(() => assertPlanRunnable(plan(MAX_RUN_ASSETS))).not.toThrow();
    const e = thrown(() => assertPlanRunnable(plan(MAX_RUN_ASSETS + 1)));
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).message).toContain('one run books at most 500');
  });

  it('AC-14 D13: a fiscal year without twelve calendar-month periods reports not_twelve_months and the run refuses', () => {
    const eleven = periodsOf(year, 11);
    expect(blockersOf(plan(1), eleven, '2026-05-10', true)).toEqual(['not_twelve_months']);
    const e = thrown(() => assertPeriodRunnable(april, year, eleven, '2026-05-10'));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('not_twelve_months');
    const midMonth = { ...year, startDate: '2026-04-15' };
    expect(blockersOf({ ...plan(1), year: midMonth }, periods, '2026-05-10', true)).toContain('not_twelve_months');
    expect(() => assertPeriodRunnable(april, year, periods, '2026-05-10')).not.toThrow();
  });

  it('AC-14: a period that starts after today reports future_period and the run refuses with that reason', () => {
    expect(blockersOf(plan(1), periods, '2026-03-31', true)).toEqual(['future_period']);
    const e = thrown(() => assertPeriodRunnable(april, year, periods, '2026-03-31'));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('future_period');
  });

  it('AC-15 AC-35: later-year bookings and unusable rules are blockers; closed period and year are listed first', () => {
    const closed = { ...plan(1, ['A1']), period: { ...april, isClosed: true }, year: { ...year, isClosed: true } };
    expect(blockersOf(closed, periods, '2026-05-10', false)).toEqual([
      'period_closed',
      'year_closed',
      'rules_unverified',
      'later_year_booked',
    ]);
    const e = thrown(() => assertPlanRunnable(plan(1, ['A1'])));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('later_year_booked');
  });
});
