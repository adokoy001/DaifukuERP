// Hooks on other modules' documents (docs/specs/inventory.md AC-5). inventory depends on purchase/sales, not the reverse.
//   purchase_invoice after_submit: when inventory.auto_receipt_on_purchase, its goods lines are received into the default
//     warehouse (unitCost = 税抜 unit price, services/from-invoice.ts) as a submitted receipt linked by sourceEntity/sourceId.
//   sales_invoice after_submit: when inventory.auto_issue_on_sales, its goods lines are issued from the default warehouse.
//   after_cancel of either: every submitted stock entry linked to it is cancelled (whatever the setting is now).
// No goods line → no stock entry. Everything runs in the invoice submitter's context and transaction: a refused issue
// (insufficient stock) or a missing default warehouse fails the invoice submit, which stays a draft.
// after_* (not before_*): the source is already submitted when the entry checks its link (hooks/submit.ts), and it has its number.
import {
  cancelDocument,
  DOCSTATUS,
  registry,
  repo,
  submitDocument,
  type Context,
  type HookArgs,
  type Infer,
  type LocalDate,
} from '@daifuku/kernel';
import { PurchaseInvoice, PurchaseInvoiceLine } from '@daifuku/mod-purchase';
import { SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { StockEntryLine } from '../entities/stock-entry-line.ts';
import { StockEntry, type StockEntryType } from '../entities/stock-entry.ts';
import { listAll } from '../ledger.ts';
import {
  issueLinesFromSales,
  ratesFromTaxSummary,
  receiptLinesFromPurchase,
  type EntryLineDraft,
} from '../services/from-invoice.ts';
import { autoIssueOnSales, autoReceiptOnPurchase, resolveDefaultWarehouse } from '../settings.ts';
import { hasSeparateStockFulfillment } from '../source-documents.ts';
import { asModule } from '../system-write.ts';
import { productKinds } from './submit.ts';

export type StockEntryRow = Infer<typeof StockEntry>;

export interface LinkedEntryHead {
  type: StockEntryType;
  date: LocalDate;
  warehouseId: string;
  partnerId?: string | null;
  note?: string | null;
  sourceEntity: string;
  sourceId: string;
}

/**
 * Creates, fills and submits a stock entry as this module (the caller's roles still need the role-table ops). Lines are
 * created one by one rather than through the kernel's saveLines, which requires `update` on the parent document — a
 * grant the sales role does not otherwise need on stock_entry.
 */
export async function createAndSubmitEntry(
  ctx: Context,
  head: LinkedEntryHead,
  lines: readonly (EntryLineDraft & { sign?: 'in' | 'out' })[],
): Promise<StockEntryRow> {
  return asModule(ctx, async (ctx) => {
    const created = await repo(ctx, StockEntry).create({ ...head });
    for (const [i, line] of lines.entries())
      await repo(ctx, StockEntryLine).create({ ...line, entryId: created.id, seq: i + 1 });
    return submitDocument(ctx, StockEntry, created.id);
  });
}

/** Cancels the submitted stock entries linked to a source document (AC-5 cancel, AC-6 count cancel). */
export async function cancelLinkedEntries(
  ctx: Context,
  sourceEntity: string,
  sourceId: string,
  correctionDate?: LocalDate,
): Promise<string[]> {
  const linked = await repo(ctx, StockEntry).list({
    where: { sourceEntity, sourceId, docstatus: DOCSTATUS.submitted },
    limit: 500,
  });
  for (const e of linked.items)
    await asModule(ctx, (ctx) => cancelDocument(ctx, StockEntry, e.id, correctionDate ? { correctionDate } : {}));
  return linked.items.map((e) => e.id);
}

function kindsFor(ctx: Context, lines: readonly { productId: string | null }[]) {
  return productKinds(
    ctx,
    lines.flatMap((l) => (l.productId ? [l.productId] : [])),
  );
}

async function onPurchaseSubmitted(ctx: Context, { row }: HookArgs): Promise<void> {
  if (await hasSeparateStockFulfillment(ctx, PurchaseInvoice.name, row)) return;
  if (!(await autoReceiptOnPurchase(ctx))) return;
  const id = row.id as string;
  const { items } = await listAll(
    (q) => repo(ctx, PurchaseInvoiceLine).list(q),
    { where: { invoiceId: id }, orderBy: [{ field: 'seq', dir: 'asc' }] },
    5000,
  );
  const lines = receiptLinesFromPurchase(items, await kindsFor(ctx, items), {
    priceIncludesTax: row.priceIncludesTax === true,
    rates: ratesFromTaxSummary(row.taxSummary),
  });
  if (lines.length === 0) return;
  const warehouse = await resolveDefaultWarehouse(ctx);
  const head = {
    type: 'receipt' as const,
    date: row.date as LocalDate,
    warehouseId: warehouse.id,
    partnerId: row.partnerId as string,
    note: `仕入請求書 ${String(row.number)}`,
  };
  await createAndSubmitEntry(ctx, { ...head, sourceEntity: PurchaseInvoice.name, sourceId: id }, lines);
}

async function onSalesSubmitted(ctx: Context, { row }: HookArgs): Promise<void> {
  if (await hasSeparateStockFulfillment(ctx, SalesInvoice.name, row)) return;
  if (!(await autoIssueOnSales(ctx))) return;
  const id = row.id as string;
  const { items } = await listAll(
    (q) => repo(ctx, SalesInvoiceLine).list(q),
    { where: { invoiceId: id }, orderBy: [{ field: 'seq', dir: 'asc' }] },
    5000,
  );
  const lines = issueLinesFromSales(items, await kindsFor(ctx, items));
  if (lines.length === 0) return;
  const warehouse = await resolveDefaultWarehouse(ctx);
  const head = {
    type: 'issue' as const,
    date: row.date as LocalDate,
    warehouseId: warehouse.id,
    partnerId: row.partnerId as string,
    note: `売上請求書 ${String(row.number)}`,
  };
  await createAndSubmitEntry(ctx, { ...head, sourceEntity: SalesInvoice.name, sourceId: id }, lines);
}

export function registerInvoiceHooks(): void {
  registry.registerHook(PurchaseInvoice.name, 'after_submit', onPurchaseSubmitted);
  registry.registerHook(SalesInvoice.name, 'after_submit', onSalesSubmitted);
  registry.registerHook(PurchaseInvoice.name, 'after_cancel', (ctx, { row, correctionDate }) =>
    cancelLinkedEntries(ctx, PurchaseInvoice.name, row.id as string, correctionDate).then(() => undefined),
  );
  registry.registerHook(SalesInvoice.name, 'after_cancel', (ctx, { row, correctionDate }) =>
    cancelLinkedEntries(ctx, SalesInvoice.name, row.id as string, correctionDate).then(() => undefined),
  );
}
