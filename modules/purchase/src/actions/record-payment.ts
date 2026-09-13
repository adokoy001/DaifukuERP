// purchase.record_payment / applyPayment (docs/specs/purchase.md AC-5): records a payment against an open bill. No posting
// here — the cash entry belongs to the payment module, which calls `applyPayment` in the same transaction. Emits
// `purchase_invoice.payment_applied` so other modules can react after commit.
import {
  DOCSTATUS,
  Decimal,
  StateError,
  ValidationError,
  defineAction,
  isDecimal,
  isLocalDate,
  label,
  repo,
  snapshot,
  type Context,
  type Infer,
  type LocalDate,
} from '@daifuku/kernel';
import { z } from 'zod';
import { appendSettlement, withBalanceWrite } from '../settlements.ts';
import { assertJpySettlement } from '@daifuku/mod-accounting';
import { PurchaseInvoice } from '../entities/purchase-invoice.ts';
import { applyPaymentAmounts, isPaymentIssue } from '../services/payment.ts';

export type PurchaseInvoiceRow = Infer<typeof PurchaseInvoice>;

export const PAYMENT_APPLIED_EVENT = 'purchase_invoice.payment_applied';

export interface ApplyPaymentInput {
  invoiceId: string;
  /** Positive = payment, negative = refund / un-apply. Must not take paidAmount outside 0..total. */
  amount: Decimal | string;
  /** Effective settlement date recorded in the append-only invoice settlement history. */
  date: LocalDate;
}

const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
const decimalInput = z.union([
  z.string().refine(Decimal.isDecimalString, 'must be a decimal string'),
  z.custom<Decimal>(isDecimal, 'expected Decimal'),
]);

/** Plain function for in-process callers (payment module). Requires `update` on purchase_invoice for the caller's roles. */
export async function applyPayment(ctx: Context, input: ApplyPaymentInput): Promise<PurchaseInvoiceRow> {
  if (!isLocalDate(input.date))
    throw new ValidationError(`invalid date "${input.date}"`, [{ path: 'date', message: 'must be YYYY-MM-DD' }]);
  const amount = Decimal.from(input.amount);
  const r = repo(ctx, PurchaseInvoice);
  const bill = await r.lock(input.invoiceId);
  if (input.date < bill.date)
    throw new ValidationError('Settlement cannot precede its invoice', [
      { path: 'date', message: 'must be on or after the invoice date' },
    ]);
  await assertJpySettlement(ctx, amount, 'amount');
  if (!bill.settlementHistory)
    throw new StateError(
      'Historical payment data requires migration',
      'Migrate prior settlement facts before applying another payment.',
    );
  if (bill.docstatus !== DOCSTATUS.submitted || (bill.status !== 'open' && bill.status !== 'paid')) {
    throw new StateError(
      `purchase_invoice ${bill.number ?? bill.id} is not an open bill (docstatus ${bill.docstatus}, status ${bill.status})`,
      'Submit the bill first; cancelled bills take no payments.',
      { id: bill.id, docstatus: bill.docstatus, status: bill.status },
    );
  }
  const result = applyPaymentAmounts(bill.total, bill.paidAmount, amount);
  if (isPaymentIssue(result)) {
    throw new ValidationError(
      `purchase_invoice ${bill.number ?? bill.id}: ${result.message}`,
      [result],
      `The bill's balance is ${bill.balance.toString()} (total ${bill.total.toString()}, paid ${bill.paidAmount.toString()}).`,
    );
  }
  const updated = await withBalanceWrite(ctx, (internal) =>
    repo(internal, PurchaseInvoice).update(
      bill.id,
      { paidAmount: result.paidAmount, balance: result.balance, status: result.status, settlementHistory: true },
      { expectedVersion: bill.version },
    ),
  );
  await appendSettlement(ctx, bill.id, input.date, amount, bill.total);
  await ctx.emit(PAYMENT_APPLIED_EVENT, {
    invoiceId: bill.id,
    number: bill.number,
    amount: amount.toString(),
    date: input.date,
    paidAmount: result.paidAmount.toString(),
    balance: result.balance.toString(),
    status: result.status,
  });
  return updated;
}

export const recordPaymentAction = defineAction({
  name: 'purchase.record_payment',
  description: label(
    '確定済みの仕入請求書に支払を記録します（支払済額・残高・状態を更新。仕訳は起票しません — 入出金は payment モジュール）。amount は正で支払、負で取消。残高を超える／負にする金額は VALIDATION。',
    'Record a payment against a submitted purchase invoice (updates paidAmount/balance/status; no journal entry — cash belongs to the payment module). Positive amount = payment, negative = un-apply. Exceeding the balance is VALIDATION.',
  ),
  input: z.object({ invoiceId: z.uuid(), amount: decimalInput, date: localDate }),
  output: PurchaseInvoice.schemas.json,
  permission: { entity: PurchaseInvoice.name, op: 'update' },
  // kernel-phase15 AC-9: in-process only (payment module / runAction); not a REST route, OpenAPI entry, /meta action or MCP tool
  internal: true,
  handler: async (ctx, input) => snapshot((await applyPayment(ctx, input)) as object as Record<string, unknown>),
});
