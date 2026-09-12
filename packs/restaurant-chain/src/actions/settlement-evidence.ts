import { column, Decimal, defineAction, label, repo, StateError, tableResult, type Context, type TableResult } from '@daifuku/kernel';
import { invoiceBalancesAsOf, SalesInvoice, SalesSettlement } from '@daifuku/mod-sales';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantStore } from '../entities/store.ts';
import { operationsInput, type OperationsInput } from '../services/operations-contract.ts';
import { allPages } from '../services/operations-data.ts';
import { resolveRange } from '../services/operation-dates.ts';
export async function settlementEvidence(ctx: Context, input: OperationsInput): Promise<TableResult> {
  const range = resolveRange(ctx, input);
  if (input.storeId) await repo(ctx, RestaurantStore).get(input.storeId);
  const closings = await allPages((offset) => repo(ctx, RestaurantClosing).list({ where: { ...(input.storeId ? { storeId: input.storeId } : {}), docstatus: { $in: [1, 2] }, $and: [{ date: { $gte: range.from } }, { date: { $lte: range.to } }] }, orderBy: [{ field: 'id', dir: 'asc' }], limit: 500, offset }));
  const invoiceIds = [...new Set(closings.flatMap((row) => row.salesInvoiceId ? [row.salesInvoiceId] : []))];
  const invoices = [];
  // A payment or cancellation also locks its invoice: read the latest invoice and its
  // effective settlement history while retaining that same lock until this report ends.
  for (const id of invoiceIds.sort()) {
    const invoice = await repo(ctx, SalesInvoice).lock(id, 'read');
    if (invoice.docstatus === 0 || invoice.docstatus === 2 && !invoice.cancelledDate) throw new StateError('請求書の確定・取消履歴が不明です', 'Restore its posting and cancellation dates before reporting.');
    if (invoice.date <= range.asOf && (invoice.docstatus === 1 || invoice.cancelledDate && invoice.cancelledDate > range.asOf)) invoices.push(invoice);
  }
  const balances = await invoiceBalancesAsOf(ctx, invoices, range.asOf), byId = new Map(invoices.map((row) => [row.id, row]));
  const stores = new Map<string, string>(), totals = { sales: Decimal.zero(), settled: Decimal.zero(), balance: Decimal.zero() };
  const rows = [];
  for (const closing of closings) {
    const invoice = closing.salesInvoiceId ? byId.get(closing.salesInvoiceId) : undefined; if (!invoice) continue;
    if (!stores.has(closing.storeId)) stores.set(closing.storeId, (await repo(ctx, RestaurantStore).get(closing.storeId)).name);
    const balance = balances.get(invoice.id);
    if (!balance) throw new StateError('入金履歴の残高が取得できません', 'Reload the source invoice and settlement history.');
    const settled = invoice.total.minus(balance);
    totals.sales = totals.sales.plus(invoice.total); totals.settled = totals.settled.plus(settled); totals.balance = totals.balance.plus(balance);
    rows.push({ storeId: closing.storeId, store: stores.get(closing.storeId), date: closing.date, closingId: closing.id, closingNumber: closing.number, invoiceId: invoice.id, invoiceNumber: invoice.number, sales: invoice.total.toString(), settled: settled.toString(), balance: balance.toString() });
  }
  return { title: label('本部・決済債権の根拠', 'Headquarters settlement evidence'), columns: [column('store', label('店舗', 'Store'), 'text'), column('date', label('営業日', 'Business date'), 'date'), column('closingId', label('元の締め', 'Closing'), 'ref', { ref: RestaurantClosing.name }), column('closingNumber', label('締め番号', 'Closing number'), 'text'), column('invoiceId', label('請求書', 'Invoice'), 'ref', { ref: SalesInvoice.name }), column('invoiceNumber', label('請求番号', 'Invoice number'), 'text'), column('sales', label('税込売上', 'Gross sales'), 'decimal'), column('settled', label('基準日までの入金', 'Settled as of'), 'decimal'), column('balance', label('基準日の未入金', 'Balance as of'), 'decimal')], rows, totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toString()])), meta: { asOf: range.asOf, balanceBasis: 'effective_dated_settlements', receiptScope: 'invoices_from_selected_business_dates', channelAllocation: 'combined_receivable_no_card_qr_split', timeZone: 'Asia/Tokyo' } };
}
export const settlementEvidenceAction = defineAction({ name: 'restaurant_chain.settlement_evidence', description: label('本部・基準日決済債権', 'Headquarters settlement evidence as of date'), input: operationsInput, output: tableResult, permission: { entity: SalesInvoice.name, op: 'read' }, exportEntities: [RestaurantClosing.name, RestaurantStore.name, SalesInvoice.name, SalesSettlement.name], tx: 'none', mutates: false, handler: settlementEvidence });
