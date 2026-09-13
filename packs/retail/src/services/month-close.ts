// Pure pieces of retail.close_month (docs/specs/pack-retail.md AC-7). No DB.
// 三分法 month end: the previous closing inventory goes back into the cost of sales (Dr 期首商品棚卸高 / Cr 商品) and this
// month's closing inventory comes out of it (Dr 商品 / Cr 期末商品棚卸高). Lines carry no tax category: these transfers are
// not taxable transactions, so accounting.tax_period_summary ignores them.
import { Decimal, type DecimalInput, type LocalDate } from '@daifuku/kernel';
import { daysInMonth, type LineInput } from '@daifuku/mod-accounting';
import type { ClosingAccountIds } from '../settings.ts';

export interface PeriodRange {
  from: LocalDate;
  to: LocalDate;
}

/** '2026-11' -> { from: '2026-11-01', to: '2026-11-30' }. The caller validates the format. */
export function periodRange(period: string): PeriodRange {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const last = String(daysInMonth(year, month)).padStart(2, '0');
  return { from: `${period}-01`, to: `${period}-${last}` };
}

export interface MonthCloseAmounts {
  /** Previous close's closing inventory (0 when this is the first close). */
  opening: DecimalInput;
  /** inventory.valuation total at the period end. */
  closing: DecimalInput;
}

export const MEMO = {
  opening: '期首商品棚卸高（前月末の商品を売上原価へ振替）',
  closing: '期末商品棚卸高（月末の商品を売上原価から控除）',
} as const;

/** Balanced journal lines in posting order; zero amounts produce no lines (an empty result means: post nothing). */
export function monthCloseLines(amounts: MonthCloseAmounts, accounts: ClosingAccountIds): LineInput[] {
  const opening = Decimal.from(amounts.opening);
  const closing = Decimal.from(amounts.closing);
  const out: LineInput[] = [];
  if (!opening.isZero()) {
    out.push(
      signed(accounts.openingStock, opening, MEMO.opening),
      signed(accounts.inventory, opening.neg(), MEMO.opening),
    );
  }
  if (!closing.isZero()) {
    out.push(
      signed(accounts.inventory, closing, MEMO.closing),
      signed(accounts.closingStock, closing.neg(), MEMO.closing),
    );
  }
  return out;
}

/** Positive = debit, negative = credit (a negative valuation under allow_negative_stock mirrors the entry). */
function signed(accountId: string, amount: Decimal, memo: string): LineInput {
  return amount.isNegative()
    ? { accountId, credit: amount.abs().toString(), memo }
    : { accountId, debit: amount.toString(), memo };
}

/** The latest close strictly before `period` (periods compare as text: YYYY-MM). */
export function previousClose<R extends { period: string }>(records: readonly R[], period: string): R | null {
  const earlier = records.filter((r) => r.period < period).sort((a, b) => (a.period < b.period ? 1 : -1));
  return earlier[0] ?? null;
}

/** Closes after `period` (closing out of order would break the opening/closing chain). */
export function laterCloses<R extends { period: string }>(records: readonly R[], period: string): R[] {
  return records.filter((r) => r.period > period);
}
