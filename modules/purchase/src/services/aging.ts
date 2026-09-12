// AP aging (docs/specs/purchase.md AC-5): open bills bucketed by days overdue as of a date, one row per supplier.
// Pure and date-arithmetic only on YYYY-MM-DD strings (UTC epoch days; no timezone can shift a business date).
import { Decimal, type LocalDate } from '@daifuku/kernel';

export const AGING_BUCKETS = ['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingBill {
  partnerId: string;
  date: LocalDate;
  /** Falls back to `date` when the bill has no due date. */
  dueDate: LocalDate | null;
  balance: Decimal;
}

export interface AgingPartner {
  code: string | null;
  name: string;
}

export interface AgingRow extends Record<string, unknown> {
  partnerId: string;
  partnerCode: string | null;
  partnerName: string;
  billCount: number;
  notDue: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  over90: string;
  balance: string;
}

const DAY_MS = 86_400_000;

function epochDay(date: LocalDate): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / DAY_MS);
}

/** `to` − `from` in calendar days (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return epochDay(to) - epochDay(from);
}

/** Days overdue = asOf − dueDate. ≤ 0 → not due; then 1–30, 31–60, 61–90, > 90. */
export function agingBucket(dueDate: LocalDate, asOf: LocalDate): AgingBucket {
  const overdue = daysBetween(dueDate, asOf);
  if (overdue <= 0) return 'notDue';
  if (overdue <= 30) return 'days1to30';
  if (overdue <= 60) return 'days31to60';
  if (overdue <= 90) return 'days61to90';
  return 'over90';
}

type Acc = { partnerId: string; billCount: number; buckets: Record<AgingBucket, Decimal>; balance: Decimal };

function emptyBuckets(): Record<AgingBucket, Decimal> {
  return { notDue: Decimal.zero(), days1to30: Decimal.zero(), days31to60: Decimal.zero(), days61to90: Decimal.zero(), over90: Decimal.zero() };
}

function sortKey(row: AgingRow): string {
  return `${row.partnerCode ?? '￿'}|${row.partnerName}|${row.partnerId}`;
}

/** One row per partner (sorted by code, then name), plus column totals. Unknown partners are shown by id. */
export function agingRows(bills: readonly AgingBill[], partners: ReadonlyMap<string, AgingPartner>, asOf: LocalDate): { rows: AgingRow[]; totals: Record<string, string> } {
  const acc = new Map<string, Acc>();
  for (const bill of bills) {
    const a = acc.get(bill.partnerId) ?? { partnerId: bill.partnerId, billCount: 0, buckets: emptyBuckets(), balance: Decimal.zero() };
    const bucket = agingBucket(bill.dueDate ?? bill.date, asOf);
    a.buckets[bucket] = a.buckets[bucket].plus(bill.balance);
    a.balance = a.balance.plus(bill.balance);
    a.billCount += 1;
    acc.set(bill.partnerId, a);
  }
  const rows: AgingRow[] = [...acc.values()].map((a) => {
    const p = partners.get(a.partnerId);
    return {
      partnerId: a.partnerId,
      partnerCode: p?.code ?? null,
      partnerName: p?.name ?? a.partnerId,
      billCount: a.billCount,
      notDue: a.buckets.notDue.toString(),
      days1to30: a.buckets.days1to30.toString(),
      days31to60: a.buckets.days31to60.toString(),
      days61to90: a.buckets.days61to90.toString(),
      over90: a.buckets.over90.toString(),
      balance: a.balance.toString(),
    };
  });
  rows.sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : sortKey(x) > sortKey(y) ? 1 : 0));
  const totals: Record<string, string> = {};
  for (const key of [...AGING_BUCKETS, 'balance'] as const) totals[key] = Decimal.sum(rows.map((r) => Decimal.from(r[key]))).toString();
  return { rows, totals };
}
