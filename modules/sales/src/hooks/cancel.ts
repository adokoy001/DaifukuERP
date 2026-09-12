// sales_invoice before_cancel (spec AC-4): refused while a payment is applied; otherwise the journal entry is
// reversed (accounting.reverseSourceEntry, dated as the original entry so every trial-balance range is unchanged) and
// status becomes 'cancelled'. balance keeps the spec formula (total − paidAmount); status is the gate for AR.
import { Decimal, registry, StateError, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { reverseSourceEntry } from '@daifuku/mod-accounting';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { assertCancellationDate } from '../settlements.ts';

export const CANCEL_PAID_HINT = 'reverse the payment first (cancel the payment document), then cancel the invoice';

async function beforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  const paid = Decimal.from(String(row.paidAmount ?? '0'));
  if (paid.gt(0)) {
    throw new StateError(`sales_invoice ${String(row.number ?? row.id)} has ${paid.toString()} applied as payment and cannot be cancelled`, CANCEL_PAID_HINT, {
      id: row.id,
      number: row.number,
      paidAmount: paid.toString(),
    });
  }
  await assertCancellationDate(ctx, row.id as string, (correctionDate ?? row.date) as LocalDate, row.settlementHistory === true);
  if (typeof row.journalEntryId !== 'string') throw new StateError('Source posting link is missing', 'Repair the source linkage before cancelling.');
  await reverseSourceEntry(ctx, { id: row.journalEntryId, sourceEntity: SalesInvoice.name, sourceId: row.id as string, date: correctionDate });
  row.status = 'cancelled';
  row.cancelledDate = correctionDate ?? row.date;
}

export function registerCancelHook(): void {
  registry.registerHook(SalesInvoice.name, 'before_cancel', beforeCancel);
}
