// Pure aggregation of submitted register closings per business date (docs/specs/pack-retail.md AC-7 retail.daily_sales).
// Tax columns are derived from the closings' own tax summaries (one column per category × rate that carries tax), so a new
// rate row in modules/tax becomes a new column without code changes (tax rates are data, CLAUDE.md rule 10).
import { Decimal, type LocalDate } from '@daifuku/kernel';
import type { InvoiceTaxSummaryRow } from '@daifuku/mod-sales';
import { ratePercentKey } from './closing-totals.ts';

export interface ClosingForReport {
  date: LocalDate;
  subtotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
  cashAmount: Decimal;
  cardAmount: Decimal;
  taxSummary: readonly InvoiceTaxSummaryRow[];
}

export interface TaxColumn {
  key: string;
  category: string;
  percent: string;
  rate: Decimal;
}

export const AMOUNT_KEYS = ['subtotal', 'taxTotal', 'total', 'cashAmount', 'cardAmount'] as const;
type AmountKey = (typeof AMOUNT_KEYS)[number];

export interface DailyAggregate {
  taxColumns: TaxColumn[];
  rows: Record<string, string | number>[];
  totals: Record<string, string>;
}

function taxKey(category: string, rate: string): string {
  return `tax_${category}_${ratePercentKey(rate).replace('.', '_')}`;
}

/** Category × rate groups with a non-zero rate, lowest rate first (8% before 10%). */
export function taxColumnsOf(closings: readonly ClosingForReport[]): TaxColumn[] {
  const byKey = new Map<string, TaxColumn>();
  for (const c of closings) {
    for (const g of c.taxSummary) {
      if (Decimal.from(g.rate).isZero()) continue;
      const key = taxKey(g.category, g.rate);
      if (!byKey.has(key)) byKey.set(key, { key, category: g.category, percent: ratePercentKey(g.rate), rate: Decimal.from(g.rate) });
    }
  }
  return [...byKey.values()].sort((a, b) => a.rate.cmp(b.rate) || a.category.localeCompare(b.category));
}

type Sums = Record<AmountKey, Decimal> & { tax: Map<string, Decimal>; count: number };

function emptySums(): Sums {
  return { subtotal: Decimal.zero(), taxTotal: Decimal.zero(), total: Decimal.zero(), cashAmount: Decimal.zero(), cardAmount: Decimal.zero(), tax: new Map(), count: 0 };
}

function add(s: Sums, c: ClosingForReport): void {
  for (const k of AMOUNT_KEYS) s[k] = s[k].plus(c[k]);
  for (const g of c.taxSummary) {
    const key = taxKey(g.category, g.rate);
    s.tax.set(key, (s.tax.get(key) ?? Decimal.zero()).plus(g.tax));
  }
  s.count += 1;
}

function cells(s: Sums, columns: readonly TaxColumn[]): Record<string, string> {
  const out: Record<string, string> = { subtotal: s.subtotal.toString() };
  for (const col of columns) out[col.key] = (s.tax.get(col.key) ?? Decimal.zero()).toString();
  return { ...out, taxTotal: s.taxTotal.toString(), total: s.total.toString(), cashAmount: s.cashAmount.toString(), cardAmount: s.cardAmount.toString() };
}

/** One row per date (ascending) and the period totals. */
export function aggregateDaily(closings: readonly ClosingForReport[]): DailyAggregate {
  const taxColumns = taxColumnsOf(closings);
  const byDate = new Map<LocalDate, Sums>();
  const all = emptySums();
  for (const c of closings) {
    const s = byDate.get(c.date) ?? emptySums();
    add(s, c);
    byDate.set(c.date, s);
    add(all, c);
  }
  const rows = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, s]) => ({ date, ...cells(s, taxColumns), count: s.count }));
  return { taxColumns, rows, totals: { ...cells(all, taxColumns), count: String(all.count) } };
}
