// stock_entry_line hooks (docs/specs/inventory.md AC-2, AC-9).
// before_validate (direct callers): the parent must be a draft and its type covered by the caller's roles; the line must
//   pass the per-line rules against the parent type (goods product, quantity > 0 with ≤ 6 decimals, sign only and always
//   on adjustments, unitCost ≥ 0 required on inbound lines). Outbound lines drop any unitCost (costed at submit) and
//   `amount` is always quantity × unitCost (0 while unknown). A service product is a VALIDATION with a hint.
// When this module writes (submit fills unitCost/amount of outbound lines; auto entries create their lines) the parent
//   and the rules were already checked, so only a missing amount is derived.
// before_delete: same parent/role rule (the kernel's replace-all only guards the saveLines path).
import {
  DOCSTATUS,
  isUuid,
  registry,
  repo,
  StateError,
  ValidationError,
  type Context,
  type HookArgs,
  type Infer,
} from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { StockEntry } from '../entities/stock-entry.ts';
import { LINE_SIGNS, StockEntryLine, type LineSign } from '../entities/stock-entry-line.ts';
import { lineIssues, needsUnitCost, tryDecimal, type ProductKind } from '../services/entry-rules.ts';
import { round6 } from '../services/moving-average.ts';
import { isModuleWrite } from '../system-write.ts';
import { assertEntryRole } from './entry.ts';

type Raw = Record<string, unknown>;
type EntryRow = Infer<typeof StockEntry>;

export const FROZEN_HINT =
  'Cancel the stock entry (reverse rows are appended) and amend it to change its lines (ADR-0006).';
export const SERVICE_HINT =
  'Only goods products have stock. Use a product with kind goods (services are skipped by the invoice hooks).';

function merged(row: Raw, previous: Raw | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}

async function loadParent(ctx: Context, entryId: unknown): Promise<EntryRow | null> {
  if (typeof entryId !== 'string' || !isUuid(entryId)) return null; // zod / FK report it
  return repo(ctx, StockEntry).find(entryId);
}

async function assertEditableParent(ctx: Context, entryId: unknown, op: string): Promise<EntryRow | null> {
  const parent = await loadParent(ctx, entryId);
  if (!parent) return null;
  if (parent.docstatus !== DOCSTATUS.draft) {
    throw new StateError(
      `stock_entry ${parent.number ?? parent.id} is not a draft; its lines are frozen`,
      FROZEN_HINT,
      { entryId: parent.id, docstatus: parent.docstatus },
    );
  }
  assertEntryRole(ctx, parent.type, op);
  return parent;
}

function signOf(v: unknown): LineSign | null {
  return typeof v === 'string' && (LINE_SIGNS as readonly string[]).includes(v) ? (v as LineSign) : null;
}

function setAmount(row: Raw, previous: Raw | undefined): void {
  const quantity = tryDecimal(merged(row, previous, 'quantity'));
  const unitCost = tryDecimal(merged(row, previous, 'unitCost'));
  if (!quantity) return; // zod reports it
  row.amount = unitCost ? round6(quantity.times(unitCost)) : '0';
}

async function productKind(ctx: Context, productId: string): Promise<ProductKind | undefined> {
  const product = await repo(ctx, Product).find(productId);
  return product?.kind;
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (isModuleWrite(ctx)) {
    if (row.amount === undefined) setAmount(row, previous);
    return;
  }
  const parent = await assertEditableParent(ctx, merged(row, previous, 'entryId'), previous ? 'update' : 'create');
  if (previous && row.entryId !== undefined && row.entryId !== previous.entryId)
    await assertEditableParent(ctx, previous.entryId, 'update');
  const productId = merged(row, previous, 'productId');
  const quantity = tryDecimal(merged(row, previous, 'quantity'));
  if (!parent || typeof productId !== 'string' || !isUuid(productId) || !quantity) return; // zod / FK report the shape
  const sign = merged(row, previous, 'sign') ?? null;
  if (sign !== null && signOf(sign) === null) return; // zod reports the invalid enum
  if (!needsUnitCost(parent.type, signOf(sign))) row.unitCost = null;
  const unitCost = tryDecimal(merged(row, previous, 'unitCost'));
  const kind = await productKind(ctx, productId);
  const issues = lineIssues(parent.type, { seq: 0, productId, quantity, sign: signOf(sign), unitCost }, kind, '');
  if (issues.length > 0) {
    const service = kind === 'service';
    throw new ValidationError(
      `stock_entry_line: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      issues,
      service ? SERVICE_HINT : 'Fix the line (see details.issues) against the entry type.',
    );
  }
  setAmount(row, previous);
}

async function beforeDelete(ctx: Context, { row }: HookArgs): Promise<void> {
  if (isModuleWrite(ctx)) return;
  await assertEditableParent(ctx, row.entryId, 'update');
}

export function registerLineHooks(): void {
  registry.registerHook(StockEntryLine.name, 'before_validate', beforeValidate);
  registry.registerHook(StockEntryLine.name, 'before_delete', beforeDelete);
}
