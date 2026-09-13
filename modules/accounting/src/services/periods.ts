// Fiscal years and monthly periods (spec AC-2). Pure: integer year/month/day arithmetic on LocalDate strings,
// no Date/timezone (docs/conventions/money-and-dates.md). A fiscal year starts on the 1st of any month and
// runs 12 calendar months (任意開始月).
import type { LocalDate } from '@daifuku/kernel';

export interface DateRange {
  startDate: LocalDate;
  endDate: LocalDate;
}

export interface PeriodSpec extends DateRange {
  /** `YYYY-MM` of the period's month; unique per company. */
  code: string;
}

export const PERIODS_PER_YEAR = 12;

interface Ym {
  y: number;
  m: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n: number) => String(n).padStart(2, '0');

export function daysInMonth(y: number, m: number): number {
  // Day 0 of the next month is the last day of month m (1-based).
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parse(date: LocalDate): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`invalid LocalDate "${date}" (expected YYYY-MM-DD)`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new RangeError(`invalid LocalDate "${date}"`);
  return { y, m, d };
}

function addMonths({ y, m }: Ym, n: number): Ym {
  const idx = m - 1 + n;
  return { y: y + Math.floor(idx / 12), m: (((idx % 12) + 12) % 12) + 1 };
}

function firstDay({ y, m }: Ym): LocalDate {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-01`;
}

function lastDay({ y, m }: Ym): LocalDate {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
}

/** True when the date is the first day of a month (the only allowed fiscal year start). */
export function isFirstOfMonth(date: LocalDate): boolean {
  return parse(date).d === 1;
}

/** The 12-month range starting at `startDate` (must be the 1st of a month). */
export function fiscalYearRange(startDate: LocalDate): DateRange {
  const { y, m, d } = parse(startDate);
  if (d !== 1) throw new RangeError(`fiscal year must start on the 1st of a month, got ${startDate}`);
  return { startDate, endDate: lastDay(addMonths({ y, m }, PERIODS_PER_YEAR - 1)) };
}

/** Japanese convention: the year is named after the calendar year it starts in (2026-04 → FY2026). */
export function fiscalYearCode(startDate: LocalDate): string {
  return `FY${parse(startDate).y}`;
}

/** Twelve contiguous calendar-month periods covering the fiscal year. */
export function monthlyPeriods(startDate: LocalDate): PeriodSpec[] {
  const { y, m } = parse(fiscalYearRange(startDate).startDate);
  const out: PeriodSpec[] = [];
  for (let i = 0; i < PERIODS_PER_YEAR; i++) {
    const ym = addMonths({ y, m }, i);
    out.push({ code: `${String(ym.y).padStart(4, '0')}-${pad2(ym.m)}`, startDate: firstDay(ym), endDate: lastDay(ym) });
  }
  return out;
}

/** Closed-interval overlap. LocalDate strings compare lexicographically because they are zero-padded ISO dates. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function rangeContains(r: DateRange, date: LocalDate): boolean {
  return r.startDate <= date && date <= r.endDate;
}

export function isValidRange(r: DateRange): boolean {
  return r.startDate <= r.endDate;
}
