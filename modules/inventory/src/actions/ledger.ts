// inventory.ledger (docs/specs/inventory.md AC-7): the stock movements of one product (optionally one warehouse) dated
// from..to with a running balance. The opening balance is Σ of the rows dated before `from` (first row, type 'opening');
// movements follow in date order, then posting order. unitCost is the moving average recorded after each row (posting
// order); balanceQty / balanceValue are the running sums in this report's date order.
import {
  Decimal,
  defineAction,
  label,
  MAX_REPORT_ROWS,
  repo,
  ValidationError,
  column,
  tableResult,
  type Context,
  type Domain,
  type TableColumn,
  type TableResult,
} from '@daifuku/kernel';
import { z } from 'zod';
import { StockEntry } from '../entities/stock-entry.ts';
import { StockLedger } from '../entities/stock-ledger.ts';
import { Warehouse } from '../entities/warehouse.ts';
import { listAll, type LedgerRow } from '../ledger.ts';
import { ledgerSums, localDate, productNames, warehouseNames } from './helpers.ts';

export const ledgerInput = z.object({
  productId: z.uuid(),
  warehouseId: z.uuid().optional(),
  from: localDate,
  to: localDate,
});
export type LedgerInput = z.output<typeof ledgerInput>;

export const LEDGER_COLUMNS: TableColumn[] = [
  column('date', label('日付', 'Date'), 'date'),
  column('number', label('伝票番号', 'Entry number'), 'text'),
  column('type', label('区分', 'Type'), 'text'),
  column('warehouseCode', label('倉庫', 'Warehouse'), 'text'),
  column('qtyIn', label('入庫数量', 'Qty in'), 'decimal'),
  column('qtyOut', label('出庫数量', 'Qty out'), 'decimal'),
  column('unitCost', label('単価（移動平均後）', 'Unit cost (average after)'), 'decimal'),
  column('costDelta', label('金額増減', 'Cost change'), 'decimal'),
  column('balanceQty', label('残数量', 'Balance qty'), 'decimal'),
  column('balanceValue', label('残高金額', 'Balance value'), 'decimal'),
  column('reversal', label('取消', 'Reversal'), 'bool'),
  column('entryId', label('入出庫伝票', 'Stock entry'), 'ref', { ref: StockEntry.name }),
  column('warehouseId', label('倉庫ID', 'Warehouse id'), 'ref', { ref: Warehouse.name }),
];

async function entriesById(
  ctx: Context,
  ids: readonly string[],
): Promise<Map<string, { number: string | null; type: string }>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, { number: string | null; type: string }>();
  for (let i = 0; i < unique.length; i += 200) {
    const page = await repo(ctx, StockEntry).list({ where: { id: { $in: unique.slice(i, i + 200) } }, limit: 200 });
    for (const e of page.items) out.set(e.id, { number: e.number, type: e.type });
  }
  return out;
}

function movementRow(
  r: LedgerRow,
  running: { qty: Decimal; value: Decimal },
  entry: { number: string | null; type: string } | undefined,
  warehouseCode: string,
): Record<string, unknown> {
  return {
    date: r.date,
    number: entry?.number ?? null,
    type: entry?.type ?? r.sourceEntity,
    warehouseCode,
    qtyIn: r.qtyDelta.gt(0) ? r.qtyDelta.toString() : '0',
    qtyOut: r.qtyDelta.lt(0) ? r.qtyDelta.neg().toString() : '0',
    unitCost: r.unitCost.toString(),
    costDelta: r.costDelta.toString(),
    balanceQty: running.qty.toString(),
    balanceValue: running.value.toString(),
    reversal: r.reversal,
    entryId: r.sourceEntity === StockEntry.name ? r.sourceId : null,
    warehouseId: r.warehouseId,
  };
}

export async function stockLedger(ctx: Context, input: LedgerInput): Promise<TableResult> {
  if (input.from > input.to)
    throw new ValidationError(
      `from ${input.from} is after to ${input.to}`,
      [{ path: 'from', message: 'must be <= to' }],
      'Pass a from date on or before the to date.',
    );
  const scope: Domain = {
    productId: input.productId,
    ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
  };
  const opening = (await ledgerSums(ctx, { ...scope, date: { $lt: input.from } }, false)).sums[0] ?? {
    qty: Decimal.zero(),
    value: Decimal.zero(),
  };
  const where: Domain = { ...scope, $and: [{ date: { $gte: input.from } }, { date: { $lte: input.to } }] };
  const orderBy = [
    { field: 'date', dir: 'asc' as const },
    { field: 'createdAt', dir: 'asc' as const },
    { field: 'id', dir: 'asc' as const },
  ];
  const { items, truncated } = await listAll(
    (q) => repo(ctx, StockLedger).list(q),
    { where, orderBy },
    MAX_REPORT_ROWS - 1,
  );
  const entries = await entriesById(
    ctx,
    items.filter((r) => r.sourceEntity === StockEntry.name).map((r) => r.sourceId),
  );
  const warehouses = await warehouseNames(
    ctx,
    items.map((r) => r.warehouseId),
  );
  const running = { qty: opening.qty, value: opening.value };
  const rows: Record<string, unknown>[] = [
    {
      date: input.from,
      number: null,
      type: 'opening',
      warehouseCode: null,
      qtyIn: '0',
      qtyOut: '0',
      unitCost: null,
      costDelta: '0',
      balanceQty: running.qty.toString(),
      balanceValue: running.value.toString(),
      reversal: false,
      entryId: null,
      warehouseId: input.warehouseId ?? null,
    },
  ];
  for (const r of items) {
    running.qty = running.qty.plus(r.qtyDelta);
    running.value = running.value.plus(r.costDelta);
    rows.push(movementRow(r, running, entries.get(r.sourceId), warehouses.get(r.warehouseId)?.code ?? r.warehouseId));
  }
  const product = (await productNames(ctx, [input.productId])).get(input.productId);
  const sum = (pick: (r: LedgerRow) => Decimal) => Decimal.sum(items.map(pick)).toString();
  return {
    title: label('在庫台帳', 'Stock ledger'),
    columns: LEDGER_COLUMNS,
    rows,
    totals: {
      qtyIn: sum((r) => (r.qtyDelta.gt(0) ? r.qtyDelta : Decimal.zero())),
      qtyOut: sum((r) => (r.qtyDelta.lt(0) ? r.qtyDelta.neg() : Decimal.zero())),
      costDelta: sum((r) => r.costDelta),
    },
    meta: {
      productId: input.productId,
      productCode: product?.code ?? null,
      productName: product?.name ?? null,
      warehouseId: input.warehouseId ?? null,
      from: input.from,
      to: input.to,
      opening: { qty: opening.qty.toString(), value: opening.value.toString() },
      closing: { qty: running.qty.toString(), value: running.value.toString() },
      truncated,
    },
  };
}

export const ledgerAction = defineAction({
  name: 'inventory.ledger',
  description: label(
    '在庫台帳: 1 品目（warehouseId で倉庫も絞れる）の from〜to の入出庫を日付順に、前残と残数量・残高金額の累計つきで返します。',
    'Stock ledger of one product (optionally one warehouse) from..to in date order, with the opening balance and a running balance.',
  ),
  input: ledgerInput,
  output: tableResult,
  exportEntities: ['stock_ledger', 'stock_entry', 'product', 'warehouse'],
  permission: { entity: StockLedger.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => stockLedger(ctx, input),
});
