// stock_count / stock_count_line hooks (docs/specs/inventory.md AC-6).
// Header before_validate: warehouseId defaults to the default warehouse, date to today (JST); adjustmentEntryId is
//   system-owned. Line before_validate (draft parent only): goods product, countedQty ≥ 0 with ≤ 6 decimals,
//   systemQty = the stock_balance quantity of the count's warehouse now, varianceQty = counted − system.
// before_submit: ≥ 1 line, one line per product, systemQty/varianceQty re-read from the balances (they may have moved
//   since the draft was saved). after_submit: one `adjustment` stock entry for the non-zero variances (in at the current
//   average cost, out at the moving average), submitted and linked both ways. after_cancel: that entry is cancelled.
import {
  Decimal,
  DOCSTATUS,
  isUuid,
  registry,
  repo,
  StateError,
  todayLocal,
  ValidationError,
  type Context,
  type HookArgs,
  type Infer,
  type LocalDate,
} from '@daifuku/kernel';
import { assertInventoryDate } from '../period-close.ts';
import { StockCount } from '../entities/stock-count.ts';
import { StockCountLine } from '../entities/stock-count-line.ts';
import { StockLedger } from '../entities/stock-ledger.ts';
import { listAll, loadBalance } from '../ledger.ts';
import { tryDecimal, type Issue } from '../services/entry-rules.ts';
import { fitsScale } from '../services/moving-average.ts';
import { adjustmentLinesFromCount } from '../services/from-invoice.ts';
import { resolveDefaultWarehouse } from '../settings.ts';
import { asModule, isModuleWrite } from '../system-write.ts';
import { cancelLinkedEntries, createAndSubmitEntry } from './invoices.ts';
import { productKinds } from './submit.ts';

type Raw = Record<string, unknown>;
type CountRow = Infer<typeof StockCount>;
type CountLineRow = Infer<typeof StockCountLine>;

export const COUNT_FROZEN_HINT =
  'Cancel the stock count (its adjustment is cancelled too) and amend it to change the lines.';

function merged(row: Raw, previous: Raw | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}

async function onCountValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (isModuleWrite(ctx)) return;
  if (previous) {
    delete row.adjustmentEntryId;
    return;
  }
  row.adjustmentEntryId = null;
  if (row.date === undefined || row.date === null) row.date = todayLocal(ctx.now());
  if (row.warehouseId === undefined || row.warehouseId === null)
    row.warehouseId = (await resolveDefaultWarehouse(ctx)).id;
}

async function draftParent(ctx: Context, countId: unknown): Promise<CountRow | null> {
  if (typeof countId !== 'string' || !isUuid(countId)) return null;
  const parent = await repo(ctx, StockCount).find(countId);
  if (parent && parent.docstatus !== DOCSTATUS.draft) {
    throw new StateError(
      `stock_count ${parent.number ?? parent.id} is not a draft; its lines are frozen`,
      COUNT_FROZEN_HINT,
      { countId: parent.id, docstatus: parent.docstatus },
    );
  }
  return parent;
}

