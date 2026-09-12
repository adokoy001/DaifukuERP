// sales.record_payment / applyPayment (spec AC-7): moves paidAmount/balance/status of a submitted invoice. It does
// NOT post to accounting — the payment module posts the cash entry and calls applyPayment in the same transaction.
// A negative amount un-applies a payment (payment cancel); paidAmount must stay within 0..total.
import { Decimal, defineAction, DOCSTATUS, isDecimal, isLocalDate, label, repo, snapshot, StateError, ValidationError, type Context, type Infer, type LocalDate } from '@daifuku/kernel';
import { z } from 'zod';
import { appendSettlement, withBalanceWrite } from '../settlements.ts';
import { assertJpySettlement } from '@daifuku/mod-accounting';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { balanceOf } from '../services/recalculate.ts';

export type SalesInvoiceRow = Infer<typeof SalesInvoice>;

export interface ApplyPaymentInput {
  invoiceId: string;
  /** Positive to apply, negative to un-apply. */
  amount: Decimal | string;
  date: LocalDate;
}

export const PAYMENT_APPLIED_EVENT = 'sales_invoice.payment_applied';

const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
const decimalInput = z.union([z.string().refine(Decimal.isDecimalString, 'must be a decimal string'), z.custom<Decimal>(isDecimal, 'expected Decimal')]);

function parseAmount(v: Decimal | string): Decimal {
  const d = isDecimal(v) ? v : Decimal.isDecimalString(v) ? Decimal.from(v) : null;
  if (!d) throw new ValidationError(`invalid amount "${String(v)}"`, [{ path: 'amount', message: 'must be a decimal string' }]);
  if (d.isZero()) throw new ValidationError('amount must not be 0', [{ path: 'amount', message: 'must not be 0' }]);
  return d;
}

/** Plain function for in-process callers (payment module). Permissions: update on sales_invoice in the caller's context. */
export async function applyPayment(ctx: Context, input: ApplyPaymentInput): Promise<SalesInvoiceRow> {
  if (!isLocalDate(input.date)) throw new ValidationError(`invalid date "${input.date}"`, [{ path: 'date', message: 'must be YYYY-MM-DD' }]);
  const amount = parseAmount(input.amount);
  const r = repo(ctx, SalesInvoice);
  const inv = await r.lock(input.invoiceId);
  if (input.date < inv.date) throw new ValidationError('Settlement cannot precede its invoice', [{ path: 'date', message: 'must be on or after the invoice date' }]);
  await assertJpySettlement(ctx, amount, 'amount');
  if (!inv.settlementHistory) throw new StateError('Historical payment data requires migration', 'Migrate prior settlement facts before applying another payment.');
  const ref = inv.number ?? inv.id;
  if (inv.docstatus !== DOCSTATUS.submitted || inv.status === 'cancelled') {
    throw new StateError(`sales_invoice ${ref} is not open (docstatus ${inv.docstatus}, status ${inv.status})`, 'Submit the invoice first; cancelled invoices do not take payments.', { id: inv.id, docstatus: inv.docstatus, status: inv.status });
  }
  const paidAmount = inv.paidAmount.plus(amount);
  if (paidAmount.gt(inv.total)) {
    throw new ValidationError(`payment ${amount.toString()} exceeds the open balance ${inv.balance.toString()} of sales_invoice ${ref}`, [{ path: 'amount', message: `must be <= ${inv.balance.toString()}` }], 'Apply at most the open balance; book the excess as an advance (前受金) in the payment module.');
  }
  if (paidAmount.isNegative()) {
    throw new ValidationError(`un-applying ${amount.abs().toString()} exceeds the paid amount ${inv.paidAmount.toString()} of sales_invoice ${ref}`, [{ path: 'amount', message: `must be >= -${inv.paidAmount.toString()}` }], 'Un-apply at most what was applied.');
  }
  const balance = balanceOf(inv.total, paidAmount);
  const status = balance.isZero() ? 'paid' : 'open';
  const updated = await withBalanceWrite(ctx, (internal) => repo(internal, SalesInvoice).update(inv.id, { paidAmount, balance, status, settlementHistory: true }, { expectedVersion: inv.version }));
  await appendSettlement(ctx, inv.id, input.date, amount, inv.total);
  await ctx.emit(PAYMENT_APPLIED_EVENT, { invoiceId: inv.id, number: inv.number, amount: amount.toString(), date: input.date, paidAmount: paidAmount.toString(), balance: balance.toString(), status });
  return updated;
}

export const recordPaymentAction = defineAction({
  name: 'sales.record_payment',
  description: label(
    '売上請求書に入金を消し込みます（内部用: payment モジュールが呼ぶ。会計転記はしない）。paidAmount を増やし balance を再計算、残高 0 で status=paid。過入金は VALIDATION。負の amount で消込を戻します。',
    'Apply a payment to a sales invoice (internal: called by the payment module; does NOT post to accounting). Increases paidAmount, recomputes balance, sets status=paid at zero balance. Over-payment is VALIDATION; a negative amount un-applies.',
  ),
  input: z.object({ invoiceId: z.uuid(), amount: decimalInput, date: localDate }),
  output: SalesInvoice.schemas.json,
  permission: { entity: SalesInvoice.name, op: 'update' },
  // kernel-phase15 AC-9: in-process only (payment module / runAction); not a REST route, OpenAPI entry, /meta action or MCP tool
  internal: true,
  handler: async (ctx, input) => snapshot((await applyPayment(ctx, input)) as object as Record<string, unknown>),
});
