// payment before_cancel (spec AC-4): every allocation is un-applied (negative applyPayment, which reopens a paid
// invoice) and the cash entry reversed (accounting.reverseSourceEntry, dated as the original so every trial-balance range is
// unchanged). Runs in the cancelling user's context: cancel is granted to accounting (and admin), which holds `update`
// on both invoice entities and `submit` on journal_entry. The kernel then writes docstatus=2 in the same transaction.
import { registry, StateError, ValidationError, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { reverseSourceEntry } from '@daifuku/mod-accounting';
import { Payment } from '../entities/payment.ts';
import { applyInvoicePayment } from '../invoices.ts';
import { loadAllocationLines } from './submit.ts';

async function beforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  const id = row.id as string;
  const date = correctionDate ?? row.date as LocalDate;
  if (date < String(row.date)) throw new ValidationError('Cancellation cannot precede the payment', [{ path: 'correctionDate', message: 'must be on or after the original date' }]);
  row.cancelledDate = date;
  for (const l of (await loadAllocationLines(ctx, id)).sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))) await applyInvoicePayment(ctx, { entity: l.invoiceEntity, invoiceId: l.invoiceId, amount: l.amount.neg(), date });
  if (typeof row.journalEntryId !== 'string') throw new StateError('Source posting link is missing', 'Repair the source linkage before cancelling.');
  await reverseSourceEntry(ctx, { id: row.journalEntryId, sourceEntity: Payment.name, sourceId: id, date });
}

export function registerCancelHook(): void {
  registry.registerHook(Payment.name, 'before_cancel', beforeCancel);
}
