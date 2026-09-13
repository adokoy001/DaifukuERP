// Posting port of the module (docs/specs/inventory.md AC-3/AC-4): one movement = one appended stock_ledger row + the
// stock_balance row of that product × warehouse, both in the caller's context and transaction, inside `asModule` (the only
// place hooks/guard.ts lets them be written). The cost arithmetic is the pure services/moving-average.ts.
// Concurrency: the balance update is pinned to the version read here (Conflict if another transaction moved it first),
// a first balance row is protected by the (productId, warehouseId) unique key, the ledger row by (productId, warehouseId, seq).
import {
  can,
  repo,
  StateError,
  type Context,
  type Decimal,
  type Infer,
  type ListQuery,
  type LocalDate,
} from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { StockBalance } from './entities/stock-balance.ts';
import { StockLedger } from './entities/stock-ledger.ts';
import { Warehouse } from './entities/warehouse.ts';
import {
  emptyState,
  inbound,
  outbound,
  type InboundCost,
  type Movement,
  type OutboundCost,
  type StockState,
} from './services/moving-average.ts';
import { assertInventoryDate } from './period-close.ts';
import { asModule } from './system-write.ts';

export type BalanceRow = Infer<typeof StockBalance>;
export type LedgerRow = Infer<typeof StockLedger>;

export interface StockKey {
  productId: string;
  warehouseId: string;
}

export interface PostingMeta {
  date: LocalDate;
  sourceEntity: string;
  sourceId: string;
  reversal: boolean;
  allowNegative: boolean;
}

export type MovementSpec =
  { kind: 'in'; qty: Decimal; cost: InboundCost } | { kind: 'out'; qty: Decimal; cost: OutboundCost };

export const NEGATIVE_STOCK_HINT =
  'Receive the goods first (or reduce the quantity), or set inventory.allow_negative_stock to true.';

export async function loadBalance(ctx: Context, key: StockKey): Promise<BalanceRow | null> {
  const res = await repo(ctx, StockBalance).list({
    where: { productId: key.productId, warehouseId: key.warehouseId },
    limit: 1,
  });
  return res.items[0] ?? null;
}

export function stateOf(balance: Pick<BalanceRow, 'qty' | 'value' | 'avgCost'> | null): StockState {
  return balance ? { qty: balance.qty, value: balance.value, avgCost: balance.avgCost } : emptyState();
}

/** Every row of a list query, page by page (repo.list caps a page at 500), up to `max` rows. */
export async function listAll<T>(
  fetch: (q: ListQuery) => Promise<{ items: T[]; total: number }>,
  query: ListQuery,
  max: number,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let offset = 0; ;) {
    const page = await fetch({ ...query, limit: 500, offset });
    items.push(...page.items);
    offset += page.items.length;
    if (items.length > max) return { items: items.slice(0, max), truncated: true };
    if (page.items.length === 0 || offset >= page.total) return { items, truncated: false };
  }
}

/** Product code and warehouse code for messages; ids when the caller may not read them. */
export async function keyLabel(ctx: Context, key: StockKey): Promise<{ product: string; warehouse: string }> {
  const product = can(ctx, Product, 'read') ? await repo(ctx, Product).find(key.productId) : null;
  const warehouse = can(ctx, Warehouse, 'read') ? await repo(ctx, Warehouse).find(key.warehouseId) : null;
  return {
    product: product ? (product.code ?? product.name) : key.productId,
    warehouse: warehouse ? warehouse.code : key.warehouseId,
  };
}

async function negativeStockError(
  ctx: Context,
  key: StockKey,
  before: StockState,
  qty: Decimal,
  meta: PostingMeta,
): Promise<StateError> {
  const names = await keyLabel(ctx, key);
  return new StateError(
    `insufficient stock of product ${names.product} in warehouse ${names.warehouse}: available ${before.qty.toString()}, requested ${qty.toString()}`,
    `Available quantity is ${before.qty.toString()}. ${NEGATIVE_STOCK_HINT}`,
    {
      ...key,
      available: before.qty.toString(),
      requested: qty.toString(),
      sourceEntity: meta.sourceEntity,
      sourceId: meta.sourceId,
      reversal: meta.reversal,
    },
  );
}

