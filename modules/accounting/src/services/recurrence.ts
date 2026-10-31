// Recurring journal schedule, allocation and template rules (docs/specs/recurring-journals.md AC-5..AC-7, AC-11..AC-13,
// AC-21). Pure: no DB, no clock, no timezone. Dates are LocalDate strings (`YYYY-MM-DD`) computed from year/month/day
// integers, so neither the process timezone nor DST can move them; zero-padded strings compare chronologically.
//
// Occurrence k (k = 0, 1, 2, …) falls in the month k × interval months after startDate's month, on dayOfMonth clamped
// to that month's last day (31 = month end). Occurrences before startDate are not counted, so the first one is the first
// matching date on or after startDate; allocation occurrence numbers (1-based) count from there in date order.
import { Decimal, type LocalDate } from '@daifuku/kernel';
import { validateLines, type Issue, type LineCheck } from './balance.ts';
import { daysInMonth } from './periods.ts';

export const RECURRING_KINDS = ['fixed', 'allocation'] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];
export const RECURRING_FREQUENCIES = ['monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** dayOfMonth value meaning 月末, like contract.billingDay: any day past the month's length clamps to its last day. */
export const END_OF_MONTH = 31;
export const MIN_ALLOCATION_PERIODS = 2;
export const MAX_ALLOCATION_PERIODS = 120;
/** Line entity name used in issue paths (`lines.<entity>.<row>.<field>`, the generic form maps them to grid cells). */
export const TEMPLATE_LINE_ENTITY = 'recurring_journal_line';

const INTERVAL_MONTHS: Readonly<Record<RecurringFrequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 };
const LAST_YEAR = 9999;

export interface Schedule {
  kind: RecurringKind;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  startDate: LocalDate;
  endDate: LocalDate | null;
  allocationPeriods: number | null;
}