async function onLineValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (isModuleWrite(ctx)) return;
  if (previous) await draftParent(ctx, previous.countId);
  const parent = await draftParent(ctx, merged(row, previous, 'countId'));
  const productId = merged(row, previous, 'productId');
  const counted = tryDecimal(merged(row, previous, 'countedQty'));
  if (!parent || typeof productId !== 'string' || !isUuid(productId) || !counted) return; // zod / FK report the shape
  const issues: Issue[] = [];
  const kind = (await productKinds(ctx, [productId])).get(productId);
  if (kind !== 'goods')
    issues.push({
      path: 'productId',
      message:
        kind === 'service'
          ? 'a service product has no stock; use a goods product'
          : `product ${productId} does not exist or is not visible`,
    });
  if (counted.lt(0)) issues.push({ path: 'countedQty', message: 'must be >= 0' });
  else if (!fitsScale(counted)) issues.push({ path: 'countedQty', message: 'at most 6 decimal places' });
  if (issues.length > 0)
    throw new ValidationError(
      `stock_count_line: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      issues,
      'Count goods products with a quantity >= 0.',
    );
  const systemQty = (await loadBalance(ctx, { productId, warehouseId: parent.warehouseId }))?.qty ?? Decimal.zero();
  Object.assign(row, { systemQty, varianceQty: counted.minus(systemQty) });
}

async function loadCountLines(ctx: Context, countId: string): Promise<CountLineRow[]> {
  const result = await listAll(
    (q) => repo(ctx, StockCountLine).list(q),
    { where: { countId }, orderBy: [{ field: 'seq', dir: 'asc' }] },
    500,
  );
  if (result.truncated)
    throw new ValidationError('Document exceeds the supported line count', [
      { path: 'lines', message: 'at most 500 lines' },
    ]);
  return result.items;
}

async function onCountSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const warehouseId = row.warehouseId as string;
  await assertInventoryDate(ctx, row.date as LocalDate);
  const lines = await loadCountLines(ctx, id);
  const later = await repo(ctx, StockLedger).list({
    where: { warehouseId, productId: { $in: lines.map((line) => line.productId) }, date: { $gt: row.date as string } },
    limit: 1,
  });
  if (later.items.length)
    throw new StateError(
      'The count predates an existing stock movement',
      'Count at or after the latest movement date; historical stock restatement is not implemented.',
    );
  const kinds = await productKinds(
    ctx,
    lines.map((l) => l.productId),
  );
  const issues: Issue[] = lines.length === 0 ? [{ path: 'lines', message: 'at least 1 line is required' }] : [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (kinds.get(l.productId) !== 'goods')
      issues.push({ path: `lines.${l.seq}.productId`, message: 'must be a visible goods product' });
    if (seen.has(l.productId))
      issues.push({ path: `lines.${l.seq}.productId`, message: 'counted twice; merge the lines' });
    seen.add(l.productId);
  }
  if (issues.length > 0)
    throw new ValidationError(
      `stock_count ${id} cannot be submitted`,
      issues,
      'Fix the count lines (see details.issues), then submit again.',
    );
  for (const l of lines) {
    const systemQty = (await loadBalance(ctx, { productId: l.productId, warehouseId }))?.qty ?? Decimal.zero();
    const varianceQty = l.countedQty.minus(systemQty);
    if (systemQty.eq(l.systemQty) && varianceQty.eq(l.varianceQty)) continue;
    await asModule(ctx, (ctx) => repo(ctx, StockCountLine).update(l.id, { systemQty, varianceQty }));
  }
}

async function onCountSubmitted(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const warehouseId = row.warehouseId as string;
  await assertInventoryDate(ctx, row.date as LocalDate);
  const lines = await loadCountLines(ctx, id);
  const avg = new Map<string, Decimal>();
  for (const l of lines)
    avg.set(l.productId, (await loadBalance(ctx, { productId: l.productId, warehouseId }))?.avgCost ?? Decimal.zero());
  const adjustments = adjustmentLinesFromCount(lines, (productId) => avg.get(productId) ?? Decimal.zero());
  if (adjustments.length === 0) return;
  const head = {
    type: 'adjustment' as const,
    date: row.date as LocalDate,
    warehouseId,
    note: `棚卸 ${String(row.number)}`,
    sourceEntity: StockCount.name,
    sourceId: id,
  };
  const entry = await createAndSubmitEntry(ctx, head, adjustments);
  await asModule(ctx, (ctx) => repo(ctx, StockCount).update(id, { adjustmentEntryId: entry.id }));
}

export function registerCountHooks(): void {
  registry.registerHook(StockCount.name, 'before_validate', onCountValidate);
  registry.registerHook(StockCountLine.name, 'before_validate', onLineValidate);
  registry.registerHook(StockCountLine.name, 'before_delete', async (ctx, { row }) => {
    if (!isModuleWrite(ctx)) await draftParent(ctx, row.countId);
  });
  registry.registerHook(StockCount.name, 'before_submit', onCountSubmit);
  registry.registerHook(StockCount.name, 'after_submit', onCountSubmitted);
  registry.registerHook(StockCount.name, 'after_cancel', (ctx, { row, correctionDate }) =>
    cancelLinkedEntries(ctx, StockCount.name, row.id as string, correctionDate).then(() => undefined),
  );
}
