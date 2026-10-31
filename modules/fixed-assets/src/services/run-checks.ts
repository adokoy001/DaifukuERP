// The refusals of a depreciation run (docs/specs/fixed-assets.md AC-11, AC-14, AC-15; D5, D13). Pure: the preview
// lists them as `blockers`, the run throws the matching error, so the screen and the action never disagree.
import { StateError, ValidationError, type LocalDate } from '@daifuku/kernel';
import type { PeriodRow } from './history.ts';
import { isTwelveMonthYear, MAX_RUN_ASSETS, type PeriodPlan } from './plan.ts';
import type { FiscalYearLike } from './schedule.ts';

export const FUTURE_PERIOD_HINT =
  'Run depreciation for a period once it has started: booking depreciation that has not happened yet would also block a later disposal.';
export const OVER_LIMIT_HINT =
  'One run books at most 500 assets (the journal line limit). Booking more assets in one period is not supported yet.';
export const LATER_YEAR_HINT =
  'These assets already have depreciation booked in a later fiscal year. Cancel the later runs first (newest first), then run this period.';
export const TWELVE_MONTH_HINT = 'Depreciation supports fiscal years of twelve calendar months only.';

export const BLOCKERS = [
  'period_closed',
  'year_closed',
  'future_period',
  'not_twelve_months',
  'rules_unverified',
  'over_limit',
  'later_year_booked',
] as const;
export type Blocker = (typeof BLOCKERS)[number];

/** AC-11: why a run of the plan's period would be refused (empty: it can run). */
export function blockersOf(
  plan: Pick<PeriodPlan, 'period' | 'year' | 'lines' | 'laterYearCodes'>,
  periods: readonly PeriodRow[],
  today: LocalDate,
  usable: boolean,
): Blocker[] {
  const out: Blocker[] = [];
  if (plan.period.isClosed) out.push('period_closed');
  if (plan.year.isClosed) out.push('year_closed');
  if (plan.period.startDate > today) out.push('future_period');
  if (!isTwelveMonthYear(plan.year, periods)) out.push('not_twelve_months');
  if (!usable) out.push('rules_unverified');
  if (plan.lines.length > MAX_RUN_ASSETS) out.push('over_limit');
  if (plan.laterYearCodes.length > 0) out.push('later_year_booked');
  return out;
}

/** AC-14: the refusals that depend on the period and its year only (checked before the plan is computed). */
export function assertPeriodRunnable(
  period: PeriodRow,
  year: FiscalYearLike,
  periods: readonly PeriodRow[],
  today: LocalDate,
): void {
  if (!isTwelveMonthYear(year, periods))
    throw new StateError(`fiscal year ${year.code} is not twelve calendar months`, TWELVE_MONTH_HINT, {
      reason: 'not_twelve_months',
    });
  if (period.startDate > today)
    throw new StateError(`fiscal period ${period.code} has not started yet`, FUTURE_PERIOD_HINT, {
      reason: 'future_period',
      periodId: period.id,
      code: period.code,
    });
}

/** AC-15: the refusals that depend on the plan (more than 500 assets, a later fiscal year already booked). */
export function assertPlanRunnable(plan: Pick<PeriodPlan, 'period' | 'lines' | 'laterYearCodes'>): void {
  if (plan.lines.length > MAX_RUN_ASSETS)
    throw new ValidationError(
      `${plan.lines.length} assets are due in ${plan.period.code}; one run books at most ${MAX_RUN_ASSETS}`,
      [{ path: 'periodId', message: `more than ${MAX_RUN_ASSETS} assets (not supported yet)` }],
      OVER_LIMIT_HINT,
    );
  if (plan.laterYearCodes.length > 0)
    throw new StateError(
      `depreciation is booked in a later fiscal year for ${plan.laterYearCodes.join(', ')}`,
      LATER_YEAR_HINT,
      { reason: 'later_year_booked', codes: plan.laterYearCodes },
    );
}