export interface Occurrence {
  date: LocalDate;
  /** 1-based position among the occurrences on or after startDate (the allocation k of k/N). */
  no: number;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function monthIndex(date: LocalDate): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

export function intervalMonths(frequency: RecurringFrequency): number {
  return INTERVAL_MONTHS[frequency];
}

/** Date of slot k (may fall before startDate for k = 0), or null past year 9999. */
export function slotDate(s: Pick<Schedule, 'frequency' | 'dayOfMonth' | 'startDate'>, k: number): LocalDate | null {
  const target = monthIndex(s.startDate) + k * intervalMonths(s.frequency);
  const y = Math.floor(target / 12);
  const m = (target % 12) + 1;
  if (y > LAST_YEAR) return null;
  const day = Math.min(Math.max(1, Math.trunc(s.dayOfMonth)), daysInMonth(y, m));
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(day, 2)}`;
}

/** 1 when slot 0 falls before startDate (startDate's day is after dayOfMonth), so occurrence numbers start at slot 1. */
function skippedSlots(s: Schedule): number {
  const first = slotDate(s, 0);
  return first !== null && first < s.startDate ? 1 : 0;
}

/** Occurrence number `no` (1-based), ignoring endDate and the allocation count; null past year 9999. */
export function occurrenceAt(s: Schedule, no: number): Occurrence | null {
  const date = slotDate(s, no - 1 + skippedSlots(s));
  return date === null ? null : { date, no };
}

/** The allocation's last (N-th) occurrence date, or null for a fixed template / missing count. */
export function lastAllocationDate(s: Schedule): LocalDate | null {
  if (s.kind !== 'allocation' || !s.allocationPeriods) return null;
  return occurrenceAt(s, s.allocationPeriods)?.date ?? null;
}

function withinBounds(s: Schedule, o: Occurrence): boolean {
  if (s.endDate !== null && o.date > s.endDate) return false;
  if (s.kind === 'allocation' && (!s.allocationPeriods || o.no > s.allocationPeriods)) return false;
  return true;
}

/**
 * AC-5 / AC-8: the first occurrence after the last generated one, or null when the template has ended. "After" is by
 * month: the occurrence's month must be later than lastOccurrenceDate's month, so changing the day, start date or
 * frequency of a fixed template after generation never creates a second entry in an already generated month.
 */
export function nextOccurrence(s: Schedule, lastOccurrenceDate: LocalDate | null): Occurrence | null {
  const skip = skippedSlots(s);
  let no = 1;
  if (lastOccurrenceDate !== null) {
    // first slot whose month is after the last generated month
    const months = monthIndex(lastOccurrenceDate) + 1 - monthIndex(s.startDate);
    const slot = Math.max(skip, Math.ceil(months / intervalMonths(s.frequency)));
    no = slot - skip + 1;
  }
  const o = occurrenceAt(s, no);
  return o !== null && withinBounds(s, o) ? o : null;
}

/** Occurrences from `next` (inclusive) with date ≤ asOf, at most `max` of them, in date order. */
export function dueOccurrences(s: Schedule, lastOccurrenceDate: LocalDate | null, asOf: LocalDate, max: number) {
  const out: Occurrence[] = [];
  let o = nextOccurrence(s, lastOccurrenceDate);
  while (o !== null && o.date <= asOf && out.length < max) {
    out.push(o);
    const next = occurrenceAt(s, o.no + 1);
    o = next !== null && withinBounds(s, next) ? next : null;
  }
  return out;
}

// ---- allocation (AC-13) -----------------------------------------------------------------------------------------

/** The smallest amount of a currency with `scale` decimals (JPY: 1). */
export function minorUnit(scale: number): Decimal {
  return Decimal.from(scale <= 0 ? '1' : `0.${'0'.repeat(scale - 1)}1`);
}

/**
 * Amount of allocation occurrence k of n: occurrences 1..n−1 get total ÷ n rounded toward zero to `scale` decimals; the
 * last one gets the remainder (total − share × (n − 1)), so the shares always add up to the total. Kernel Decimal only.
 */
export function allocationAmount(total: Decimal, n: number, scale: number, k: number): Decimal {
  const share = total.div(n).roundDown(scale);
  return k < n ? share : total.minus(share.times(n - 1));
}

/** Every allocation share, 1..n (for tests and previews). */
export function allocationShares(total: Decimal, n: number, scale: number): Decimal[] {
  return Array.from({ length: n }, (_, i) => allocationAmount(total, n, scale, i + 1));
}

// ---- template rules (AC-7) --------------------------------------------------------------------------------------

export interface TemplateLine {
  debit: Decimal;
  credit: Decimal;
  partnerId: string | null;
  /** From the line's account (`account.partnerRequired`). */
  partnerRequired: boolean;
}

function linePath(row: number, field: string): string {
  return `lines.${TEMPLATE_LINE_ENTITY}.${row}.${field}`;
}

/** Header rules: checked on every create and update, with or without lines. */
export function checkHeader(s: Schedule): Issue[] {
  const issues: Issue[] = [];
  if (s.endDate !== null && s.endDate < s.startDate)
    issues.push({ path: 'endDate', message: 'endDate must be on or after startDate' });
  if (s.kind === 'allocation') {
    if (!s.allocationPeriods)
      issues.push({ path: 'allocationPeriods', message: 'an allocation needs the number of periods' });
    else {
      const last = lastAllocationDate(s);
      if (s.endDate !== null && last !== null && s.endDate < last)
        issues.push({
          path: 'endDate',
          message: `endDate must be empty or on or after the last (${s.allocationPeriods}th) occurrence ${last}`,
        });
    }
  } else if (s.allocationPeriods !== null)
    issues.push({ path: 'allocationPeriods', message: 'a fixed recurring journal has no number of periods' });
  return issues;
}

/** Maps the journal-line issues of validateLines (`lines[i]…`) onto the template's grid cells. */
function gridIssue(issue: Issue): Issue {
  const m = /^lines\[(\d+)\](?:\.(\w+))?$/.exec(issue.path);
  if (!m) return issue;
  return { path: linePath(Number(m[1]), m[2] ?? 'debit'), message: issue.message };
}

/** The total an allocation spreads (its single debit line), or null when the lines are not one debit + one credit. */
export function allocationTotal(lines: readonly TemplateLine[]): Decimal | null {
  if (lines.length !== 2) return null;
  const debit = lines.filter((l) => l.debit.gt(0) && l.credit.isZero());
  const credit = lines.filter((l) => l.credit.gt(0) && l.debit.isZero());
  if (debit.length !== 1 || credit.length !== 1) return null;
  return debit[0]?.debit ?? null;
}

/** Line rules (AC-7): the journal_line rules, plus one debit + one credit line of a total spreadable over n periods. */
export function checkLines(s: Schedule, lines: readonly TemplateLine[], scale: number): Issue[] {
  const checks: LineCheck[] = lines.map((l, i) => ({ ...l, seq: i + 1 }));
  const issues = validateLines(checks).issues.map(gridIssue);
  if (s.kind !== 'allocation') return issues;
  const total = allocationTotal(lines);
  if (total === null) {
    issues.push({ path: 'lines', message: 'an allocation has exactly one debit line and one credit line' });
    return issues;
  }
  const credit = lines.find((l) => l.credit.gt(0))?.credit ?? Decimal.zero();
  if (!total.eq(credit)) return issues; // validateLines already reports the difference
  const debitRow = lines.findIndex((l) => l.debit.gt(0));
  if (!total.roundDown(scale).eq(total))
    issues.push({ path: linePath(debitRow, 'debit'), message: `the total must have at most ${scale} decimals` });
  const n = s.allocationPeriods ?? 0;
  if (n > 0 && total.lt(minorUnit(scale).times(n)))
    issues.push({
      path: linePath(debitRow, 'debit'),
      message: `the total must be at least ${n} × the smallest currency unit to spread over ${n} periods`,
    });
  return issues;
}

/** Header and line rules together (used before generation and after a save with lines). */
export function checkTemplate(s: Schedule, lines: readonly TemplateLine[], scale: number): Issue[] {
  return [...checkHeader(s), ...checkLines(s, lines, scale)];
}

// ---- planning against fiscal periods (AC-11, AC-21) --------------------------------------------------------------

export const STOP_REASONS = ['closed_period', 'closed_year', 'no_period'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface PeriodLike {
  code: string;
  startDate: LocalDate;
  endDate: LocalDate;
  isClosed: boolean;
  fiscalYearId: string;
}
export interface YearLike {
  id: string;
  code: string;
  isClosed: boolean;
}
export type PeriodState =
  | { state: 'open'; periodCode: string; fiscalYearCode: string | null }
  | { state: StopReason; periodCode: string | null; fiscalYearCode: string | null };

/** The same rules as assertOpenPeriod (hooks/validate-entry.ts), on rows already read. */
export function periodState(periods: readonly PeriodLike[], years: readonly YearLike[], date: LocalDate): PeriodState {
  const period = periods.find((p) => p.startDate <= date && p.endDate >= date);
  if (!period) return { state: 'no_period', periodCode: null, fiscalYearCode: null };
  const year = years.find((y) => y.id === period.fiscalYearId);
  if (period.isClosed) return { state: 'closed_period', periodCode: period.code, fiscalYearCode: year?.code ?? null };
  if (year?.isClosed) return { state: 'closed_year', periodCode: period.code, fiscalYearCode: year.code };
  return { state: 'open', periodCode: period.code, fiscalYearCode: year?.code ?? null };
}

export const PLAN_STATUSES = ['due', 'blocked', 'after_blocked', 'invalid_template'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlannedOccurrence extends Occurrence {
  status: PlanStatus;
  reason: StopReason | 'invalid_template' | null;
  amount: Decimal;
  periodCode: string | null;
}

/**
 * AC-21: the due occurrences of one template as generation would treat them. Occurrences in an open period are `due`;
 * the first one in a closed or missing period is `blocked`, an invalid template's first one `invalid_template`, and
 * every later one of that template `after_blocked`.
 */
export function planTemplate(input: {
  schedule: Schedule;
  lastOccurrenceDate: LocalDate | null;
  lines: readonly TemplateLine[];
  scale: number;
  asOf: LocalDate;
  max: number;
  periods: readonly PeriodLike[];
  years: readonly YearLike[];
}): PlannedOccurrence[] {
  const { schedule: s, lines, scale } = input;
  const due = dueOccurrences(s, input.lastOccurrenceDate, input.asOf, input.max);
  const invalid = checkTemplate(s, lines, scale).length > 0;
  const total = allocationTotal(lines);
  const fixedAmount = Decimal.sum(lines.map((l) => l.debit));
  let stopped = false;
  return due.map((o) => {
    const amount =
      s.kind === 'allocation' && total !== null && s.allocationPeriods
        ? allocationAmount(total, s.allocationPeriods, scale, o.no)
        : fixedAmount;
    const ps = periodState(input.periods, input.years, o.date);
    const base = { ...o, amount, periodCode: ps.periodCode };
    if (stopped) return { ...base, status: 'after_blocked' as const, reason: null };
    if (invalid) {
      stopped = true;
      return { ...base, status: 'invalid_template' as const, reason: 'invalid_template' as const };
    }
    if (ps.state !== 'open') {
      stopped = true;
      return { ...base, status: 'blocked' as const, reason: ps.state };
    }
    return { ...base, status: 'due' as const, reason: null };
  });
}
