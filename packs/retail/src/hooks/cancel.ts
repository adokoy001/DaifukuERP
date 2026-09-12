// retail_closing after_cancel (docs/specs/pack-retail.md AC-4): the cash receipt is cancelled first (sales refuses to cancel
// a paid invoice; payment's cancel un-applies the allocation and reverses its entry), then the sales invoice (sales reverses
// its entry; inventory's hook cancels the linked stock issue). after_* (not before_*): while the closing is still submitted,
// its ref fields make the kernel's dependents check refuse cancelling the payment/invoice (same as inventory's stock count).
// Runs in the cancelling user's context: payment.cancel needs accounting (or admin), sales_invoice.cancel needs sales.
import { cancelDocument, DOCSTATUS, registry, repo, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { Payment } from '@daifuku/mod-payment';
import { SalesInvoice } from '@daifuku/mod-sales';
import { RetailClosing } from '../entities/retail-closing.ts';

async function cancelIfSubmitted(ctx: Context, entity: typeof Payment | typeof SalesInvoice, id: unknown, correctionDate?: LocalDate): Promise<void> {
  if (typeof id !== 'string') return;
  const doc = entity === Payment ? await repo(ctx, Payment).find(id) : await repo(ctx, SalesInvoice).find(id);
  if (doc?.docstatus === DOCSTATUS.submitted) await cancelDocument(ctx, entity, id, { correctionDate });
}

async function afterCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  await cancelIfSubmitted(ctx, Payment, row.paymentId, correctionDate);
  await cancelIfSubmitted(ctx, SalesInvoice, row.salesInvoiceId, correctionDate);
}

export function registerCancelHooks(): void {
  registry.registerHook(RetailClosing.name, 'after_cancel', afterCancel);
}
