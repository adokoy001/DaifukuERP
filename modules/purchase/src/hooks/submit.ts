// purchase_invoice before_submit (docs/specs/purchase.md AC-3): recompute from the stored lines (defence against any
// stale header), then post through accounting `postFromSource` in the submitting user's transaction and context (no
// bypass, ADR-0007). The kernel writes the row (with docstatus/number) after this hook, so journalEntryId / status /
// balance land in the same UPDATE. A failing post (closed period, missing account…) leaves the bill a draft.
import { Decimal, ValidationError, registry, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { postFromSource, assertJpySettlement, postingDimensions } from '@daifuku/mod-accounting';
import { computeDueDate } from '@daifuku/mod-partner';
import { PurchaseInvoice } from '../entities/purchase-invoice.ts';
import { buildJournalLines } from '../services/posting.ts';
import { resolvePostingAccounts } from '../settings.ts';
import { computeInvoice, loadInvoiceLines, type InvoiceComputation, type InvoiceLineRow } from './recalc.ts';

export const NO_LINES_HINT = 'Add at least one line (purchase_invoice_line) before submitting.';

/** Description of the journal entry: 仕入 <supplier> [<supplier invoice no.>]. */
export function entryDescription(partnerName: string, supplierInvoiceNo: unknown): string {
  const no = typeof supplierInvoiceNo === 'string' && supplierInvoiceNo.trim() !== '' ? ` ${supplierInvoiceNo.trim()}` : '';
  return `仕入 ${partnerName}${no}`;
}

export async function postInvoice(ctx: Context, row: Record<string, unknown>, computed: InvoiceComputation, lines: readonly InvoiceLineRow[], date: LocalDate): Promise<string> {
  await assertJpySettlement(ctx, computed.calc.totals.total);
  const accounts = await resolvePostingAccounts(ctx);
  row.controlAccountId = accounts.payable;
  const journalLines = buildJournalLines({
    partnerId: computed.partner.id,
    priceIncludesTax: computed.calc.priceIncludesTax,
    rounding: computed.calc.rounding,
    lines: lines.map((l) => ({ productId: l.productId, accountId: l.accountId, amount: l.amount, taxCategory: l.taxCategory, ext: postingDimensions('purchase_invoice_line', 'journal_line', l.ext) })),
    groups: computed.calc.groups,
    totals: computed.calc.totals,
    accounts,
  });
  const entry = await postFromSource(ctx, {
    sourceEntity: PurchaseInvoice.name,
    sourceId: row.id as string,
    date,
    description: entryDescription(computed.partner.name, row.supplierInvoiceNo),
    ext: row.ext as Record<string, unknown>,
    lines: journalLines.map((l) => ({ ...l, ext: { ...postingDimensions(PurchaseInvoice.name, 'journal_line', row.ext as Record<string, unknown>), ...l.ext } })),
  });
  return entry.id;
}

async function onBeforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const date = row.date as LocalDate;
  const lines = await loadInvoiceLines(ctx, id);
  if (lines.length === 0) throw new ValidationError(`purchase_invoice ${id} has no lines`, [{ path: 'lines', message: 'at least one line is required' }], NO_LINES_HINT);
  const computed = await computeInvoice(ctx, { partnerId: row.partnerId as string, date, priceIncludesTax: row.priceIncludesTax === true }, lines);
  Object.assign(row, computed.fields);
  if (row.dueDate === null || row.dueDate === undefined) {
    const p = computed.partner;
    row.dueDate = computeDueDate(date, p.closingDay, p.paymentMonthOffset, p.paymentDay);
  }
  row.journalEntryId = await postInvoice(ctx, row, computed, lines, date);
  row.status = 'open';
  row.settlementHistory = true;
  row.paidAmount = Decimal.zero();
  row.balance = computed.calc.totals.total;
}

export function registerSubmitHook(): void {
  registry.registerHook(PurchaseInvoice.name, 'before_submit', onBeforeSubmit);
}
