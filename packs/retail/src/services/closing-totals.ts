// Pure pieces of a register closing (docs/specs/pack-retail.md AC-3). No DB.
// Prices are tax-inclusive: per (category, rate) group the tax is gross × rate ÷ (1 + rate), rounded ONCE per group
// (modules/tax summarizeTax, 国税庁 Q&A 問57), and 税抜 = gross − tax. The header fields are shaped by the sales module's
// totalsFrom, so a closing and the invoice made from it carry the same summary rows.
import { Decimal, type DecimalInput, type RoundingMode } from '@daifuku/kernel';
import { totalsFrom, tryDecimal, type InvoiceTaxSummaryRow, type InvoiceTotals } from '@daifuku/mod-sales';
import { summarizeTax, type TaxCategory } from '@daifuku/mod-tax';

export interface ClosingTaxLine {
  /** quantity × tax-inclusive unit price, unrounded. */
  amount: DecimalInput;
  category: TaxCategory;
  rate: DecimalInput;
}

/** Header totals for tax-inclusive lines with explicit rates (the DB hook gets the rates from modules/tax taxSummaryFor). */
export function closingTotals(
  lines: readonly ClosingTaxLine[],
  opts: { roundingMode: RoundingMode; scale: number },
): InvoiceTotals {
  const summary = summarizeTax(
    lines.map((l) => ({ amount: Decimal.from(l.amount), category: l.category, rate: Decimal.from(l.rate) })),
    { roundingMode: opts.roundingMode, scale: opts.scale, priceIncludesTax: true },
  );
  return totalsFrom(summary);
}

/** `quantity × unitPrice`, unrounded (AC-2). */
export function lineAmount(quantity: DecimalInput, unitPrice: DecimalInput): Decimal {
  return Decimal.from(quantity).times(unitPrice);
}

export interface TenderCheck {
  tendered: Decimal;
  /** total − (cash + card): positive = under-tendered, negative = over-tendered. */
  difference: Decimal;
}

/** AC-3: cash + card against the computed total. */
export function tenderCheck(input: {
  cashAmount: DecimalInput;
  cardAmount: DecimalInput;
  total: DecimalInput;
}): TenderCheck {
  const tendered = Decimal.from(input.cashAmount).plus(input.cardAmount);
  return { tendered, difference: Decimal.from(input.total).minus(tendered) };
}

/** Human hint for a non-zero difference (AC-3: the hint carries the difference). */
export function tenderHint(check: TenderCheck, total: DecimalInput): string {
  const diff = check.difference;
  const direction = diff.isNegative() ? `${diff.abs().toString()} too much` : `${diff.toString()} short`;
  return `cash + card = ${check.tendered.toString()} but the lines total ${Decimal.from(total).toString()} (${direction}; 差額 ${diff.toString()}). Fix the cash/card amounts or the lines.`;
}

/** Decimal from a raw row value (Decimal, decimal string or integer); 0 for null/undefined/garbage. */
export function decimalOf(v: unknown): Decimal {
  return tryDecimal(v) ?? Decimal.zero();
}

/** taxSummary JSON as stored on the closing; unreadable entries are dropped. */
export function summaryRowsOf(v: unknown): InvoiceTaxSummaryRow[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is InvoiceTaxSummaryRow =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as { rate?: unknown }).rate === 'string' &&
      typeof (r as { tax?: unknown }).tax === 'string',
  );
}

/** Percent key of a rate: '0.08' -> '8', '0.1' -> '10'. */
export function ratePercentKey(rate: DecimalInput): string {
  return Decimal.from(rate).times(100).toString();
}
