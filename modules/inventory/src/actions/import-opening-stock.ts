// inventory.import_opening_stock (docs/specs/opening-balances.md AC-6, AC-23, AC-24, D-14, D-15): opening quantities
// and unit costs per product × warehouse, received on the opening date as receipts linked to the fiscal year
// (sourceEntity 'fiscal_year'), one per warehouse and 500 lines. Each line is the first moving-average acquisition of
// its product × warehouse (average = the unit cost). No journal entry: the inventory account's opening balance is a
// row of the opening journal. A product × warehouse that already moved (or holds stock) is refused (`stock_exists`).
import { Decimal, defineAction, label, repo, submitDocument, type Context, type Infer } from '@daifuku/kernel';
import {
  assertOpeningCurrency,
  assertOpeningInputSize,
  assertOpeningOps,
  assertOpeningYear,
  assertOpeningYearLocked,
  attemptOpeningUnit,
  isOpeningMessage,
  lookupByCode,
  openingCell,
  openingFieldMessage,
  openingImportResult,
  openingMode,
  openingYearJson,
  OPENING_INPUT_BYTES,
  OPENING_ROLES,
  OPENING_SOURCE,
  readOpeningCode,
  readOpeningQuantity,
  readOpeningUnitCost,
  rowResult,
  runOpeningImport,
  summarizeOpeningRows,
  type OpeningDocument,
  type OpeningImportResult,
  type OpeningMessage,
  type OpeningRowResult,
  type OpeningYear,
} from '@daifuku/mod-accounting';
import { Product } from '@daifuku/mod-product';
import { z } from 'zod';
import { StockBalance } from '../entities/stock-balance.ts';
import { StockEntryLine } from '../entities/stock-entry-line.ts';
import { StockEntry } from '../entities/stock-entry.ts';
import { StockLedger } from '../entities/stock-ledger.ts';
import { Warehouse } from '../entities/warehouse.ts';
import { assertInventoryDate } from '../period-close.ts';
import { roleAllowsEntry } from '../services/entry-rules.ts';
import { round6 } from '../services/moving-average.ts';
import { resolveDefaultWarehouse } from '../settings.ts';
import { asModule } from '../system-write.ts';

/** AC-23: rows per request; AC-24: lines per receipt (the document line limit). */
// Measured (work log): about 18 s per 1,000 lines on a loaded container; 2,000 rows keep the inventory series lock
// (every stock posting of the company waits) well under a minute.
export const OPENING_STOCK_MAX_ROWS = 2000;
export const OPENING_STOCK_LINES_PER_ENTRY = 500;

export const importOpeningStockInput = z
  .object({
    fiscalYearId: z.uuid(),
    mode: openingMode,
    rows: z
      .array(
        z
          .object({
            warehouseCode: openingCell,
            productCode: openingCell,
            quantity: openingCell,
            unitCost: openingCell,
          })
          .strict(),
      )
      .min(1)
      .max(OPENING_STOCK_MAX_ROWS),
  })
  .strict();
export type ImportOpeningStockInput = z.output<typeof importOpeningStockInput>;

type WarehouseRow = Infer<typeof Warehouse>;

interface StockRow {
  line: number;
  product: { id: string; code: string | null };
  warehouse: WarehouseRow;
  quantity: Decimal;
  unitCost: Decimal;
}

const upper = (s: string) => s.toUpperCase();
const keyOf = (productId: string, warehouseId: string) => `${productId}\u0000${warehouseId}`;
const CHUNK = 200;

/** AC-23: product × warehouse pairs that already hold stock or moved after the opening date. */
async function movedPairs(ctx: Context, productIds: readonly string[], openingDate: string): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(productIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    for (let offset = 0; ;) {
      const page = await repo(ctx, StockBalance).list({ where: { productId: { $in: chunk } }, limit: 500, offset });
      for (const b of page.items) if (!b.qty.isZero() || !b.value.isZero()) out.add(keyOf(b.productId, b.warehouseId));
      offset += page.items.length;
      if (page.items.length === 0 || offset >= page.total) break;
    }
    const later = await repo(ctx, StockLedger).aggregate({
      where: { productId: { $in: chunk }, date: { $gt: openingDate } },
      groupBy: ['productId', 'warehouseId'],
      metrics: { n: { count: true } },
    });
    for (const g of later) out.add(keyOf(String(g.productId), String(g.warehouseId)));
  }
  return out;
}

