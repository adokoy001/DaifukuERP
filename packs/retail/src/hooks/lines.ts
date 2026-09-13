// retail_closing_line hooks (docs/specs/pack-retail.md AC-2).
// before_validate: the parent must be a draft; unitPrice (tax-inclusive) and taxCategory come from the product when the
//   caller leaves them empty; quantity must not be 0 (negative = return); amount = quantity × unitPrice.
// before_delete: the parent must be a draft (direct writes; the kernel guards only the replace-all path).
// after_create/update/delete: a DIRECT line write touches the header so its before_update re-derives the totals. Inside the
//   kernel's saveLines they are no-ops; the header's after_lines_saved touches once (hooks/recalc.ts, ADR-0014).
import {
  DOCSTATUS,
  isSavingLines,
  isUuid,
  registry,
  repo,
  StateError,
  ValidationError,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { tryDecimal } from '@daifuku/mod-sales';
import { RetailClosingLine } from '../entities/retail-closing-line.ts';
import { RetailClosing } from '../entities/retail-closing.ts';
import { lineAmount } from '../services/closing-totals.ts';

type Raw = Record<string, unknown>;

export const FROZEN_HINT =
  'Cancel the register closing (its invoice and cash receipt are cancelled too) and amend it to change the lines.';

function merged(row: Raw, previous: Raw | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}

async function assertParentDraft(ctx: Context, closingId: unknown): Promise<void> {
  if (typeof closingId !== 'string' || !isUuid(closingId)) return; // zod / FK report it
  const parent = await repo(ctx, RetailClosing).find(closingId);
  if (parent && parent.docstatus !== DOCSTATUS.draft) {
    throw new StateError(
      `retail_closing ${parent.number ?? parent.id} is not a draft; its lines are frozen`,
      FROZEN_HINT,
      { closingId: parent.id, docstatus: parent.docstatus },
    );
  }
}

/** On create a missing value is undefined or null; on update only an explicit null asks for the product default. */
function wantsDefault(row: Raw, key: string, isCreate: boolean): boolean {
  return row[key] === null || (isCreate && row[key] === undefined);
}

async function applyProductDefaults(ctx: Context, row: Raw, previous: Raw | undefined): Promise<void> {
  const isCreate = previous === undefined;
  const keys = ['unitPrice', 'taxCategory'].filter((k) => wantsDefault(row, k, isCreate));
  const productId = merged(row, previous, 'productId');
  if (keys.length === 0 || typeof productId !== 'string' || !isUuid(productId)) return;
  const product = await repo(ctx, Product).find(productId);
  if (!product) return; // the FK reports the missing product
  if (keys.includes('taxCategory')) row.taxCategory = product.taxCategory;
  if (!keys.includes('unitPrice')) return;
  if (product.salePrice === null) {
    throw new ValidationError(
      `product ${product.code ?? product.name} has no sale price`,
      [{ path: 'unitPrice', message: 'required: the product has no salePrice' }],
      'Pass the tax-inclusive unitPrice on the line or set salePrice on the product.',
    );
  }
  row.unitPrice = product.salePrice;
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  await assertParentDraft(ctx, merged(row, previous, 'closingId'));
  await applyProductDefaults(ctx, row, previous);
  const quantity = tryDecimal(merged(row, previous, 'quantity'));
  const unitPrice = tryDecimal(merged(row, previous, 'unitPrice'));
  if (quantity?.isZero()) {
    throw new ValidationError(
      'retail_closing_line.quantity must not be 0',
      [{ path: 'quantity', message: 'must not be 0' }],
      'Enter the quantity sold; a return is a negative quantity. Remove the line instead of entering 0.',
    );
  }
  if (quantity && unitPrice) row.amount = lineAmount(quantity, unitPrice);
}

async function touchClosing(ctx: Context, closingId: unknown): Promise<void> {
  if (typeof closingId !== 'string') return;
  if (isSavingLines(ctx, RetailClosing.name, closingId)) return; // after_lines_saved touches once (hooks/recalc.ts)
  const parent = await repo(ctx, RetailClosing).find(closingId);
  if (parent && parent.docstatus === DOCSTATUS.draft) await repo(ctx, RetailClosing).update(closingId, {});
}

export function registerLineHooks(): void {
  registry.registerHook(RetailClosingLine.name, 'before_validate', beforeValidate);
  registry.registerHook(RetailClosingLine.name, 'before_update', async (ctx, { row, previous }) => {
    if (previous && row.closingId !== previous.closingId) await assertParentDraft(ctx, previous.closingId);
  });
  registry.registerHook(RetailClosingLine.name, 'before_delete', (ctx, { row }) =>
    assertParentDraft(ctx, row.closingId),
  );
  registry.registerHook(RetailClosingLine.name, 'after_create', (ctx, { row }) => touchClosing(ctx, row.closingId));
  registry.registerHook(RetailClosingLine.name, 'after_update', async (ctx, { row, previous }) => {
    await touchClosing(ctx, row.closingId);
    if (previous && previous.closingId !== row.closingId) await touchClosing(ctx, previous.closingId);
  });
  registry.registerHook(RetailClosingLine.name, 'after_delete', (ctx, { row }) => touchClosing(ctx, row.closingId));
}
