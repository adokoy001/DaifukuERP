// inventory.valuation (docs/specs/inventory.md AC-7): per product, across warehouses, the quantity and value as of a date
// (ledger replayed up to asOf) and average = value ÷ qty. totals.value is the basis of 期末商品棚卸高 under 三分法 —
// this module posts no journal entry; the closing entry is made in accounting by hand or by a pack (spec scope).
import { Decimal, defineAction, label, column, tableResult, type Context, type TableColumn, type TableResult } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { z } from 'zod';
import { StockLedger } from '../entities/stock-ledger.ts';
import { averageOf, isEmptyBalance, ledgerSums, localDate, productNames, sortKey } from './helpers.ts';

export const valuationInput = z.object({ asOf: localDate });
export type ValuationInput = z.output<typeof valuationInput>;

export const VALUATION_COLUMNS: TableColumn[] = [
  column('productCode', label('品目コード', 'Product code'), 'text'),
  column('productName', label('品目', 'Product'), 'text'),
  column('qty', label('数量', 'Quantity'), 'decimal'),
  column('avgCost', label('平均単価', 'Average cost'), 'decimal'),
  column('value', label('在庫金額', 'Value'), 'decimal'),
  column('productId', label('品目ID', 'Product id'), 'ref', { ref: Product.name }),
];

export async function valuation(ctx: Context, input: ValuationInput): Promise<TableResult> {
  const { sums, truncated } = await ledgerSums(ctx, { date: { $lte: input.asOf } }, false);
  const lines = sums.filter((s) => !isEmptyBalance(s));
  const products = await productNames(
    ctx,
    lines.map((l) => l.productId),
  );
  const ordered = [...lines].sort((a, b) => sortKey(products, a.productId).localeCompare(sortKey(products, b.productId)));
  const rows = ordered.map((l) => ({
    productCode: products.get(l.productId)?.code ?? null,
    productName: products.get(l.productId)?.name ?? l.productId,
    qty: l.qty.toString(),
    avgCost: averageOf(l.qty, l.value).toString(),
    value: l.value.toString(),
    productId: l.productId,
  }));
  return {
    title: label('在庫評価（移動平均法）', 'Inventory valuation (moving average)'),
    columns: VALUATION_COLUMNS,
    rows,
    totals: { value: Decimal.sum(lines.map((l) => l.value)).toString() },
    meta: { asOf: input.asOf, method: 'moving_average', note: '期末商品棚卸高の元（仕訳は作らない）', truncated },
  };
}

export const valuationAction = defineAction({
  name: 'inventory.valuation',
  description: label(
    '在庫評価: asOf（YYYY-MM-DD）時点の品目ごとの数量・平均単価・在庫金額（全倉庫合計、移動平均法）。合計は期末商品棚卸高の元になります（仕訳は作りません）。',
    'Inventory valuation as of a date (YYYY-MM-DD): quantity, average cost and value per product across warehouses (moving average). The total is the basis of the closing inventory entry (no journal is posted).',
  ),
  input: valuationInput,
  output: tableResult,
  exportEntities: ['stock_ledger', 'product'],
  permission: { entity: StockLedger.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => valuation(ctx, input),
});
