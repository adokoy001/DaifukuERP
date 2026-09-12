// Payment application arithmetic (docs/specs/purchase.md AC-5). Pure. The purchase module records what was paid against a
// bill; the cash side (bank/cash journal) belongs to the payment module, so nothing is posted here.
import type { Decimal } from '@daifuku/kernel';

export type OpenStatus = 'open' | 'paid';

export interface PaymentResult {
  paidAmount: Decimal;
  balance: Decimal;
  status: OpenStatus;
}

export interface PaymentIssue {
  path: string;
  message: string;
}

/**
 * Applies `amount` (positive = payment, negative = refund/un-apply) to a bill. Refused when it would take paidAmount
 * past the total or below zero (credit notes carry negative totals; the same rule applies with the sign flipped).
 */
export function applyPaymentAmounts(total: Decimal, paidAmount: Decimal, amount: Decimal): PaymentResult | PaymentIssue {
  if (amount.isZero()) return { path: 'amount', message: 'must not be zero' };
  const paid = paidAmount.plus(amount);
  const overshoot = total.isNegative() ? paid.gt(0) || paid.lt(total) : paid.lt(0) || paid.gt(total);
  if (overshoot) return { path: 'amount', message: `paid amount ${paid.toString()} would leave the range 0..${total.toString()}` };
  const balance = total.minus(paid);
  return { paidAmount: paid, balance, status: balance.isZero() ? 'paid' : 'open' };
}

export function isPaymentIssue(r: PaymentResult | PaymentIssue): r is PaymentIssue {
  return 'message' in r;
}
