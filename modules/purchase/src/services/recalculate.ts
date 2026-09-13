// Pure recalculation of a purchase bill (docs/specs/purchase.md AC-2). No DB: the caller obtains the per-rate tax
// summary from modules/tax (`taxSummaryFor`, one rounding per rate, Q&A 問57) and this file splits each group's tax into
// the deductible part (round(tax × creditRatio), rounded once per rate with the company's tax rounding mode, default 切捨て)
// and the non-deductible remainder, then derives the header totals and the JSON stored in `purchase_invoice.taxSummary`.
import { Decimal, type RoundingMode } from '@daifuku/kernel';
import type { TaxCategory } from '@daifuku/mod-tax';

/** Structural subset of modules/tax `DocumentTaxSummary` (so tests can build one from `summarizeTax`). */
export interface TaxSummaryLike {
  priceIncludesTax: boolean;
  rounding: { mode: RoundingMode; scale: number };
  groups: readonly {
    category: TaxCategory;
    rate: Decimal;
    taxable: Decimal;
    tax: Decimal;
    gross: Decimal;
    lineCount: number;
    code?: string | undefined;
    label?: string | undefined;
  }[];
}

export interface CreditGroup {
  category: TaxCategory;
  code: string;
  label: string;
  rate: Decimal;
  taxable: Decimal;
  tax: Decimal;
  gross: Decimal;
  lineCount: number;
  deductibleTax: Decimal;
  nonDeductibleTax: Decimal;
}

export interface PurchaseTotals {
  /** Σ taxable (税抜) over all rate groups. */
  subtotal: Decimal;
  taxTotal: Decimal;
  deductibleTax: Decimal;
  nonDeductibleTax: Decimal;
  /** Σ gross (税込): what is owed to the supplier. */
  total: Decimal;
}

export interface PurchaseCalculation {
  creditRatio: Decimal;
  priceIncludesTax: boolean;
  rounding: { mode: RoundingMode; scale: number };
  groups: CreditGroup[];
  totals: PurchaseTotals;
}

export interface TaxSummaryJson {
  creditRatio: string;
  priceIncludesTax: boolean;
  rounding: { mode: RoundingMode; scale: number };
  groups: {
    category: TaxCategory;
    code: string;
    label: string;
    rate: string;
    taxable: string;
    tax: string;
    gross: string;
    lineCount: number;
    deductibleTax: string;
    nonDeductibleTax: string;
  }[];
  totals: { subtotal: string; taxTotal: string; deductibleTax: string; nonDeductibleTax: string; total: string };
}

/** Line amount = quantity × unit price, unrounded (rounding happens once per rate in the tax summary). */
export function lineAmount(quantity: Decimal | string, unitPrice: Decimal | string): Decimal {
  return Decimal.from(quantity).times(Decimal.from(unitPrice));
}

/** One rate group's tax split: deductible = round(tax × ratio) (sign never flipped by rounding), non-deductible = the rest. */
export function splitTax(
  tax: Decimal,
  creditRatio: Decimal,
  mode: RoundingMode,
  scale: number,
): { deductibleTax: Decimal; nonDeductibleTax: Decimal } {
  const rounded = tax.times(creditRatio).round(mode, scale);
  const deductibleTax = rounded.isZero() ? Decimal.zero() : rounded;
  return { deductibleTax, nonDeductibleTax: tax.minus(deductibleTax) };
}

/** AC-2: apply the credit ratio to every rate group of the tax summary and total the header amounts. */
export function applyCreditRatio(summary: TaxSummaryLike, creditRatio: Decimal): PurchaseCalculation {
  const { mode, scale } = summary.rounding;
  const groups: CreditGroup[] = summary.groups.map((g) => ({
    category: g.category,
    code: g.code ?? '',
    label: g.label ?? '',
    rate: g.rate,
    taxable: g.taxable,
    tax: g.tax,
    gross: g.gross,
    lineCount: g.lineCount,
    ...splitTax(g.tax, creditRatio, mode, scale),
  }));
  const sum = (pick: (g: CreditGroup) => Decimal) => Decimal.sum(groups.map(pick));
  return {
    creditRatio,
    priceIncludesTax: summary.priceIncludesTax,
    rounding: { mode, scale },
    groups,
    totals: {
      subtotal: sum((g) => g.taxable),
      taxTotal: sum((g) => g.tax),
      deductibleTax: sum((g) => g.deductibleTax),
      nonDeductibleTax: sum((g) => g.nonDeductibleTax),
      total: sum((g) => g.gross),
    },
  };
}

/** Decimal → string for the `taxSummary` JSON column and action outputs (ADR-0010). */
export function calculationToJson(calc: PurchaseCalculation): TaxSummaryJson {
  return {
    creditRatio: calc.creditRatio.toString(),
    priceIncludesTax: calc.priceIncludesTax,
    rounding: calc.rounding,
    groups: calc.groups.map((g) => ({
      category: g.category,
      code: g.code,
      label: g.label,
      rate: g.rate.toString(),
      taxable: g.taxable.toString(),
      tax: g.tax.toString(),
      gross: g.gross.toString(),
      lineCount: g.lineCount,
      deductibleTax: g.deductibleTax.toString(),
      nonDeductibleTax: g.nonDeductibleTax.toString(),
    })),
    totals: {
      subtotal: calc.totals.subtotal.toString(),
      taxTotal: calc.totals.taxTotal.toString(),
      deductibleTax: calc.totals.deductibleTax.toString(),
      nonDeductibleTax: calc.totals.nonDeductibleTax.toString(),
      total: calc.totals.total.toString(),
    },
  };
}
