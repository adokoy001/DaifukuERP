// Pure tax calculation of a settlement (spec AC-5, D7, D20, D21). No DB: rates, rounding and the transitional credit
// ratio arrive as inputs. Amounts are 税込 (priceIncludesTax is always true for receipts).
//   1. Each line gets the rate valid on its expense's date (mod-tax `resolveRate`) and a credit ratio from its invoice kind
//      (qualified / books_only / small_amount → 1, not_qualified → the transitional ratio on the expense date, none → 0).
//   2. Tax is rounded once per receipt (= expense) x tax rate with the company's `tax.rounding` mode — mod-tax
//      `summarizeTax` over that group — and split into deductible / non-deductible with purchase `splitTax` (Q&A 問57,
//      purchase AC-2). Rounding the whole settlement at once would not match the receipts the shops issued.
//   3. When one expense is split over several lines, the group's tax is spread by amount, rounded DOWN to the currency
//      scale, remainder on the last line (so no line is negative); the non-deductible tax is spread the same way but
//      capped at each line's tax, the rest going to the last lines that still have room; deductible = tax − non-deductible.
import { Decimal, type LocalDate, type RoundingMode } from '@daifuku/kernel';
import { splitTax } from '@daifuku/mod-purchase';
import { isZeroRateCategory, resolveRate, summarizeTax, type RateRow, type TaxCategory } from '@daifuku/mod-tax';
import type { InvoiceKind } from '../contract.ts';

export interface TaxLineInput {
  seq: number;
  expenseId: string;
  expenseDate: LocalDate;
  accountId: string;
  taxCategory: TaxCategory;
  /** 税込 amount (> 0). */
  amount: Decimal;
  invoiceKind: InvoiceKind | null;
}

export interface TaxSettings {
  rates: readonly RateRow[];
  rounding: { mode: RoundingMode; scale: number };
  /** The transitional credit ratio for a purchase without a qualified invoice on `date` (purchase override point). */
  transitionalRatio: (date: LocalDate) => Decimal;
}

export interface LineTax {
  seq: number;
  taxRate: Decimal;
  taxableAmount: Decimal;
  taxAmount: Decimal;
  deductibleTax: Decimal;
  nonDeductibleTax: Decimal;
  /** null for a zero-rate category (no tax to credit). */
  creditRatio: Decimal | null;
}

export interface RateGroup {
  category: TaxCategory;
  code: string;
  label: string;
  rate: Decimal;
  taxable: Decimal;
  tax: Decimal;
  gross: Decimal;
  deductibleTax: Decimal;
  nonDeductibleTax: Decimal;
  lineCount: number;
}

export interface SettlementTotals {
  subtotal: Decimal;
  taxTotal: Decimal;
  deductibleTax: Decimal;
  nonDeductibleTax: Decimal;
  total: Decimal;
}

export interface SettlementTax {
  lines: LineTax[];
  groups: RateGroup[];
  totals: SettlementTotals;
}

const ONE = Decimal.from(1);

/** D21: credit ratio of a taxable line. A draft without an invoice kind is previewed as fully creditable. */
export function creditRatioFor(
  kind: InvoiceKind | null,
  date: LocalDate,
  settings: Pick<TaxSettings, 'transitionalRatio'>,
) {
  switch (kind) {
    case 'not_qualified':
      return settings.transitionalRatio(date);
    case 'none':
      return Decimal.zero();
    default:
      return ONE;
  }
}

/** Spread `total` over `weights` rounding each share down to `scale`, remainder on the last (never negative). */
export function spreadDown(total: Decimal, weights: readonly Decimal[], scale: number): Decimal[] {
  const sum = Decimal.sum(weights);
  if (weights.length === 0) return [];
  if (sum.isZero()) return weights.map((_, i) => (i === weights.length - 1 ? total : Decimal.zero()));
  const out = weights.map((w, i) =>
    i === weights.length - 1 ? Decimal.zero() : total.times(w).div(sum).roundDown(scale),
  );
  out[out.length - 1] = total.minus(Decimal.sum(out));
  return out;
}

/** Spread `total` (<= Σ caps) by `weights`, rounded down, each share capped at its cap; the rest fills from the last. */
export function spreadCapped(total: Decimal, weights: readonly Decimal[], caps: readonly Decimal[], scale: number) {
  const sum = Decimal.sum(weights);
  const out = weights.map((w, i) => {
    const share = sum.isZero() ? Decimal.zero() : total.times(w).div(sum).roundDown(scale);
    const cap = caps[i] ?? Decimal.zero();
    return share.gt(cap) ? cap : share;
  });
  let rest = total.minus(Decimal.sum(out));
  for (let i = out.length - 1; i >= 0 && rest.gt(0); i--) {
    const room = (caps[i] ?? Decimal.zero()).minus(out[i] ?? Decimal.zero());
    const add = room.lt(rest) ? room : rest;
    out[i] = (out[i] ?? Decimal.zero()).plus(add);
    rest = rest.minus(add);
  }
  return out;
}

