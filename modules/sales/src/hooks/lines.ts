// sales_invoice_line hooks (spec AC-1/AC-2).
// before_validate: description/unitPrice/taxCategory come from the product when the caller leaves them empty;
//   `amount` is always quantity × unitPrice (the caller never controls it).
// before_create/update/delete: lines of a non-draft invoice are frozen on every path (the kernel only guards
//   the replace-all saveLines path; direct repo writes are covered here, like accounting's freeze-lines).
// after_create/update/delete: for a DIRECT line write (repo / sales_invoice_line.* actions) the header is "touched" (an
//   empty update) so its before_update hook re-derives the totals — one place computes, whichever path wrote the line.
//   Inside the kernel's replace-all saveLines (generic create/update with `lines`, amend) these are no-ops: the header's
//   `after_lines_saved` hook (hooks/recalc.ts) touches it once per save instead of once per line (kernel-phase15 AC-7).
import { DOCSTATUS, isSavingLines, registry, repo, StateError, ValidationError, isUuid, type Context, type HookArgs, type Infer } from '@daifuku/kernel';
import { Product, fillLineUom } from '@daifuku/mod-product';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { SalesInvoiceLine } from '../entities/sales-invoice-line.ts';
import { lineAmount, tryDecimal } from '../services/recalculate.ts';

type Raw = Record<string, unknown>;
type InvoiceRow = Infer<typeof SalesInvoice>;

export const FROZEN_HINT = 'Cancel and amend the invoice to change its lines (ADR-0006).';

function frozenError(parent: InvoiceRow): StateError {
  return new StateError(`sales_invoice ${parent.number ?? parent.id} is not a draft; its lines are frozen`, FROZEN_HINT, { invoiceId: parent.id, docstatus: parent.docstatus });
}

async function assertParentDraft(ctx: Context, invoiceId: unknown): Promise<void> {
  if (typeof invoiceId !== 'string' || !isUuid(invoiceId)) return; // zod / FK report it
  const parent = await repo(ctx, SalesInvoice).find(invoiceId);
  if (parent && parent.docstatus !== DOCSTATUS.draft) throw frozenError(parent);
}

/** On create a missing value is undefined or null; on update only an explicit null asks for the product default. */
function wantsDefault(row: Raw, key: string, isCreate: boolean): boolean {
  return row[key] === null || (isCreate && row[key] === undefined);
}

async function applyProductDefaults(ctx: Context, row: Raw, previous: Raw | undefined): Promise<void> {
  const isCreate = previous === undefined;
  const productId = row.productId ?? previous?.productId;
  if (typeof productId !== 'string' || !isUuid(productId)) return;
  const keys = ['description', 'unitPrice', 'taxCategory'].filter((k) => wantsDefault(row, k, isCreate));
  if (keys.length === 0) return;
  const product = await repo(ctx, Product).find(productId);
  if (!product) return;
  if (keys.includes('description')) row.description = product.name;
  if (keys.includes('taxCategory')) row.taxCategory = product.taxCategory;
  if (keys.includes('unitPrice')) {
    if (product.salePrice === null) {
      throw new ValidationError(`product ${product.code ?? product.name} has no sale price`, [{ path: 'unitPrice', message: 'required: the product has no salePrice' }], 'Pass unitPrice on the line or set salePrice on the product.');
    }
    row.unitPrice = product.salePrice;
  }
}

function applyAmount(row: Raw, previous: Raw | undefined): void {
  const quantity = tryDecimal(row.quantity ?? previous?.quantity ?? '1');
  const unitPrice = tryDecimal(row.unitPrice ?? previous?.unitPrice);
  if (!quantity || !unitPrice) return; // zod reports the invalid/missing value
  row.amount = lineAmount(quantity, unitPrice);
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  await applyProductDefaults(ctx, row, previous);
  await fillLineUom(ctx, { row, previous });
  applyAmount(row, previous);
}

async function touchInvoice(ctx: Context, invoiceId: unknown): Promise<void> {
  if (typeof invoiceId !== 'string') return;
  if (isSavingLines(ctx, SalesInvoice.name, invoiceId)) return; // after_lines_saved recalculates once (hooks/recalc.ts)
  await repo(ctx, SalesInvoice).update(invoiceId, {});
}

export function registerLineHooks(): void {
  registry.registerHook(SalesInvoiceLine.name, 'before_validate', beforeValidate);
  registry.registerHook(SalesInvoiceLine.name, 'before_create', (ctx, { row }) => assertParentDraft(ctx, row.invoiceId));
  registry.registerHook(SalesInvoiceLine.name, 'before_update', async (ctx, { row, previous }) => {
    await assertParentDraft(ctx, previous?.invoiceId);
    if (row.invoiceId !== previous?.invoiceId) await assertParentDraft(ctx, row.invoiceId);
  });
  registry.registerHook(SalesInvoiceLine.name, 'before_delete', (ctx, { row }) => assertParentDraft(ctx, row.invoiceId));
  registry.registerHook(SalesInvoiceLine.name, 'after_create', (ctx, { row }) => touchInvoice(ctx, row.invoiceId));
  registry.registerHook(SalesInvoiceLine.name, 'after_update', async (ctx, { row, previous }) => {
    await touchInvoice(ctx, row.invoiceId);
    if (previous && previous.invoiceId !== row.invoiceId) await touchInvoice(ctx, previous.invoiceId);
  });
  registry.registerHook(SalesInvoiceLine.name, 'after_delete', (ctx, { row }) => touchInvoice(ctx, row.invoiceId));
}
