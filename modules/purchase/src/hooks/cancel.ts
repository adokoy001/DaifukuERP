// purchase_invoice before_cancel (docs/specs/purchase.md AC-4): a bill with payments applied cannot be cancelled
// (un-apply them first); otherwise the posted entry is reversed (accounting.reverse_entry, dated like the original) and
// the status becomes 'cancelled'. The kernel then writes docstatus=2 together with the status in one UPDATE.
import { Decimal, StateError, registry, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { reverseSourceEntry } from '@daifuku/mod-accounting';
import { PurchaseInvoice } from '../entities/purchase-invoice.ts';
import { assertCancellationDate } from '../settlements.ts';

export const PAID_CANCEL_HINT = 'Un-apply the payments first (paidAmount must be 0), then cancel.';

async function onBeforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  const paid = Decimal.from(String(row.paidAmount ?? '0'));
  if (!paid.isZero()) {
    throw new StateError(
      `purchase_invoice ${String(row.number ?? row.id)} has payments applied (paidAmount ${paid.toString()})`,
      PAID_CANCEL_HINT,
      { id: row.id, number: row.number, paidAmount: paid.toString() },
    );
  }
  await assertCancellationDate(
    ctx,
    row.id as string,
    (correctionDate ?? row.date) as LocalDate,
    row.settlementHistory === true,
  );
  if (typeof row.journalEntryId !== 'string')
    throw new StateError('Source posting link is missing', 'Repair the source linkage before cancelling.');
  await reverseSourceEntry(ctx, {
    id: row.journalEntryId,
    sourceEntity: PurchaseInvoice.name,
    sourceId: row.id as string,
    date: correctionDate,
  });
  row.status = 'cancelled';
  row.cancelledDate = correctionDate ?? row.date;
}

export function registerCancelHook(): void {
  registry.registerHook(PurchaseInvoice.name, 'before_cancel', onBeforeCancel);
}
