// retail_closing submit hooks (docs/specs/pack-retail.md AC-3/AC-4), in the submitting user's context and transaction.
// before_submit: ≥ 1 line, totals re-derived, cash + card = total, total > 0 (a sales invoice bills a positive amount), the
//   walk-in partner exists, and — while inventory issues automatically — the closing's warehouse is the default warehouse
//   (inventory issues from that one only). The totals are set on the row the kernel writes with docstatus/number.
// after_submit (the number exists now): (1) a tax-inclusive sales_invoice for the walk-in customer with the closing's lines,
//   created, line-saved and submitted through the kernel document ports the generic create/submit actions use — so the sales
//   hooks post it and inventory's hook issues the goods lines; (2) when cash > 0, a cash receipt allocated to that invoice
//   (payment posts Dr 現金 / Cr 売掛金); (3) the card part stays the invoice balance; (4) both ids stored on the closing.
import { DOCSTATUS, getSetting, registry, repo, saveLines, StateError, submitDocument, ValidationError, type Context, type Decimal, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, INVENTORY_SETTING_DEFAULTS, resolveDefaultWarehouse } from '@daifuku/mod-inventory';
import { Partner } from '@daifuku/mod-partner';
import { defaultAccountIdFor, Payment, PaymentAllocation } from '@daifuku/mod-payment';
import { SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { RetailClosing } from '../entities/retail-closing.ts';
import { WALK_IN_CODE } from '../seed.ts';
import { decimalOf } from '../services/closing-totals.ts';
import { asPack } from '../system-write.ts';
import { assertTender, computeClosing, loadClosingLines } from './recalc.ts';

export const WALK_IN_HINT = `Apply the retail pack to this company (its seed creates the walk-in partner ${WALK_IN_CODE}).`;
export const WAREHOUSE_HINT = 'Inventory issues sales from the default warehouse (inventory.default_warehouse): close the register on that warehouse, or change the setting. Multiple stores are out of scope.';

export async function findWalkIn(ctx: Context): Promise<string> {
  const found = (await repo(ctx, Partner).list({ where: { code: WALK_IN_CODE }, limit: 1 })).items[0];
  if (!found) throw new StateError(`walk-in partner ${WALK_IN_CODE} does not exist`, WALK_IN_HINT, { code: WALK_IN_CODE });
  return found.id;
}

async function assertWarehouse(ctx: Context, warehouseId: unknown): Promise<void> {
  const autoIssue = await getSetting(ctx, AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, INVENTORY_SETTING_DEFAULTS[AUTO_ISSUE_ON_SALES_KEY]);
  if (!autoIssue) return;
  const main = await resolveDefaultWarehouse(ctx);
  if (warehouseId !== main.id) throw new StateError(`retail_closing warehouse ${String(warehouseId)} is not the default warehouse ${main.code}`, WAREHOUSE_HINT, { warehouseId, defaultWarehouseId: main.id });
}

async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const { totals, lineCount } = await computeClosing(ctx, id, row.date as LocalDate);
  if (lineCount === 0) throw new ValidationError(`retail_closing ${id} has no lines`, [{ path: 'lines', message: 'at least 1 line is required' }], 'Add the products sold, then submit.');
  Object.assign(row, { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, taxSummary: totals.taxSummary });
  assertTender({ number: row.number, cashAmount: row.cashAmount, cardAmount: row.cardAmount, total: row.total }, id);
  if (!totals.total.gt(0)) {
    throw new ValidationError(`retail_closing ${id} total ${totals.total.toString()} must be greater than 0`, [{ path: 'total', message: 'must be > 0' }], 'A closing with only returns cannot become a sales invoice (credit notes are out of scope).');
  }
  await findWalkIn(ctx);
  await assertWarehouse(ctx, row.warehouseId);
}

interface ClosingHead {
  id: string;
  number: string;
  date: LocalDate;
  partnerId: string;
  cash: Decimal;
}

async function createInvoice(ctx: Context, head: ClosingHead): Promise<string> {
  const lines = await loadClosingLines(ctx, head.id);
  const draft = await repo(ctx, SalesInvoice).create({ partnerId: head.partnerId, date: head.date, priceIncludesTax: true, note: `レジ締め ${head.number}` });
  await saveLines(ctx, SalesInvoice, draft.id, {
    [SalesInvoiceLine.name]: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, taxCategory: l.taxCategory })),
  });
  const submitted = await submitDocument(ctx, SalesInvoice, draft.id);
  return submitted.id;
}

async function createCashReceipt(ctx: Context, head: ClosingHead, invoiceId: string): Promise<string> {
  const account = await defaultAccountIdFor(ctx, 'cash');
  if (!account.id) throw new StateError(`cash account ${account.code} does not exist`, 'Seed the chart of accounts (l10n/jp) or change payment.accounts.cash.', { code: account.code });
  const draft = await repo(ctx, Payment).create({ direction: 'receive', partnerId: head.partnerId, date: head.date, amount: head.cash, method: 'cash', accountId: account.id, note: `レジ締め ${head.number} 現金売上` });
  await saveLines(ctx, Payment, draft.id, { [PaymentAllocation.name]: [{ invoiceEntity: SalesInvoice.name, invoiceId, amount: head.cash }] });
  const submitted = await submitDocument(ctx, Payment, draft.id);
  return submitted.id;
}

async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.submitted) return;
  const head: ClosingHead = { id: row.id as string, number: String(row.number), date: row.date as LocalDate, partnerId: await findWalkIn(ctx), cash: decimalOf(row.cashAmount) };
  const salesInvoiceId = await createInvoice(ctx, head);
  const paymentId = head.cash.gt(0) ? await createCashReceipt(ctx, head, salesInvoiceId) : null;
  await asPack(ctx, (ctx) => repo(ctx, RetailClosing).update(head.id, { salesInvoiceId, paymentId }));
}

export function registerSubmitHooks(): void {
  registry.registerHook(RetailClosing.name, 'before_submit', beforeSubmit);
  registry.registerHook(RetailClosing.name, 'after_submit', afterSubmit);
}
