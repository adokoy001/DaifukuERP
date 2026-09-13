// Payment due date from 締め日 / 支払月 / 支払日 (docs/domain/japan-tax.md#商習慣). Pure: no DB, no timezone.
// Dates are LocalDate strings (YYYY-MM-DD); arithmetic is done on year/month/day integers so DST and
// timezones cannot shift a business date.
import type { LocalDate } from '@daifuku/kernel';

/** Day-of-month value meaning 月末 (end of month). */
export const END_OF_MONTH = 31;

export interface PaymentTerms {
  /** 1..31; 31 = end of month. */
  closingDay: number;
  /** 0..3 months after the closing month. */
  paymentMonthOffset: number;
  /** 1..31; 31 = end of month. */
  paymentDay: number;
}

export interface DueDateResult {
  /** Last day of the closing period the invoice belongs to. */
  closingDate: LocalDate;
  /** Payment due date. Always >= closingDate >= invoiceDate. */
  dueDate: LocalDate;
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(y: number, m: number): number {
  // Date.UTC(y, m, 0) is the last day of month m (1-based) because month index m is the *next* month.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parse(date: LocalDate): Ymd {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`invalid LocalDate "${date}" (expected YYYY-MM-DD)`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new RangeError(`invalid LocalDate "${date}"`);
  return { y, m, d };
}

function format({ y, m, d }: Ymd): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addMonths(y: number, m: number, n: number): { y: number; m: number } {
  const idx = m - 1 + n;
  return { y: y + Math.floor(idx / 12), m: (((idx % 12) + 12) % 12) + 1 };
}

/** The given day-of-month in (y, m); 31 (or any day past the end) clamps to the month's last day. */
function clampDay(y: number, m: number, day: number): Ymd {
  return { y, m, d: Math.min(day, daysInMonth(y, m)) };
}

function assertTerms(t: PaymentTerms): void {
  const int = (v: number, lo: number, hi: number, name: string) => {
    if (!Number.isInteger(v) || v < lo || v > hi)
      throw new RangeError(`${name} must be an integer in ${lo}..${hi}, got ${v}`);
  };
  int(t.closingDay, 1, 31, 'closingDay');
  int(t.paymentMonthOffset, 0, 3, 'paymentMonthOffset');
  int(t.paymentDay, 1, 31, 'paymentDay');
}

/**
 * Closing date of the period an invoice date belongs to: the closing day of the invoice month if the
 * invoice is on or before it, otherwise the closing day of the next month. 31 means end of month,
 * so "31" in February closes on the 28th/29th.
 */
export function closingDateOf(invoiceDate: LocalDate, closingDay: number): LocalDate {
  const inv = parse(invoiceDate);
  const thisMonth = clampDay(inv.y, inv.m, closingDay);
  if (inv.d <= thisMonth.d) return format(thisMonth);
  const next = addMonths(inv.y, inv.m, 1);
  return format(clampDay(next.y, next.m, closingDay));
}

/**
 * Payment due date for an invoice under the partner's terms.
 * Rule: due = paymentDay of (closing month + paymentMonthOffset), clamped to the month's length.
 * If that lands before the closing date (e.g. offset 0 with paymentDay < closingDay) the payment
 * rolls to the following month, so the result is never earlier than the closing date.
 */
export function computeDueDate(
  invoiceDate: LocalDate,
  closingDay: number,
  paymentMonthOffset: number,
  paymentDay: number,
): LocalDate {
  return resolveDueDate(invoiceDate, { closingDay, paymentMonthOffset, paymentDay }).dueDate;
}

/** Same as computeDueDate but also returns the closing date the invoice was assigned to. */
export function resolveDueDate(invoiceDate: LocalDate, terms: PaymentTerms): DueDateResult {
  assertTerms(terms);
  const closingDate = closingDateOf(invoiceDate, terms.closingDay);
  const closing = parse(closingDate);
  let target = addMonths(closing.y, closing.m, terms.paymentMonthOffset);
  let due = clampDay(target.y, target.m, terms.paymentDay);
  if (format(due) < closingDate) {
    target = addMonths(target.y, target.m, 1);
    due = clampDay(target.y, target.m, terms.paymentDay);
  }
  return { closingDate, dueDate: format(due) };
}
