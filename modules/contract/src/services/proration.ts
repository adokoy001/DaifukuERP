// Proration (日割り) of a monthly contract price (spec AC-3). Pure.
// The factor of a month is an exact fraction — covered days / days in that month under `daily`, 1 for any covered
// month under `none` — and a billing period of k months sums the factors of its months. Month lengths are 28..31, so
// every denominator divides lcm(28, 29, 30, 31) = 377,580 and the integers stay small and exact.
// The invoice unit price is `round(unitPrice × num / den)`: multiplying before the single division keeps an exact
// result exact (31,000 × 10/31 = 10,000 even when rounding up), which a pre-computed decimal factor would not.
import { ValidationError, type Decimal, type LocalDate, type RoundingMode } from '@daifuku/kernel';
import { coveredPeriods, daysInPeriod, periodEnd, periodStart, type Period } from './periods.ts';

/** daily: 当月の実日数で按分; none: 開始月/終了月も満額. */
export const PRORATION_RULES = ['daily', 'none'] as const;
export type ProrationRule = (typeof PRORATION_RULES)[number];

/** A non-negative fraction in lowest terms (den >= 1). */
export interface Fraction {
  readonly num: number;
  readonly den: number;
}

export const ZERO: Fraction = { num: 0, den: 1 };
export const ONE: Fraction = { num: 1, den: 1 };

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

export function fraction(num: number, den: number): Fraction {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num < 0 || den < 1) {
    throw new ValidationError(`invalid fraction ${num}/${den}`, [
      { path: 'factor', message: 'expected non-negative safe integers with den >= 1' },
    ]);
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

export function addFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function isFullFactor(f: Fraction, months: number): boolean {
  return f.den === 1 && f.num === months;
}

/** '10/31', '1', '3', '0'. */
export function formatFraction(f: Fraction): string {
  return f.den === 1 ? String(f.num) : `${f.num}/${f.den}`;
}

/** Days of `period` inside [startDate, endDate] (both inclusive; endDate null = open-ended). 0 when disjoint. */
export function coveredDays(period: Period, startDate: LocalDate, endDate: LocalDate | null): number {
  const first = periodStart(period);
  const last = periodEnd(period);
  const from = startDate > first ? startDate : first;
  const to = endDate !== null && endDate < last ? endDate : last;
  if (from > to) return 0;
  // both ends lie in `period`, so the day-of-month difference is the day count
  return Number(to.slice(8, 10)) - Number(from.slice(8, 10)) + 1;
}

/** Factor of one month: covered/days (daily) or 1 when any day is covered (none); 0 outside the contract. */
export function monthFactor(
  period: Period,
  startDate: LocalDate,
  endDate: LocalDate | null,
  rule: ProrationRule,
): Fraction {
  const days = coveredDays(period, startDate, endDate);
  if (days === 0) return ZERO;
  return rule === 'none' ? ONE : fraction(days, daysInPeriod(period));
}

/** Factor of a billing period of `intervalMonths` months starting at `period`: the sum of its month factors (0..k). */
export function periodFactor(
  period: Period,
  intervalMonths: number,
  startDate: LocalDate,
  endDate: LocalDate | null,
  rule: ProrationRule,
): Fraction {
  return coveredPeriods(period, intervalMonths).reduce(
    (acc, p) => addFractions(acc, monthFactor(p, startDate, endDate, rule)),
    ZERO,
  );
}

/** Invoice unit price: unitPrice × factor rounded once with the contract's mode to `scale` decimals (currency scale). */
export function prorate(unitPrice: Decimal, factor: Fraction, mode: RoundingMode, scale: number): Decimal {
  return unitPrice.times(factor.num).div(factor.den).round(mode, scale);
}
