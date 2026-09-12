// Pure tax engine (docs/specs/tax.md AC-2..AC-4). No DB, no floats, no rounding except in summarizeTax,
// where the 適格請求書 rule applies: 1 invoice, 1 rounding per rate (国税庁 Q&A 問57; docs/domain/japan-tax.md#rounding).
import { Decimal, ValidationError, isLocalDate, type LocalDate, type RoundingMode } from '@daifuku/kernel';
import { ZERO_RATE_FALLBACK, isTaxCategory, isZeroRateCategory, type TaxCategory } from './categories.ts';

/** Structural view of a tax_rate row; entity rows (Infer<typeof TaxRate>) satisfy it directly. */
export interface RateRow {
  code: string;
  category: string;
  rate: Decimal | string;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  label: string;
}

export interface ResolvedRate {
  category: TaxCategory;
  code: string;
  rate: Decimal;
  label: string;
}

export interface LineTaxInput {
  amount: Decimal | string;
  category: TaxCategory;
  rate: Decimal | string;
  /** true: `amount` is 税込 (gross); false/undefined: 税抜 (taxable). */
  priceIncludesTax?: boolean | undefined;
}

export interface LineTax {
  taxable: Decimal;
  tax: Decimal;
  gross: Decimal;
}

export interface SummarizeOptions {
  roundingMode: RoundingMode;
  /** Decimal places of the currency (JPY = 0). */
  scale: number;
  /** Document-level: every line's `amount` is 税込 when true. Default false. */
  priceIncludesTax?: boolean | undefined;
}

export interface TaxGroup {
  category: TaxCategory;
  rate: Decimal;
  taxable: Decimal;
  tax: Decimal;
  gross: Decimal;
  /** Number of lines in the group (for display; not money). */
  lineCount: number;
}

export interface TaxTotals {
  taxable: Decimal;
  tax: Decimal;
  gross: Decimal;
}

export interface TaxSummary {
  groups: TaxGroup[];
  totals: TaxTotals;
}

const ONE = Decimal.from(1);

function inPeriod(r: RateRow, date: LocalDate): boolean {
  return r.validFrom <= date && (r.validTo === null || r.validTo === undefined || date <= r.validTo);
}

/**
 * AC-2: the rate whose validity period contains `date`. Zero-rate categories (免税/非課税/不課税) always resolve
 * to 0, using the row's code/label when one exists and a fixed fallback otherwise. Periods must not overlap
 * (enforced by the before_validate hook); if they do anyway the row with the latest validFrom wins.
 */
export function resolveRate(rates: readonly RateRow[], category: TaxCategory, date: LocalDate): ResolvedRate {
  if (!isTaxCategory(category)) {
    throw new ValidationError(`unknown tax category "${String(category)}"`, [{ path: 'category', message: 'unknown tax category' }]);
  }
  if (!isLocalDate(date)) throw new ValidationError(`invalid date "${date}"`, [{ path: 'date', message: 'must be YYYY-MM-DD' }]);
  const matches = rates.filter((r) => r.category === category && inPeriod(r, date)).sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
  const hit = matches[0];
  if (isZeroRateCategory(category)) {
    const fb = ZERO_RATE_FALLBACK[category];
    return { category, code: hit?.code ?? fb.code, rate: Decimal.zero(), label: hit?.label ?? fb.label };
  }
  if (!hit) {
    throw new ValidationError(`no tax_rate for category "${category}" is valid on ${date}`, [{ path: 'category', message: `no tax rate for ${category} on ${date}` }], `add a tax_rate row for ${category} covering ${date}`);
  }
  return { category, code: hit.code, rate: Decimal.from(hit.rate), label: hit.label };
}

/**
 * AC-3: one line's taxable / tax / gross **without rounding**. 税抜: tax = amount × rate.
 * 税込: taxable = amount ÷ (1 + rate), tax = amount − taxable. Rounding happens once per rate in summarizeTax.
 */
export function computeLineTax(input: LineTaxInput): LineTax {
  const amount = Decimal.from(input.amount);
  const rate = Decimal.from(input.rate);
  assertRate(input.category, rate);
  if (input.priceIncludesTax === true) {
    const taxable = amount.div(ONE.plus(rate));
    return { taxable, tax: amount.minus(taxable), gross: amount };
  }
  const tax = amount.times(rate);
  return { taxable: amount, tax, gross: amount.plus(tax) };
}

function assertRate(category: TaxCategory, rate: Decimal): void {
  if (rate.isNegative()) throw new ValidationError(`tax rate ${rate.toString()} must not be negative`, [{ path: 'rate', message: 'must be >= 0' }]);
  if (isZeroRateCategory(category) && !rate.isZero()) {
    throw new ValidationError(`category ${category} must have rate 0, got ${rate.toString()}`, [{ path: 'rate', message: `must be 0 for ${category}` }]);
  }
}

/** Rounded tax for one (category, rate) group from the group's summed amount. Sign is never flipped by rounding. */
function groupTax(sum: Decimal, rate: Decimal, opts: SummarizeOptions): Decimal {
  const unrounded = opts.priceIncludesTax === true ? sum.times(rate).div(ONE.plus(rate)) : sum.times(rate);
  const rounded = unrounded.round(opts.roundingMode, opts.scale);
  return rounded.isZero() ? Decimal.zero() : rounded;
}

/**
 * AC-4: group lines by (category, rate), sum the amounts, compute and round the tax **once per group**
 * (Q&A 問57). 税抜: taxable = Σamount, gross = taxable + tax. 税込: gross = Σamount, taxable = gross − tax.
 * Group order = first appearance. Totals are the sums of the rounded groups.
 */
export function summarizeTax(lines: readonly LineTaxInput[], opts: SummarizeOptions): TaxSummary {
  if (!Number.isInteger(opts.scale) || opts.scale < 0) throw new ValidationError(`invalid scale ${opts.scale}`, [{ path: 'scale', message: 'must be a non-negative integer' }]);
  const inclusive = opts.priceIncludesTax === true;
  const sums = new Map<string, { category: TaxCategory; rate: Decimal; sum: Decimal; lineCount: number }>();
  for (const line of lines) {
    const rate = Decimal.from(line.rate);
    assertRate(line.category, rate);
    const key = `${line.category}|${rate.toString()}`;
    const g = sums.get(key) ?? { category: line.category, rate, sum: Decimal.zero(), lineCount: 0 };
    g.sum = g.sum.plus(line.amount);
    g.lineCount += 1;
    sums.set(key, g);
  }
  const groups: TaxGroup[] = [];
  for (const g of sums.values()) {
    const tax = groupTax(g.sum, g.rate, opts);
    const taxable = inclusive ? g.sum.minus(tax) : g.sum;
    const gross = inclusive ? g.sum : g.sum.plus(tax);
    groups.push({ category: g.category, rate: g.rate, taxable, tax, gross, lineCount: g.lineCount });
  }
  return {
    groups,
    totals: {
      taxable: Decimal.sum(groups.map((g) => g.taxable)),
      tax: Decimal.sum(groups.map((g) => g.tax)),
      gross: Decimal.sum(groups.map((g) => g.gross)),
    },
  };
}

/** Decimal places used for tax rounding by currency. Stopgap until a currency master exists (ADR-0010). */
export function taxScaleForCurrency(currency: string): number {
  return currency.toUpperCase() === 'JPY' ? 0 : 2;
}
