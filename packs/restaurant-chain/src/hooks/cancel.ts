import { cancelDocument, DOCSTATUS, registry, repo, ValidationError, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { Payment } from '@daifuku/mod-payment';
import { SalesInvoice } from '@daifuku/mod-sales';
import { StockEntry } from '@daifuku/mod-inventory';
import { RestaurantClosing } from '../entities/closing.ts';

async function afterCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  const options = { correctionDate };
  if (typeof row.paymentId === 'string') {
    const payment = await repo(ctx, Payment).get(row.paymentId);
    if (payment.docstatus === DOCSTATUS.submitted) await cancelDocument(ctx, Payment, payment.id, { ...options, expectedVersion: payment.version });
  }
  if (typeof row.salesInvoiceId === 'string') {
    const invoice = await repo(ctx, SalesInvoice).get(row.salesInvoiceId);
    if (invoice.docstatus === DOCSTATUS.submitted) await cancelDocument(ctx, SalesInvoice, invoice.id, { ...options, expectedVersion: invoice.version });
  }
  for (const id of [row.wasteEntryId, row.consumptionEntryId]) {
    if (typeof id !== 'string') continue;
    const entry = await repo(ctx, StockEntry).get(id);
    if (entry.docstatus === DOCSTATUS.submitted) await cancelDocument(ctx, StockEntry, entry.id, { ...options, expectedVersion: entry.version });
  }
}
export function registerCancelHooks(): void {
  registry.registerHook(RestaurantClosing.name, 'before_cancel', async (_ctx, { row, correctionDate }) => {
    const date = correctionDate ?? row.date as LocalDate;
    if (date < String(row.date)) throw new ValidationError('訂正日は営業日以降を指定してください', [{ path: 'correctionDate', message: 'must be on or after the business date' }]);
    row.cancelledDate = date;
  });
  registry.registerHook(RestaurantClosing.name, 'after_cancel', afterCancel);
}