/** Appends one ledger row and moves the balance (AC-3). Outbound movements below zero are refused unless allowed. */
export async function postMovement(
  ctx: Context,
  key: StockKey,
  spec: MovementSpec,
  meta: PostingMeta,
): Promise<{ row: LedgerRow; movement: Movement }> {
  await assertInventoryDate(ctx, meta.date);
  const latest = (
    await repo(ctx, StockLedger).list({ where: { ...key }, orderBy: [{ field: 'seq', dir: 'desc' }], limit: 1 })
  ).items[0];
  if (latest && meta.date < latest.date)
    throw new StateError(
      `Inventory already contains a movement dated ${latest.date}`,
      'Backdated moving-average reposting is not supported; use a correction date on or after the latest movement.',
    );
  const balance = await loadBalance(ctx, key);
  const before = stateOf(balance);
  const m = spec.kind === 'in' ? inbound(before, spec.qty, spec.cost) : outbound(before, spec.qty, spec.cost);
  if (spec.kind === 'out' && !meta.allowNegative && m.after.qty.lt(0))
    throw await negativeStockError(ctx, key, before, spec.qty, meta);
  const seq = (balance?.lastSeq ?? 0) + 1;
  return asModule(ctx, async (ctx) => {
    const row = await repo(ctx, StockLedger).create({
      date: meta.date,
      warehouseId: key.warehouseId,
      productId: key.productId,
      qtyDelta: m.qtyDelta,
      unitCost: m.unitCost,
      costDelta: m.costDelta,
      balanceQty: m.after.qty,
      balanceCost: m.after.value,
      sourceEntity: meta.sourceEntity,
      sourceId: meta.sourceId,
      seq,
      reversal: meta.reversal,
    });
    const values = { qty: m.after.qty, avgCost: m.after.avgCost, value: m.after.value, lastSeq: seq };
    if (balance) await repo(ctx, StockBalance).update(balance.id, values, { expectedVersion: balance.version });
    else await repo(ctx, StockBalance).create({ ...key, ...values });
    return { row, movement: m };
  });
}

/** The original (non-reversal) ledger rows of a source, newest first per product × warehouse. */
export async function sourceRows(ctx: Context, sourceEntity: string, sourceId: string): Promise<LedgerRow[]> {
  const { items, truncated } = await listAll(
    (q) => repo(ctx, StockLedger).list(q),
    { where: { sourceEntity, sourceId, reversal: false }, orderBy: [{ field: 'seq', dir: 'desc' }] },
    5000,
  );
  if (truncated)
    throw new StateError(
      'Source inventory movements exceed the supported reversal limit',
      'No partial reversal is permitted.',
    );
  return items;
}

/**
 * AC-4: appends the reverse of every original row of the source (same date, so as-of reports see neither) — an inbound
 * row is taken back at its own cost and the average recomputed, an outbound row is returned at its own cost.
 */
export async function reverseSource(
  ctx: Context,
  sourceEntity: string,
  sourceId: string,
  allowNegative: boolean,
  correctionDate?: LocalDate,
): Promise<LedgerRow[]> {
  const out: LedgerRow[] = [];
  for (const row of await sourceRows(ctx, sourceEntity, sourceId)) {
    const spec: MovementSpec = row.qtyDelta.gt(0)
      ? { kind: 'out', qty: row.qtyDelta, cost: { mode: 'cost', totalCost: row.costDelta } }
      : { kind: 'in', qty: row.qtyDelta.neg(), cost: { totalCost: row.costDelta.neg() } };
    const posted = await postMovement(ctx, { productId: row.productId, warehouseId: row.warehouseId }, spec, {
      date: correctionDate ?? row.date,
      sourceEntity,
      sourceId,
      reversal: true,
      allowNegative,
    });
    out.push(posted.row);
  }
  return out;
}
