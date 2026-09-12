// retail.daily_sales (docs/specs/pack-retail.md AC-7): submitted register closings from..to (inclusive) per business date —
// 税抜, 消費税 per rate (8% / 10% columns from the data), 消費税計, 税込, 現金, カード, 締め件数 — and the period totals.
import { column, defineAction, DOCSTATUS, isLocalDate, label, MAX_REPORT_ROWS, repo, tableResult, ValidationError, type Context, type TableColumn, type TableResult } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS, type TaxCategory } from '@daifuku/mod-accounting';
import { z } from 'zod';
import { RetailClosing } from '../entities/retail-closing.ts';
import { summaryRowsOf } from '../services/closing-totals.ts';
import { aggregateDaily, type ClosingForReport, type TaxColumn } from '../services/daily-sales.ts';

const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
export const dailySalesInput = z.object({ from: localDate, to: localDate });
export type DailySalesInput = z.output<typeof dailySalesInput>;

const isCategory = (v: string): v is TaxCategory => (TAX_CATEGORIES as readonly string[]).includes(v);

/** '消費税 8%（軽減税率）' — the accounting module's category names (the ones the tax period summary prints). */
function taxColumn(c: TaxColumn): TableColumn {
  const cat = isCategory(c.category) ? TAX_CATEGORY_LABELS[c.category] : { ja: c.category, en: c.category };
  return column(c.key, label(`消費税 ${c.percent}%（${cat.ja}）`, `Tax ${c.percent}% (${cat.en})`), 'decimal');
}

export function dailySalesColumns(taxColumns: readonly TaxColumn[]): TableColumn[] {
  return [
    column('date', label('営業日', 'Date'), 'date'),
    column('subtotal', label('税抜', 'Excl. tax'), 'decimal'),
    ...taxColumns.map(taxColumn),
    column('taxTotal', label('消費税計', 'Tax total'), 'decimal'),
    column('total', label('税込', 'Incl. tax'), 'decimal'),
    column('cashAmount', label('現金', 'Cash'), 'decimal'),
    column('cardAmount', label('カード', 'Card'), 'decimal'),
    column('count', label('締め件数', 'Closings'), 'int'),
  ];
}

async function loadClosings(ctx: Context, input: DailySalesInput): Promise<{ items: ClosingForReport[]; truncated: boolean }> {
  const where = { docstatus: DOCSTATUS.submitted, $and: [{ date: { $gte: input.from } }, { date: { $lte: input.to } }] };
  const items: ClosingForReport[] = [];
  for (let offset = 0; ; ) {
    const page = await repo(ctx, RetailClosing).list({ where, orderBy: [{ field: 'date', dir: 'asc' }], limit: 500, offset });
    for (const c of page.items) {
      items.push({ date: c.date, subtotal: c.subtotal, taxTotal: c.taxTotal, total: c.total, cashAmount: c.cashAmount, cardAmount: c.cardAmount, taxSummary: summaryRowsOf(c.taxSummary) });
    }
    offset += page.items.length;
    if (items.length >= MAX_REPORT_ROWS) return { items: items.slice(0, MAX_REPORT_ROWS), truncated: true };
    if (page.items.length === 0 || offset >= page.total) return { items, truncated: false };
  }
}

export async function dailySales(ctx: Context, input: DailySalesInput): Promise<TableResult> {
  if (input.from > input.to) throw new ValidationError(`from ${input.from} is after to ${input.to}`, [{ path: 'to', message: 'must be on or after from' }], 'Swap the dates: from is the first day and to the last day (both inclusive).');
  const { items, truncated } = await loadClosings(ctx, input);
  const agg = aggregateDaily(items);
  return {
    title: label(`日次売上 ${input.from}〜${input.to}`, `Daily sales ${input.from}..${input.to}`),
    columns: dailySalesColumns(agg.taxColumns),
    rows: agg.rows,
    totals: agg.totals,
    meta: { from: input.from, to: input.to, priceIncludesTax: true, ...(truncated ? { truncated: true } : {}) },
  };
}

export const dailySalesAction = defineAction({
  name: 'retail.daily_sales',
  description: label(
    '日次売上: from〜to（両端含む）の確定済みレジ締めを営業日ごとに集計します（税抜・税率別の消費税・消費税計・税込・現金・カード・締め件数）。totals は期間合計。',
    'Daily sales: submitted register closings from..to (inclusive) per business date — excl. tax, tax per rate, tax total, incl. tax, cash, card, number of closings; totals for the period.',
  ),
  input: dailySalesInput,
  output: tableResult,
  exportEntities: ['retail_closing'],
  permission: { entity: RetailClosing.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => dailySales(ctx, input),
});
