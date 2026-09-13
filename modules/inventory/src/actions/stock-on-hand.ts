// inventory.stock_on_hand (docs/specs/inventory.md AC-7): quantity, moving-average cost and value per product × warehouse.
// Without asOf: the maintained stock_balance rows. With asOf: the ledger replayed up to that date (Σ qtyDelta / Σ costDelta
// of rows dated ≤ asOf; cancelled entries net to zero because their reverse rows carry the original date), average = value ÷ qty.
// Balances with neither quantity nor value are left out. totals.value = Σ value.
import {
  Decimal,
  defineAction,
  label,
  MAX_REPORT_ROWS,
  repo,
  column,
  tableResult,
  type Context,
  type TableColumn,
  type TableResult,
} from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { z } from 'zod';
import { StockBalance } from '../entities/stock-balance.ts';
import { Warehouse } from '../entities/warehouse.ts';
import { listAll } from '../ledger.ts';
import { averageOf, isEmptyBalance, ledgerSums, localDate, productNames, sortKey, warehouseNames } from './helpers.ts';

export const stockOnHandInput = z.object({
  warehouseId: z.uuid().optional(),
  asOf: localDate.optional(),
});
export type StockOnHandInput = z.output<typeof stockOnHandInput>;

export const STOCK_ON_HAND_COLUMNS: TableColumn[] = [
  column('productCode', label('品目コード', 'Product code'), 'text'),
  column('productName', label('品目', 'Product'), 'text'),
  column('warehouseCode', label('倉庫', 'Warehouse'), 'text'),
  column('qty', label('数量', 'Quantity'), 'decimal'),
  column('avgCost', label('移動平均単価', 'Average cost'), 'decimal'),
  column('value', label('在庫金額', 'Value'), 'decimal'),
  column('productId', label('品目ID', 'Product id'), 'ref', { ref: Product.name }),
  column('warehouseId', label('倉庫ID', 'Warehouse id'), 'ref', { ref: Warehouse.name }),
];

interface BalanceLine {
  productId: string;
  warehouseId: string;
  qty: Decimal;
  avgCost: Decimal;
  value: Decimal;
}

async function currentBalances(
  ctx: Context,
  warehouseId: string | undefined,
): Promise<{ lines: BalanceLine[]; truncated: boolean }> {
  const where = warehouseId ? { warehouseId } : {};
  const { items, truncated } = await listAll(
    (q) => repo(ctx, StockBalance).list(q),
    { where, orderBy: [{ field: 'createdAt', dir: 'asc' }] },
    MAX_REPORT_ROWS,
  );
  return {
    lines: items.map((b) => ({
      productId: b.productId,
      warehouseId: b.warehouseId,
      qty: b.qty,
      avgCost: b.avgCost,
      value: b.value,
    })),
    truncated,
  };
}

async function replayedBalances(
  ctx: Context,
  warehouseId: string | undefined,
  asOf: string,
): Promise<{ lines: BalanceLine[]; truncated: boolean }> {
  const { sums, truncated } = await ledgerSums(
    ctx,
    { date: { $lte: asOf }, ...(warehouseId ? { warehouseId } : {}) },
    true,
  );
  return {
    lines: sums.map((s) => ({
      productId: s.productId,
      warehouseId: s.warehouseId ?? '',
      qty: s.qty,
      avgCost: averageOf(s.qty, s.value),
      value: s.value,
    })),
    truncated,
  };
}

export async function stockOnHand(ctx: Context, input: StockOnHandInput): Promise<TableResult> {
  const loaded = input.asOf
    ? await replayedBalances(ctx, input.warehouseId, input.asOf)
    : await currentBalances(ctx, input.warehouseId);
  const lines = loaded.lines.filter((l) => !isEmptyBalance(l));
  const products = await productNames(
    ctx,
    lines.map((l) => l.productId),
  );
  const warehouses = await warehouseNames(
    ctx,
    lines.map((l) => l.warehouseId),
  );
  const ordered = [...lines].sort(
    (a, b) =>
      sortKey(products, a.productId).localeCompare(sortKey(products, b.productId)) ||
      sortKey(warehouses, a.warehouseId).localeCompare(sortKey(warehouses, b.warehouseId)),
  );
  const rows = ordered.map((l) => ({
    productCode: products.get(l.productId)?.code ?? null,
    productName: products.get(l.productId)?.name ?? l.productId,
    warehouseCode: warehouses.get(l.warehouseId)?.code ?? l.warehouseId,
    qty: l.qty.toString(),
    avgCost: l.avgCost.toString(),
    value: l.value.toString(),
    productId: l.productId,
    warehouseId: l.warehouseId,
  }));
  return {
    title: label('在庫照会', 'Stock on hand'),
    columns: STOCK_ON_HAND_COLUMNS,
    rows,
    totals: { value: Decimal.sum(lines.map((l) => l.value)).toString() },
    meta: {
      asOf: input.asOf ?? null,
      warehouseId: input.warehouseId ?? null,
      source: input.asOf ? 'ledger' : 'balance',
      truncated: loaded.truncated,
    },
  };
}

export const stockOnHandAction = defineAction({
  name: 'inventory.stock_on_hand',
  description: label(
    '在庫照会: 品目×倉庫ごとの数量・移動平均単価・在庫金額。warehouseId で倉庫を絞り、asOf（YYYY-MM-DD）を渡すとその日までの在庫台帳を集計した残高を返します（省略時は現在の残高）。',
    'Stock on hand per product × warehouse: quantity, moving-average cost and value. Filter by warehouseId; pass asOf (YYYY-MM-DD) to replay the ledger up to that date (default: current balances).',
  ),
  input: stockOnHandInput,
  output: tableResult,
  exportEntities: ['stock_balance', 'stock_ledger', 'product', 'warehouse'],
  permission: { entity: StockBalance.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => stockOnHand(ctx, input),
});