async function createReceipt(
  ctx: Context,
  year: OpeningYear,
  warehouse: WarehouseRow,
  lines: readonly StockRow[],
): Promise<OpeningDocument> {
  // Module write only for the creation (the fiscal-year link and the pre-checked lines); the submit runs in the
  // caller's own context, so its receipt-role check (assertEntryRole) applies as a second line of defence.
  const draft = await asModule(ctx, async (internal) => {
    const entry = await repo(internal, StockEntry).create({
      type: 'receipt',
      date: year.openingDate,
      warehouseId: warehouse.id,
      note: `期首在庫 ${year.fiscalYear.code}`,
      sourceEntity: OPENING_SOURCE,
      sourceId: year.fiscalYear.id,
    });
    for (const [index, l] of lines.entries())
      await repo(internal, StockEntryLine).create({
        entryId: entry.id,
        seq: index + 1,
        productId: l.product.id,
        quantity: l.quantity,
        unitCost: l.unitCost,
        amount: round6(l.quantity.times(l.unitCost)),
      });
    return entry;
  });
  const submitted = await submitDocument(ctx, StockEntry, draft.id);
  return { entity: StockEntry.name, id: submitted.id, number: submitted.number };
}

export async function importOpeningStock(ctx: Context, input: ImportOpeningStockInput): Promise<OpeningImportResult> {
  assertOpeningInputSize(input);
  await assertOpeningCurrency(ctx);
  const year = await assertOpeningYear(ctx, input.fiscalYearId);
  assertOpeningOps(
    ctx,
    'inventory.import_opening_stock',
    [
      [StockEntry, 'create'],
      [StockEntry, 'submit'],
      [StockEntryLine, 'create'],
      [Product, 'read'],
      [Warehouse, 'read'],
    ],
    roleAllowsEntry(ctx.roles, 'receipt', false) ? [] : ['stock_entry:receipt'],
  );
  // D-16: a missing default warehouse would fail every row with a blank warehouse code — refuse the request instead.
  const fallback = input.rows.some((r) => readOpeningCode('warehouseCode', r.warehouseCode) === undefined)
    ? await resolveDefaultWarehouse(ctx)
    : null;
  // AC-23 / D-14: takes INVENTORY_SERIES_LOCK (before the stock_exists query) and refuses a closed valuation.
  await assertInventoryDate(ctx, year.openingDate);
  const cells = input.rows.map((r) => ({
    warehouse: readOpeningCode('warehouseCode', r.warehouseCode),
    product: readOpeningCode('productCode', r.productCode),
  }));
  const text = (v: unknown): v is string => typeof v === 'string';
  const products = await lookupByCode(ctx, Product, 'productCode', cells.map((c) => c.product).filter(text), {
    byName: true,
  });
  const warehouses = await lookupByCode(ctx, Warehouse, 'warehouseCode', cells.map((c) => c.warehouse).filter(text), {
    normalize: upper,
  });
  const productIds = [...products.values()].flatMap((p) => (p.ok ? [p.row.id] : []));
  const moved = await movedPairs(ctx, productIds, year.openingDate);
  const seen = new Set<string>();
  const rows: OpeningRowResult[] = [];
  const accepted: StockRow[] = [];
  for (const [index, raw] of input.rows.entries()) {
    const line = index + 1;
    const { warehouse: wCell, product: pCell } = cells[index] ?? {};
    const quantity = readOpeningQuantity(raw.quantity);
    const unitCost = readOpeningUnitCost(raw.unitCost);
    const messages: OpeningMessage[] = [wCell, pCell, quantity, unitCost].filter(isOpeningMessage);
    if (pCell === undefined) messages.push(openingFieldMessage('productCode', 'ref_not_found', 'productCode is blank'));
    const product = typeof pCell === 'string' ? products.get(pCell) : undefined;
    if (product && !product.ok) messages.push(product.message);
    const found = typeof wCell === 'string' ? warehouses.get(wCell) : undefined;
    if (found && !found.ok) messages.push(found.message);
    const warehouse = found?.ok ? found.row : wCell === undefined ? fallback : null;
    if (product?.ok && product.row.kind === 'service')
      messages.push(
        openingFieldMessage(
          'productCode',
          'service_product',
          `${product.row.code ?? product.row.name} is a service; only goods have stock`,
        ),
      );
    if (messages.length === 0 && product?.ok && warehouse) {
      const key = keyOf(product.row.id, warehouse.id);
      if (seen.has(key))
        messages.push(
          openingFieldMessage(
            'productCode',
            'duplicate',
            `${product.row.code ?? product.row.name} in ${warehouse.code} appears more than once in the file`,
            'Write one row per product and warehouse.',
          ),
        );
      else if (moved.has(key))
        messages.push(
          openingFieldMessage(
            'productCode',
            'stock_exists',
            `${product.row.code ?? product.row.name} in ${warehouse.code} already has stock or movements after the opening date`,
            'Opening stock goes in before any movement; a later backdated receipt would not re-cost the issues already posted.',
          ),
        );
      seen.add(key);
    }
    if (messages.length > 0 || !product?.ok || !warehouse || isOpeningMessage(quantity) || isOpeningMessage(unitCost)) {
      rows.push(rowResult(line, 'error', messages));
      continue;
    }
    accepted.push({
      line,
      product: { id: product.row.id, code: product.row.code },
      warehouse,
      quantity,
      unitCost,
    });
    rows.push(rowResult(line, 'ok'));
  }
  const errors = rows.some((r) => r.status === 'error');
  const { committed, value } = await runOpeningImport(ctx, input.mode, async (scope) => {
    const issues: OpeningMessage[] = [];
    const documents: OpeningDocument[] = [];
    const byWarehouse = new Map<string, StockRow[]>();
    for (const r of accepted) byWarehouse.set(r.warehouse.id, [...(byWarehouse.get(r.warehouse.id) ?? []), r]);
    for (const lines of byWarehouse.values()) {
      const warehouse = (lines[0] as StockRow).warehouse;
      for (let i = 0; i < lines.length; i += OPENING_STOCK_LINES_PER_ENTRY) {
        const chunk = lines.slice(i, i + OPENING_STOCK_LINES_PER_ENTRY);
        const posted = await attemptOpeningUnit(scope, (sp) => createReceipt(sp, year, warehouse, chunk));
        if (posted.ok) documents.push(posted.value);
        else
          issues.push(
            ...posted.messages.map((m) => ({
              ...m,
              code: 'submit_failed',
              message: `${warehouse.code} receipt ${i / OPENING_STOCK_LINES_PER_ENTRY + 1} (rows ${chunk[0]?.line}–${chunk.at(-1)?.line}): ${m.code}: ${m.message}`,
            })),
          );
      }
    }
    const failed = errors || issues.length > 0;
    // AC-4 / D-14: these receipts post no journal line, so the year is checked again under the period lock that
    // fiscal_year creation takes (held to commit): a concurrently opened earlier year refuses here, or waits and its
    // before_create hook (hooks/opening-year.ts) then sees the committed receipts.
    if (input.mode === 'execute' && !failed && documents.length > 0)
      await assertOpeningYearLocked(scope, year.fiscalYear.id);
    return { failed, issues, documents };
  });
  const quantity = Decimal.sum(accepted.map((r) => r.quantity));
  const total = Decimal.sum(accepted.map((r) => round6(r.quantity.times(r.unitCost))));
  return {
    mode: input.mode,
    committed,
    ...openingYearJson(year),
    summary: summarizeOpeningRows(rows),
    totals: { quantity: quantity.toString(), value: total.toString() },
    issues: value.issues,
    notices: [],
    rows,
    documents: committed ? value.documents : [],
  };
}

export const importOpeningStockAction = defineAction({
  name: 'inventory.import_opening_stock',
  description: label(
    '期首在庫（品目 × 倉庫ごとの数量と単価）を、期首残高日付・会計年度に紐づく入庫として取り込みます（行: warehouseCode?, productCode, quantity, unitCost。最大 2,000 行・2 MB）。単価が移動平均の最初の取得原価になります。仕訳は作りません。既に在庫・移動がある品目 × 倉庫は stock_exists。mode: dry-run は確認だけ。全件か無か。入庫できるロール（在庫・購買・管理者）も必要。',
    'Import opening stock (quantity and unit cost per product × warehouse) as receipts dated the opening date and linked to the fiscal year (rows: warehouseCode?, productCode, quantity, unitCost; at most 2,000 rows / 2 MB). The unit cost becomes the first moving-average cost. No journal entry. A product × warehouse that already has stock or movements is stock_exists. mode dry-run checks only. All or nothing. Also needs a role that receives stock (inventory, purchasing or admin).',
  ),
  input: importOpeningStockInput,
  output: openingImportResult,
  permission: { roles: OPENING_ROLES },
  inputBytes: OPENING_INPUT_BYTES,
  handler: (ctx, input) => importOpeningStock(ctx, input),
});
