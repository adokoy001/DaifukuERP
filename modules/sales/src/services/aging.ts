// Pure: AR aging buckets (spec AC-6). Days overdue = asOf − dueDate on LocalDate strings via UTC integer
// arithmetic (no timezone, no floats). A missing due date counts as not due.
import { Decimal, type LocalDate } from '@daifuku/kernel';

export const AGING_BUCKETS = ['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingInput {
  partnerId: string;
  dueDate: LocalDate | null;
  balance: Decimal;
}

export type AgingAmounts = Record<AgingBucket | 'total', Decimal>;

export interface AgingRow extends AgingAmounts {
  partnerId: string;
}

const DAY_MS = 86_400_000;

function utcDays(date: LocalDate): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** `to − from` in whole days (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return utcDays(to) - utcDays(from);
}

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'notDue';
  if (daysOverdue <= 30) return 'days1to30';
  if (daysOverdue <= 60) return 'days31to60';
  if (daysOverdue <= 90) return 'days61to90';
  return 'over90';
}

export function emptyAmounts(): AgingAmounts {
  return {
    notDue: Decimal.zero(),
    days1to30: Decimal.zero(),
    days31to60: Decimal.zero(),
    days61to90: Decimal.zero(),
    over90: Decimal.zero(),
    total: Decimal.zero(),
  };
}

/** One row per partner; insertion order = first appearance. */
export function agingRows(items: readonly AgingInput[], asOf: LocalDate): Map<string, AgingRow> {
  const out = new Map<string, AgingRow>();
  for (const it of items) {
    const row = out.get(it.partnerId) ?? { partnerId: it.partnerId, ...emptyAmounts() };
    const bucket = it.dueDate ? bucketFor(daysBetween(it.dueDate, asOf)) : 'notDue';
    row[bucket] = row[bucket].plus(it.balance);
    row.total = row.total.plus(it.balance);
    out.set(it.partnerId, row);
  }
  return out;
}

/** Column-wise sums over rows. */
export function agingTotals(rows: Iterable<AgingAmounts>): AgingAmounts {
  const t = emptyAmounts();
  for (const r of rows) for (const k of [...AGING_BUCKETS, 'total'] as const) t[k] = t[k].plus(r[k]);
  return t;
}
