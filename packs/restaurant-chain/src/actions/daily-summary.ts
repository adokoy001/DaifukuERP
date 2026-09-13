import {
  column,
  Decimal,
  defineAction,
  isLocalDate,
  label,
  MAX_REPORT_ROWS,
  repo,
  tableResult,
  ValidationError,
  type Context,
  type Infer,
  type TableResult,
} from '@daifuku/kernel';
import { z } from 'zod';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantStore } from '../entities/store.ts';

const localDate = z.string().refine(isLocalDate, 'YYYY-MM-DD の日付を指定してください');
const input = z.object({
  from: localDate.meta({ title: '開始日' }),
  to: localDate.meta({ title: '終了日' }),
  storeId: z.uuid().optional().meta({ title: '店舗（空欄は全店舗）' }),
});
type Input = z.output<typeof input>;
type Closing = Infer<typeof RestaurantClosing>;
const measures = [
  'subtotal',
  'taxTotal',
  'total',
  'cashAmount',
  'cardAmount',
  'qrAmount',
  'quantity',
  'consumptionCost',
  'wasteCost',
] as const;
const measureLabels = [
  '税抜売上',
  '消費税',
  '税込売上',
  '現金売上',
  'カード売上',
  'QR売上',
  '販売数',
  '材料消費原価',
  '材料廃棄原価',
];
type Totals = Record<(typeof measures)[number], Decimal>;
interface Daily {
  date: string;
  storeId: string;
  amounts: Totals;
}
const zero = (): Totals => Object.fromEntries(measures.map((key) => [key, Decimal.zero()])) as Totals;

function add(rows: Map<string, Daily>, c: Closing, date: string, sign: string, range: Input): void {
  if (date < range.from || date > range.to) return;
  const key = `${date}/${c.storeId}`;
  const row = rows.get(key) ?? { date, storeId: c.storeId, amounts: zero() };
  for (const measure of measures) row.amounts[measure] = row.amounts[measure].plus(c[measure].times(sign));
  rows.set(key, row);
}
async function collect(ctx: Context, range: Input): Promise<Map<string, Daily>> {
  const rows = new Map<string, Daily>();
  const where = {
    ...(range.storeId ? { storeId: range.storeId } : {}),
    docstatus: { $in: [1, 2] },
    $or: [
      { $and: [{ date: { $gte: range.from } }, { date: { $lte: range.to } }] },
      { $and: [{ cancelledDate: { $gte: range.from } }, { cancelledDate: { $lte: range.to } }] },
    ],
  };
  for (let offset = 0; ;) {
    const page = await repo(ctx, RestaurantClosing).list({
      where,
      orderBy: [{ field: 'id', dir: 'asc' }],
      limit: 500,
      offset,
    });
    if (page.total > MAX_REPORT_ROWS)
      throw new ValidationError('集計対象が多すぎます。店舗または期間を絞ってください', [
        { path: 'from', message: `maximum ${MAX_REPORT_ROWS} closings` },
      ]);
    for (const c of page.items) {
      add(rows, c, c.date, '1', range);
      if (c.docstatus === 2 && c.cancelledDate) add(rows, c, c.cancelledDate, '-1', range);
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return rows;
  }
}
export async function dailySummary(ctx: Context, range: Input): Promise<TableResult> {
  if (range.from > range.to)
    throw new ValidationError('終了日は開始日以降にしてください', [
      { path: 'to', message: 'must be on or after from' },
    ]);
  if (range.storeId) await repo(ctx, RestaurantStore).get(range.storeId);
  const rows = await collect(ctx, range);
  const names = new Map<string, string>();
  for (const row of rows.values())
    if (!names.has(row.storeId)) names.set(row.storeId, (await repo(ctx, RestaurantStore).get(row.storeId)).name);
  const totals = zero();
  const result = [...rows.values()]
    .sort((a, b) => `${a.date}/${a.storeId}`.localeCompare(`${b.date}/${b.storeId}`))
    .map((row) => {
      for (const key of measures) totals[key] = totals[key].plus(row.amounts[key]);
      return {
        date: row.date,
        store: names.get(row.storeId) ?? row.storeId,
        ...Object.fromEntries(measures.map((key) => [key, row.amounts[key].toString()])),
      };
    });
  return {
    title: label('店舗別日次集計', 'Daily restaurant summary'),
    columns: [
      column('date', label('計上日', 'Date'), 'date'),
      column('store', label('店舗', 'Store'), 'text'),
      ...measures.map((key, i) => column(key, label(measureLabels[i] ?? key, key), 'decimal')),
    ],
    rows: result,
    totals: Object.fromEntries(measures.map((key) => [key, totals[key].toString()])),
    meta: {
      from: range.from,
      to: range.to,
      inventoryCostBasis: 'moving_average_subledger',
      cancellationBasis: 'effective_date',
    },
  };
}
export const dailySummaryAction = defineAction({
  name: 'restaurant_chain.daily_summary',
  description: label(
    '店舗別日次集計（取消は取消有効日のマイナス。材料原価は在庫補助簿）',
    'Daily restaurant sales and inventory costs, reversals on their effective date',
  ),
  input,
  output: tableResult,
  permission: { entity: RestaurantClosing.name, op: 'read' },
  storeAccess: true,
  exportEntities: [RestaurantClosing.name, RestaurantStore.name],
  tx: 'none',
  mutates: false,
  handler: dailySummary,
});
