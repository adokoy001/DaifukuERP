// inventory.count_variance (docs/specs/inventory.md AC-7): the lines of one stock count with system / counted / variance
// quantities and the variance value. Draft: system quantity and average cost read live from the balances (what a submit
// now would adjust). Submitted or cancelled: the quantities fixed at submit and the cost of the adjustment entry lines.
import { Decimal, defineAction, DOCSTATUS, label, repo, column, tableResult, type Context, type TableColumn, type TableResult } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { z } from 'zod';
import { StockCount } from '../entities/stock-count.ts';
import { StockCountLine } from '../entities/stock-count-line.ts';
import { StockEntryLine } from '../entities/stock-entry-line.ts';
import { listAll, loadBalance } from '../ledger.ts';
import { round6 } from '../services/moving-average.ts';
import { productNames } from './helpers.ts';

export const countVarianceInput = z.object({ countId: z.uuid() });
export type CountVarianceInput = z.output<typeof countVarianceInput>;

export const COUNT_VARIANCE_COLUMNS: TableColumn[] = [
  column('seq', label('行', 'Seq'), 'int'),
  column('productCode', label('品目コード', 'Product code'), 'text'),
  column('productName', label('品目', 'Product'), 'text'),
  column('systemQty', label('帳簿数量', 'System qty'), 'decimal'),
  column('countedQty', label('実棚数量', 'Counted qty'), 'decimal'),
  column('varianceQty', label('差異数量', 'Variance qty'), 'decimal'),
  column('unitCost', label('単価', 'Unit cost'), 'decimal'),
  column('varianceValue', label('差異金額', 'Variance value'), 'decimal'),
  column('productId', label('品目ID', 'Product id'), 'ref', { ref: Product.name }),
];

interface Costed {
  systemQty: Decimal;
  unitCost: Decimal;
  varianceValue: Decimal;
}

/** productId → signed cost of the adjustment line (+ in, − out) and its unit cost. */
async function adjustmentCosts(ctx: Context, entryId: string | null): Promise<Map<string, { unitCost: Decimal; signed: Decimal }>> {
  const out = new Map<string, { unitCost: Decimal; signed: Decimal }>();
  if (!entryId) return out;
  const { items } = await listAll((q) => repo(ctx, StockEntryLine).list(q), { where: { entryId }, orderBy: [{ field: 'seq', dir: 'asc' }] }, 5000);
  for (const l of items) out.set(l.productId, { unitCost: l.unitCost ?? Decimal.zero(), signed: l.sign === 'out' ? l.amount.neg() : l.amount });
  return out;
}

export async function countVariance(ctx: Context, input: CountVarianceInput): Promise<TableResult> {
  const count = await repo(ctx, StockCount).get(input.countId);
  const { items: lines } = await listAll((q) => repo(ctx, StockCountLine).list(q), { where: { countId: count.id }, orderBy: [{ field: 'seq', dir: 'asc' }] }, 5000);
  const draft = count.docstatus === DOCSTATUS.draft;
  const adjustments = draft ? new Map<string, { unitCost: Decimal; signed: Decimal }>() : await adjustmentCosts(ctx, count.adjustmentEntryId);
  const products = await productNames(
    ctx,
    lines.map((l) => l.productId),
  );
  const rows: Record<string, unknown>[] = [];
  const values: Decimal[] = [];
  for (const l of lines) {
    let costed: Costed;
    if (draft) {
      const balance = await loadBalance(ctx, { productId: l.productId, warehouseId: count.warehouseId });
      const systemQty = balance?.qty ?? Decimal.zero();
      const unitCost = balance?.avgCost ?? Decimal.zero();
      costed = { systemQty, unitCost, varianceValue: round6(l.countedQty.minus(systemQty).times(unitCost)) };
    } else {
      const adj = adjustments.get(l.productId);
      costed = { systemQty: l.systemQty, unitCost: adj?.unitCost ?? Decimal.zero(), varianceValue: adj?.signed ?? Decimal.zero() };
    }
    values.push(costed.varianceValue);
    rows.push({
      seq: l.seq,
      productCode: products.get(l.productId)?.code ?? null,
      productName: products.get(l.productId)?.name ?? l.productId,
      systemQty: costed.systemQty.toString(),
      countedQty: l.countedQty.toString(),
      varianceQty: l.countedQty.minus(costed.systemQty).toString(),
      unitCost: costed.unitCost.toString(),
      varianceValue: costed.varianceValue.toString(),
      productId: l.productId,
    });
  }
  return {
    title: label('棚卸差異', 'Stock count variance'),
    columns: COUNT_VARIANCE_COLUMNS,
    rows,
    totals: { varianceValue: Decimal.sum(values).toString() },
    meta: { countId: count.id, number: count.number, docstatus: count.docstatus, warehouseId: count.warehouseId, date: count.date, adjustmentEntryId: count.adjustmentEntryId, live: draft },
  };
}

export const countVarianceAction = defineAction({
  name: 'inventory.count_variance',
  description: label(
    '棚卸差異: 棚卸（countId）の明細ごとの帳簿数量・実棚数量・差異数量・差異金額。下書きは現在の残高で、確定済みは submit 時の数量と調整伝票の金額で返します。',
    'Stock count variance for a count (countId): system, counted and variance quantities and the variance value per line. Drafts use the current balances; submitted counts the quantities fixed at submit and the adjustment entry costs.',
  ),
  input: countVarianceInput,
  output: tableResult,
  exportEntities: ['stock_count', 'stock_count_line', 'stock_entry_line', 'stock_balance', 'product'],
  permission: { entity: StockCount.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => countVariance(ctx, input),
});
