// Billing periods and business-date arithmetic for contracts (spec AC-2/AC-3). Pure: no DB, no clock, no timezone.
// A period is the service month `YYYY-MM`; dates are LocalDate strings (`YYYY-MM-DD`) and every computation runs on
// year/month/day integers, so neither the process timezone nor DST can move a date. LocalDate and period strings are
// zero-padded, so plain string comparison is chronological.
import { isLocalDate, ValidationError, type LocalDate } from '@daifuku/kernel';

/** The service month a charge belongs to, `YYYY-MM`. */
export type Period = string;

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** billingDay value meaning 月末: any day past the month's length clamps to its last day. */
export const END_OF_MONTH = 31;

/** advance: the month is billed in the month (当月分を当月請求); arrears: in the following month (当月分を翌月請求). */
export const BILLING_TIMINGS = ['advance', 'arrears'] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];

/** Contract statuses whose periods can still be billed: `ended` keeps the months up to endDate billable. */
export const BILLABLE_STATUSES: readonly string[] = ['active', 'ended'];

/** Why a contract is not billed for a period (the due check). `zero_amount` is added by services/plan.ts. */
export const DUE_SKIP_REASONS = ['not_active', 'already_generated', 'not_started', 'ended', 'not_aligned'] as const;
export type DueSkipReason = (typeof DUE_SKIP_REASONS)[number];

function invalid(path: string, value: unknown, expected: string): ValidationError {
  return new ValidationError(`invalid ${path} "${String(value)}" (expected ${expected})`, [{ path, message: `expected ${expected}` }]);
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function daysInMonth(y: number, m: number): number {
  const days = MONTH_DAYS[m - 1];
  if (days === undefined || !Number.isInteger(y)) throw invalid('month', `${y}-${m}`, 'a month 1..12');
  return m === 2 && isLeapYear(y) ? 29 : days;
}

export function isPeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

export function parsePeriod(period: Period): { y: number; m: number } {
  if (!PERIOD_PATTERN.test(period)) throw invalid('period', period, 'YYYY-MM');
  return { y: Number(period.slice(0, 4)), m: Number(period.slice(5, 7)) };
}

export function formatPeriod(y: number, m: number): Period {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

function assertDate(date: LocalDate): void {
  if (!isLocalDate(date)) throw invalid('date', date, 'YYYY-MM-DD');
}

export function periodOf(date: LocalDate): Period {
  assertDate(date);
  return date.slice(0, 7);
}

/** `period` shifted by `n` months (n may be negative). */
export function addMonths(period: Period, n: number): Period {
  if (!Number.isInteger(n)) throw invalid('months', n, 'an integer');
  const { y, m } = parsePeriod(period);
  const index = y * 12 + (m - 1) + n;
  return formatPeriod(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
}

/** Whole months from `from` to `to` (negative when `to` is earlier). */
export function monthsBetween(from: Period, to: Period): number {
  const a = parsePeriod(from);
  const b = parsePeriod(to);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

export function daysInPeriod(period: Period): number {
  const { y, m } = parsePeriod(period);
  return daysInMonth(y, m);
}

export function periodStart(period: Period): LocalDate {
  parsePeriod(period);
  return `${period}-01`;
}

export function periodEnd(period: Period): LocalDate {
  return `${period}-${String(daysInPeriod(period)).padStart(2, '0')}`;
}

function assertInterval(intervalMonths: number): void {
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1) throw invalid('intervalMonths', intervalMonths, 'an integer >= 1');
}

/** The months a billing period covers: `period` and the following `intervalMonths - 1` months. */
export function coveredPeriods(period: Period, intervalMonths: number): Period[] {
  assertInterval(intervalMonths);
  return Array.from({ length: intervalMonths }, (_, i) => addMonths(period, i));
}

/**
 * Invoice date for a period: `billingDay` of the period's month (advance) or of the following month (arrears),
 * clamped to that month's length (31 = 月末; 31 in February 2026 is 2026-02-28).
 */
export function billingDate(period: Period, billingDay: number, timing: BillingTiming): LocalDate {
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > END_OF_MONTH) throw invalid('billingDay', billingDay, 'an integer 1..31');
  const target = timing === 'arrears' ? addMonths(period, 1) : period;
  const day = Math.min(billingDay, daysInPeriod(target));
  return `${target}-${String(day).padStart(2, '0')}`;
}

/** True when `period` is one of the contract's billing periods: start month + k × intervalMonths (k >= 0). */
export function isAligned(period: Period, startPeriod: Period, intervalMonths: number): boolean {
  assertInterval(intervalMonths);
  const n = monthsBetween(startPeriod, period);
  return n >= 0 && n % intervalMonths === 0;
}

/** Status of a submitted contract on `today`: ended once endDate is before the first day of today's month (AC-2). */
export function statusFor(endDate: LocalDate | null, today: LocalDate): 'active' | 'ended' {
  if (endDate === null) return 'active';
  assertDate(endDate);
  return endDate < periodStart(periodOf(today)) ? 'ended' : 'active';
}

export interface DueTerms {
  status: string;
  startDate: LocalDate;
  endDate: LocalDate | null;
  intervalMonths: number;
}

/**
 * The due check of AC-3, or null when `period` is due: the contract is billable (active/ended), the period has no
 * billing record yet, startDate <= period end, endDate is empty or >= period start, and the period is aligned with the
 * start month by intervalMonths. "nextPeriod <= period" follows: nextPeriod is the earliest aligned period without a
 * billing record (nextPeriodOf), so every aligned, un-generated period at or after the start is >= it.
 */
export function dueReason(terms: DueTerms, period: Period, alreadyGenerated: boolean): DueSkipReason | null {
  parsePeriod(period);
  if (!BILLABLE_STATUSES.includes(terms.status)) return 'not_active';
  if (alreadyGenerated) return 'already_generated';
  const start = periodOf(terms.startDate);
  if (period < start) return 'not_started';
  if (terms.endDate !== null && terms.endDate < periodStart(period)) return 'ended';
  if (!isAligned(period, start, terms.intervalMonths)) return 'not_aligned';
  return null;
}

/**
 * nextPeriod (AC-2/AC-4): the earliest billing period (start month + k × intervalMonths) that has no billing record.
 * Generating periods in order advances it by intervalMonths; a skipped month stays next until it is generated.
 */
export function nextPeriodOf(startDate: LocalDate, intervalMonths: number, billed: Iterable<Period>): Period {
  assertInterval(intervalMonths);
  const done = new Set(billed);
  let candidate = periodOf(startDate);
  // pigeonhole: among |done| + 1 distinct aligned periods at least one has no record
  for (let i = 0; i <= done.size; i++) {
    if (!done.has(candidate)) return candidate;
    candidate = addMonths(candidate, intervalMonths);
  }
  return candidate;
}
