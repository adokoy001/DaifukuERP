// Pure mapping of purchase/sales invoice lines to stock entry lines (docs/specs/inventory.md AC-5). No DB.
// Only lines with a goods product, a positive quantity and a non-negative unit price move stock: service products,
// expense lines (no product), returns (quantity ≤ 0) and discount lines (unit price < 0) are skipped.
// A receipt line is costed at the 税抜 unit price: the unit price itself on a tax-exclusive bill, unitPrice ÷ (1 + rate)
// rounded to 6 decimals on a tax-inclusive one, where rate is the line's tax category rate in the bill's own tax summary
// (the rate the purchase module used for that date).
import { Decimal, StateError } from '@daifuku/kernel';
import type { ProductKind } from './entry-rules.ts';
import { round6 } from './moving-average.ts';

export interface InvoiceLineLike {
  seq: number;
  productId: string | null;
  quantity: Decimal;
  unitPrice: Decimal;
  taxCategory: string;
}

export interface EntryLineDraft {
  productId: string;
  quantity: string;
  unitCost?: string;
}

/** Lines that move stock, in invoice order. */
export function stockLines<L extends InvoiceLineLike>(
  lines: readonly L[],
  kinds: ReadonlyMap<string, ProductKind>,
): (L & { productId: string })[] {
  return lines.filter(
    (l): l is L & { productId: string } =>
      l.productId !== null && kinds.get(l.productId) === 'goods' && l.quantity.gt(0) && l.unitPrice.gte(0),
  );
}

/** 税抜 unit price: unchanged when the prices exclude tax; unitPrice ÷ (1 + rate), 6 decimals, when they include it. */
export function netUnitPrice(unitPrice: Decimal, rate: Decimal, priceIncludesTax: boolean): Decimal {
  if (!priceIncludesTax || rate.isZero()) return unitPrice;
  return round6(unitPrice.div(Decimal.from(1).plus(rate)));
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * category → rate from an invoice `taxSummary` JSON: purchase stores `{ groups: [{ category, rate, … }] }`, sales stores
 * the group array itself. Unreadable entries are ignored (the caller refuses a goods line whose category is missing).
 */
export function ratesFromTaxSummary(summary: unknown): Map<string, Decimal> {
  const groups = Array.isArray(summary) ? summary : asRecord(summary)?.groups;
  const out = new Map<string, Decimal>();
  if (!Array.isArray(groups)) return out;
  for (const g of groups) {
    const rec = asRecord(g);
    const category = rec?.category;
    const rate = rec?.rate;
    if (typeof category === 'string' && typeof rate === 'string' && Decimal.isDecimalString(rate))
      out.set(category, Decimal.from(rate));
  }
  return out;
}

/** Receipt lines for a submitted purchase invoice (AC-5): goods lines at the 税抜 unit price. */
export function receiptLinesFromPurchase(
  lines: readonly InvoiceLineLike[],
  kinds: ReadonlyMap<string, ProductKind>,
  tax: { priceIncludesTax: boolean; rates: ReadonlyMap<string, Decimal> },
): EntryLineDraft[] {
  return stockLines(lines, kinds).map((l) => {
    const rate = tax.rates.get(l.taxCategory);
    if (rate === undefined) {
      throw new StateError(
        `purchase invoice line ${l.seq}: tax category ${l.taxCategory} is not in the invoice tax summary`,
        'Recalculate the purchase invoice (save it again) so its tax summary covers every line, then submit.',
        { seq: l.seq, taxCategory: l.taxCategory },
      );
    }
    return {
      productId: l.productId,
      quantity: l.quantity.toString(),
      unitCost: netUnitPrice(l.unitPrice, rate, tax.priceIncludesTax).toString(),
    };
  });
}

/** Issue lines for a submitted sales invoice (AC-5): goods lines; the cost comes from the moving average at submit. */
export function issueLinesFromSales(
  lines: readonly InvoiceLineLike[],
  kinds: ReadonlyMap<string, ProductKind>,
): EntryLineDraft[] {
  return stockLines(lines, kinds).map((l) => ({ productId: l.productId, quantity: l.quantity.toString() }));
}

export interface CountLineLike {
  productId: string;
  varianceQty: Decimal;
}

/** Adjustment lines for a stock count (AC-6): one per non-zero variance; `in` lines at the current average cost. */
export function adjustmentLinesFromCount(
  lines: readonly CountLineLike[],
  avgCostOf: (productId: string) => Decimal,
): (EntryLineDraft & { sign: 'in' | 'out' })[] {
  return lines
    .filter((l) => !l.varianceQty.isZero())
    .map((l) =>
      l.varianceQty.gt(0)
        ? {
            productId: l.productId,
            quantity: l.varianceQty.toString(),
            sign: 'in' as const,
            unitCost: avgCostOf(l.productId).toString(),
          }
        : { productId: l.productId, quantity: l.varianceQty.neg().toString(), sign: 'out' as const },
    );
}
