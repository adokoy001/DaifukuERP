// stock_entry before_submit (docs/specs/inventory.md AC-2/AC-3): in the submitting user's context and transaction —
//   1. the roles must cover the type (AC-9);
//   2. the header and every line are re-validated (entryIssues: warehouse / destination, ≥ 1 line, goods products,
//      quantity, sign, inbound unitCost) and a source link, when present, must point at a submitted source document;
//   3. lines are posted in seq order through src/ledger.ts (moving average): receipt / adjustment in at the line's unit
//      cost; issue / adjustment out at the moving average; transfer = out of `warehouseId` at the average, into
//      `toWarehouseId` at exactly the cost that left (value is conserved);
//   4. outbound and transfer lines get unitCost = the average they were issued at and amount = the posted cost.
// Any failure (validation, insufficient stock, concurrent balance change) leaves the entry a draft and nothing posted.
import { Decimal, DOCSTATUS, registry, repo, StateError, ValidationError, type Context, type EntityDef, type HookArgs, type Infer, type LocalDate } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { assertInventoryDate } from '../period-close.ts';
import { StockEntry, type StockEntryType } from '../entities/stock-entry.ts';
import { StockEntryLine } from '../entities/stock-entry-line.ts';
import { listAll, postMovement, type PostingMeta } from '../ledger.ts';
import { entryIssues, lineDirection, type EntryHead, type EntryLineInput, type ProductKind } from '../services/entry-rules.ts';
import { round6 } from '../services/moving-average.ts';
import { allowNegativeStock } from '../settings.ts';
import { registeredStockSource } from '../source-documents.ts';
import { asModule } from '../system-write.ts';
import { assertEntryRole } from './entry.ts';

type EntryLineRow = Infer<typeof StockEntryLine>;

export const SUBMIT_HINT = 'Fix the entry (see details.issues), then submit again.';
export const SOURCE_HINT = 'Stock entries linked to a source are created by the source document; submit or cancel that document instead.';

/** Source documents this module links stock entries to (hooks/invoices.ts, hooks/count.ts). */
export const SOURCE_ENTITIES = ['purchase_invoice', 'sales_invoice', 'stock_count'] as const;

export async function loadEntryLines(ctx: Context, entryId: string): Promise<EntryLineRow[]> {
  const result = await listAll((q) => repo(ctx, StockEntryLine).list(q), { where: { entryId }, orderBy: [{ field: 'seq', dir: 'asc' }] }, 500);
  if (result.truncated) throw new ValidationError('Document exceeds the supported line count', [{ path: 'lines', message: 'at most 500 lines' }]);
  return result.items;
}

export async function productKinds(ctx: Context, ids: readonly string[]): Promise<Map<string, ProductKind>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, ProductKind>();
  for (let i = 0; i < unique.length; i += 200) {
    const page = await repo(ctx, Product).list({ where: { id: { $in: unique.slice(i, i + 200) } }, limit: 200 });
    for (const p of page.items) out.set(p.id, p.kind);
  }
  return out;
}

/** A linked entry must belong to a submitted source document (the auto path creates it in the source's after_submit). */
async function assertSourceLink(ctx: Context, row: Record<string, unknown>): Promise<void> {
  const entity = row.sourceEntity;
  const id = row.sourceId;
  if ((entity === null || entity === undefined) && (id === null || id === undefined)) return;
  const known = typeof entity === 'string' && ((SOURCE_ENTITIES as readonly string[]).includes(entity) || registeredStockSource(entity)) && registry.hasEntity(entity);
  const source = known && typeof id === 'string' ? await repo(ctx, registry.entity(entity) as EntityDef).find(id) : null;
  if (!source || source.docstatus !== DOCSTATUS.submitted) {
    throw new StateError(`stock_entry ${String(row.id)}: source ${String(entity)} ${String(id)} is not a submitted document`, SOURCE_HINT, { sourceEntity: entity, sourceId: id });
  }
}

interface PostedLine {
  unitCost: Decimal;
  amount: Decimal;
}

async function postLine(ctx: Context, head: EntryHead & { id: string; date: LocalDate }, line: EntryLineInput, allowNegative: boolean): Promise<PostedLine> {
  const meta: PostingMeta = { date: head.date, sourceEntity: StockEntry.name, sourceId: head.id, reversal: false, allowNegative };
  const from = { productId: line.productId, warehouseId: head.warehouseId ?? '' };
  const direction = lineDirection(head.type, line.sign);
  if (direction === 'in') {
    // the line keeps quantity × unitCost; the ledger row carries the value change (they differ only when stock was negative)
    const unitCost = line.unitCost ?? Decimal.zero();
    await postMovement(ctx, from, { kind: 'in', qty: line.quantity, cost: { unitCost } }, meta);
    return { unitCost, amount: round6(line.quantity.times(unitCost)) };
  }
  const out = await postMovement(ctx, from, { kind: 'out', qty: line.quantity, cost: { mode: 'average' } }, meta);
  const cost = out.movement.costDelta.neg();
  if (direction === 'transfer') {
    const to = { productId: line.productId, warehouseId: head.toWarehouseId ?? '' };
    await postMovement(ctx, to, { kind: 'in', qty: line.quantity, cost: { totalCost: cost } }, meta);
  }
  return { unitCost: out.movement.unitCost, amount: cost };
}

function headOf(row: Record<string, unknown>): EntryHead & { id: string; date: LocalDate } {
  return {
    id: row.id as string,
    type: row.type as StockEntryType,
    date: row.date as LocalDate,
    warehouseId: typeof row.warehouseId === 'string' ? row.warehouseId : null,
    toWarehouseId: typeof row.toWarehouseId === 'string' ? row.toWarehouseId : null,
  };
}

function lineInputOf(l: EntryLineRow): EntryLineInput {
  return { seq: l.seq, productId: l.productId, quantity: l.quantity, sign: l.sign, unitCost: l.unitCost };
}

async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  assertEntryRole(ctx, row.type, 'submit');
  const head = headOf(row);
  await assertInventoryDate(ctx, head.date);
  const lines = await loadEntryLines(ctx, head.id);
  const kinds = await productKinds(
    ctx,
    lines.map((l) => l.productId),
  );
  const issues = entryIssues(head, lines.map(lineInputOf), kinds);
  if (issues.length > 0) throw new ValidationError(`stock_entry ${head.id} cannot be submitted`, issues, SUBMIT_HINT);
  await assertSourceLink(ctx, row);
  const allowNegative = await allowNegativeStock(ctx);
  for (const line of lines) {
    const posted = await postLine(ctx, head, lineInputOf(line), allowNegative);
    const unchanged = line.unitCost !== null && line.unitCost.eq(posted.unitCost) && line.amount.eq(posted.amount);
    if (!unchanged) await asModule(ctx, (ctx) => repo(ctx, StockEntryLine).update(line.id, { unitCost: posted.unitCost, amount: posted.amount }));
  }
}

export function registerSubmitHook(): void {
  registry.registerHook(StockEntry.name, 'before_submit', beforeSubmit);
}