interface Group {
  category: TaxCategory;
  rate: Decimal;
  ratio: Decimal | null;
  lines: TaxLineInput[];
}

/** AC-5: per-line and per-rate tax of a settlement's lines (line order = input order). */
export function computeSettlementTax(lines: readonly TaxLineInput[], settings: TaxSettings): SettlementTax {
  const { mode, scale } = settings.rounding;
  const resolved = lines.map((line) => resolveRate(settings.rates, line.taxCategory, line.expenseDate));
  const groups = new Map<string, Group>();
  lines.forEach((line, i) => {
    const rate = resolved[i]?.rate ?? Decimal.zero();
    const ratio = isZeroRateCategory(line.taxCategory)
      ? null
      : creditRatioFor(line.invoiceKind, line.expenseDate, settings);
    const key = `${line.expenseId}|${line.taxCategory}|${rate.toString()}|${ratio?.toString() ?? '-'}`;
    const group = groups.get(key) ?? { category: line.taxCategory, rate, ratio, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  });
  const byLine = new Map<TaxLineInput, LineTax>();
  for (const group of groups.values()) {
    const gross = Decimal.sum(group.lines.map((l) => l.amount));
    const summary = summarizeTax([{ amount: gross, category: group.category, rate: group.rate }], {
      roundingMode: mode,
      scale,
      priceIncludesTax: true,
    });
    const tax = summary.totals.tax;
    const { nonDeductibleTax } = group.ratio
      ? splitTax(tax, group.ratio, mode, scale)
      : { nonDeductibleTax: Decimal.zero() };
    const weights = group.lines.map((l) => l.amount);
    const taxes = spreadDown(tax, weights, scale);
    const nonDeductible = spreadCapped(nonDeductibleTax, weights, taxes, scale);
    group.lines.forEach((line, i) => {
      const lineTax = taxes[i] ?? Decimal.zero();
      const lineNon = nonDeductible[i] ?? Decimal.zero();
      byLine.set(line, {
        seq: line.seq,
        taxRate: group.rate,
        taxableAmount: line.amount.minus(lineTax),
        taxAmount: lineTax,
        deductibleTax: lineTax.minus(lineNon),
        nonDeductibleTax: lineNon,
        creditRatio: group.ratio,
      });
    });
  }
  const out = lines.map((line) => byLine.get(line) as LineTax);
  const rateGroups = new Map<string, RateGroup>();
  lines.forEach((line, i) => {
    const t = out[i];
    const r = resolved[i];
    if (!t || !r) return;
    const key = `${line.taxCategory}|${t.taxRate.toString()}`;
    const g = rateGroups.get(key) ?? {
      category: line.taxCategory,
      code: r.code,
      label: r.label,
      rate: t.taxRate,
      taxable: Decimal.zero(),
      tax: Decimal.zero(),
      gross: Decimal.zero(),
      deductibleTax: Decimal.zero(),
      nonDeductibleTax: Decimal.zero(),
      lineCount: 0,
    };
    g.taxable = g.taxable.plus(t.taxableAmount);
    g.tax = g.tax.plus(t.taxAmount);
    g.gross = g.gross.plus(line.amount);
    g.deductibleTax = g.deductibleTax.plus(t.deductibleTax);
    g.nonDeductibleTax = g.nonDeductibleTax.plus(t.nonDeductibleTax);
    g.lineCount += 1;
    rateGroups.set(key, g);
  });
  const groupsOut = [...rateGroups.values()];
  const sum = (pick: (g: RateGroup) => Decimal) => Decimal.sum(groupsOut.map(pick));
  return {
    lines: out,
    groups: groupsOut,
    totals: {
      subtotal: sum((g) => g.taxable),
      taxTotal: sum((g) => g.tax),
      deductibleTax: sum((g) => g.deductibleTax),
      nonDeductibleTax: sum((g) => g.nonDeductibleTax),
      total: sum((g) => g.gross),
    },
  };
}

/** Decimal → string for the `taxSummary` JSON column (ADR-0010). */
export function taxSummaryJson(tax: SettlementTax, rounding: { mode: RoundingMode; scale: number }) {
  const s = (d: Decimal) => d.toString();
  return {
    priceIncludesTax: true,
    rounding,
    groups: tax.groups.map((g) => ({
      category: g.category,
      code: g.code,
      label: g.label,
      rate: s(g.rate),
      taxable: s(g.taxable),
      tax: s(g.tax),
      gross: s(g.gross),
      deductibleTax: s(g.deductibleTax),
      nonDeductibleTax: s(g.nonDeductibleTax),
      lineCount: g.lineCount,
    })),
    totals: {
      subtotal: s(tax.totals.subtotal),
      taxTotal: s(tax.totals.taxTotal),
      deductibleTax: s(tax.totals.deductibleTax),
      nonDeductibleTax: s(tax.totals.nonDeductibleTax),
      total: s(tax.totals.total),
    },
  };
}
