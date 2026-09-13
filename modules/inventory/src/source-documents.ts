// Registration-time ports for independently fulfilled invoices. No caller-supplied bypass flag.
import { StateError, type Context } from '@daifuku/kernel';
const stockSources = new Set<string>();
type InvoiceOwner = (ctx: Context, invoiceEntity: string, invoice: Record<string, unknown>) => Promise<boolean>;
const invoiceOwners = new Map<string, InvoiceOwner>();
export function registerStockDocumentSource(entity: string) {
  stockSources.add(entity);
}
export function registeredStockSource(entity: string) {
  return stockSources.has(entity);
}
export function registerInvoiceStockOwner(name: string, validator: InvoiceOwner) {
  invoiceOwners.set(name, validator);
}
export async function hasSeparateStockFulfillment(ctx: Context, entity: string, row: Record<string, unknown>) {
  let owners = 0;
  for (const validator of invoiceOwners.values()) if (await validator(ctx, entity, row)) owners += 1;
  if (owners > 1)
    throw new StateError('Invoice has conflicting inventory sources', 'Resolve the source ownership before posting.');
  return owners === 1;
}
