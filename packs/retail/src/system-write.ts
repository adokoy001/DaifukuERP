// Private scoped writes retain the caller's ordinary entity and row permissions.
import { defineWriteCapability, hasWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';
const month = defineWriteCapability({
  name: 'retail.month-close',
  entity: 'retail_month_close',
  fields: ['period', 'asOf', 'valuationTotal', 'openingAmount', 'journalEntryId'],
  operations: ['create', 'update'],
});
const closing = defineWriteCapability({
  name: 'retail.closing-links',
  entity: 'retail_closing',
  fields: ['salesInvoiceId', 'paymentId'],
  operations: ['update'],
});
export function isPackWrite(ctx: Context): boolean {
  return hasWriteCapability(ctx, 'retail_month_close', 'create');
}
export function asPack<T>(ctx: Context, fn: (internal: Context) => Promise<T>): Promise<T> {
  return withWriteCapability(ctx, month, (internal) => withWriteCapability(internal, closing, fn));
}
