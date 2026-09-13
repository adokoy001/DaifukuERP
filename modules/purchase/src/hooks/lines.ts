// purchase_invoice_line hooks (docs/specs/purchase.md AC-1):
//   before_validate  productId or accountId required; description / unitPrice / taxCategory default from the product
//                    (or the account's taxCategoryDefault); amount = quantity × unitPrice.
//   before_create/update/delete  the parent must be a draft (the kernel freezes only the saveLines path, ADR-0006).
//   after_create/update/delete   direct line writes only: re-save the parent so hooks/recalc.ts recomputes the totals. Inside
//                                the kernel's saveLines they are no-ops; the bill's after_lines_saved hook re-saves it once
//                                per save instead of once per line (kernel-phase15 AC-7).
import {
  DOCSTATUS,
  Decimal,
  StateError,
  ValidationError,
  isDecimal,
  isSavingLines,
  registry,
  repo,
  type Context,
  type HookArgs,
  type Infer,
} from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { Product, fillLineUom } from '@daifuku/mod-product';
import { PurchaseInvoice } from '../entities/purchase-invoice.ts';
import { PurchaseInvoiceLine } from '../entities/purchase-invoice-line.ts';
import { lineAmount } from '../services/recalculate.ts';
import { recalculateInvoice } from './recalc.ts';

type Raw = Record<string, unknown>;
type InvoiceRow = Infer<typeof PurchaseInvoice>;

export const LINE_SOURCE_HINT =
  'Set productId (a product line, posted to the purchases account) or accountId (an expense line).';

function present(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function merged(draft: Raw, previous: Raw | undefined, key: string): unknown {
  return draft[key] !== undefined ? draft[key] : previous?.[key];
}

function decimalish(v: unknown): v is Decimal | string {
  return isDecimal(v) || (typeof v === 'string' && Decimal.isDecimalString(v));
}

async function onLineValidate(ctx: Context, { row: draft, previous }: HookArgs): Promise<void> {
  await fillLineUom(ctx, { row: draft, previous });
  const productId = merged(draft, previous, 'productId');
  const accountId = merged(draft, previous, 'accountId');
  if (!present(productId) && !present(accountId)) {
    throw new ValidationError(
      'purchase_invoice_line: productId or accountId is required',
      [{ path: 'accountId', message: 'productId or accountId is required' }],
      LINE_SOURCE_HINT,
    );
  }
  const product = present(productId) ? await repo(ctx, Product).find(productId) : null;
  const account = present(accountId) ? await repo(ctx, Account).find(accountId) : null;
  if (present(productId) && !product)
    throw new ValidationError(
      `product ${productId} does not exist`,
      [{ path: 'productId', message: 'product not found' }],
      'Pass the id of an existing product (see product.list).',
    );
  if (present(accountId) && !account)
    throw new ValidationError(
      `account ${accountId} does not exist`,
      [{ path: 'accountId', message: 'account not found' }],
      'Pass the id of an existing account (see account.list).',
    );
  if (!previous && product) {
    if (draft.description === undefined || draft.description === null) draft.description = product.name;
    if ((draft.unitPrice === undefined || draft.unitPrice === null) && product.purchasePrice !== null)
      draft.unitPrice = product.purchasePrice;
  }
  const sourceChanged = !previous || 'productId' in draft || 'accountId' in draft;
  if ((draft.taxCategory === undefined || draft.taxCategory === null) && sourceChanged) {
    const category = product?.taxCategory ?? account?.taxCategoryDefault ?? null;
    if (category) draft.taxCategory = category;
    else if (!previous || draft.taxCategory === null) {
      throw new ValidationError(
        'purchase_invoice_line.taxCategory is required (the product/account has no default)',
        [{ path: 'taxCategory', message: 'required' }],
        'Pass taxCategory, or set taxCategoryDefault on the account.',
      );
    }
  }
  const quantity = merged(draft, previous, 'quantity') ?? '1';
  const unitPrice = merged(draft, previous, 'unitPrice');
  if (decimalish(quantity) && decimalish(unitPrice)) draft.amount = lineAmount(quantity, unitPrice);
}

async function loadParent(ctx: Context, invoiceId: unknown): Promise<InvoiceRow | null> {
  if (!present(invoiceId)) return null;
  return repo(ctx, PurchaseInvoice).find(invoiceId);
}

async function assertParentDraft(ctx: Context, invoiceId: unknown): Promise<void> {
  const parent = await loadParent(ctx, invoiceId);
  if (!parent || parent.docstatus === DOCSTATUS.draft) return;
  throw new StateError(
    `purchase_invoice ${parent.number ?? parent.id} is not a draft; its lines are frozen`,
    'Cancel the bill and amend it to change its lines (ADR-0006).',
    { invoiceId: parent.id, docstatus: parent.docstatus },
  );
}

async function recalcParents(ctx: Context, ...ids: unknown[]): Promise<void> {
  for (const id of new Set(ids.filter(present))) {
    if (isSavingLines(ctx, PurchaseInvoice.name, id)) continue; // after_lines_saved recalculates once (hooks/recalc.ts)
    await recalculateInvoice(ctx, id);
  }
}

export function registerLineHooks(): void {
  registry.registerHook(PurchaseInvoiceLine.name, 'before_validate', onLineValidate);
  registry.registerHook(PurchaseInvoiceLine.name, 'before_create', (ctx, { row }) =>
    assertParentDraft(ctx, row.invoiceId),
  );
  registry.registerHook(PurchaseInvoiceLine.name, 'before_update', async (ctx, { row, previous }) => {
    await assertParentDraft(ctx, previous?.invoiceId);
    if (row.invoiceId !== previous?.invoiceId) await assertParentDraft(ctx, row.invoiceId);
  });
  registry.registerHook(PurchaseInvoiceLine.name, 'before_delete', (ctx, { row }) =>
    assertParentDraft(ctx, row.invoiceId),
  );
  registry.registerHook(PurchaseInvoiceLine.name, 'after_create', (ctx, { row }) => recalcParents(ctx, row.invoiceId));
  registry.registerHook(PurchaseInvoiceLine.name, 'after_update', (ctx, { row, previous }) =>
    recalcParents(ctx, row.invoiceId, previous?.invoiceId),
  );
  registry.registerHook(PurchaseInvoiceLine.name, 'after_delete', (ctx, { row }) => recalcParents(ctx, row.invoiceId));
}
