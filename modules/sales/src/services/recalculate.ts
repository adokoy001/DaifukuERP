// Pure pieces of the invoice recalculation (spec AC-2): line amounts, shaping the tax module's summary into the
// header fields, balance. No DB, no rounding here — the once-per-rate rounding is the tax module's (Q&A 問57).
import { Decimal, isDecimal, type DecimalInput } from '@daifuku/kernel';
import type { TaxCategory } from '@daifuku/mod-tax';
import type { InvoiceTaxSummaryRow } from '../entities/sales-invoice.ts';

/** Structural view of a tax summary: both the pure `summarizeTax` result and `taxSummaryFor` satisfy it. */
export interface SummaryLike {
  groups: readonly {
    category: TaxCategory;
    code?: string;
    label?: string;
    rate: Decimal;
    taxable: Decimal;
    tax: Decimal;
    gross: Decimal;
    lineCount: number;
  }[];
  totals: { taxable: Decimal; tax: Decimal; gross: Decimal };
}

export interface InvoiceTotals {
  subtotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
  taxSummary: InvoiceTaxSummaryRow[];
}

/** `quantity × unitPrice`, unrounded (AC-1). */
export function lineAmount(quantity: DecimalInput, unitPrice: DecimalInput): Decimal {
  return Decimal.from(quantity).times(unitPrice);
}

/** Raw hook input may be a Decimal, a decimal string or garbage; garbage is left for the zod schema to report. */
export function tryDecimal(v: unknown): Decimal | null {
  if (isDecimal(v)) return v;
  if (typeof v === 'string' && Decimal.isDecimalString(v)) return Decimal.from(v);
  if (typeof v === 'number' && Number.isInteger(v)) return Decimal.from(v);
  return null;
}

/** JSON-safe rows for `sales_invoice.taxSummary` (money as decimal strings, ADR-0010). */
export function shapeSummary(summary: SummaryLike): InvoiceTaxSummaryRow[] {
  return summary.groups.map((g) => ({
    category: g.category,
    code: g.code ?? '',
    label: g.label ?? '',
    rate: g.rate.toString(),
    taxable: g.taxable.toString(),
    tax: g.tax.toString(),
    gross: g.gross.toString(),
    lineCount: g.lineCount,
  }));
}

/** Header totals from a summary: subtotal = Σtaxable (税抜), taxTotal = Σ rounded tax, total = Σgross (税込). */
export function totalsFrom(summary: SummaryLike): InvoiceTotals {
  return {
    subtotal: summary.totals.taxable,
    taxTotal: summary.totals.tax,
    total: summary.totals.gross,
    taxSummary: shapeSummary(summary),
  };
}

export function balanceOf(total: DecimalInput, paidAmount: DecimalInput): Decimal {
  return Decimal.from(total).minus(paidAmount);
}

/** Rate applied to a category on this invoice (from its summary rows); '0' when the category has no group. */
export function rateOfCategory(rows: readonly InvoiceTaxSummaryRow[], category: string): string {
  return rows.find((r) => r.category === category)?.rate ?? '0';
}
