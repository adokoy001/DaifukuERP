// Pure: the settlement's journal lines (spec AC-8) and the payout/refund it needs (AC-7). Accounts arrive as ids.
//   Dr expense           one line per (account, tax category, rate): Σ taxable, with category and rate
//   Dr 仮払消費税         one line per rate group: Σ deductible tax, memo 「仮払消費税 <rate label>」
//   Dr expense           one line per account: Σ non-deductible tax, memo 「控除対象外消費税」
//   Cr 仮払金             advance settlements: min(total, advance)
//   Cr 未払金             reimbursement / corporate card: total; advance: the part of total above the advance
// Credit lines carry the settlement's partner. Zero amounts produce no line; Σ debit = Σ credit = total by construction.
import { Decimal } from '@daifuku/kernel';
import type { LineInput } from '@daifuku/mod-accounting';
import { INPUT_TAX_MEMO, NON_DEDUCTIBLE_MEMO } from '@daifuku/mod-purchase';
import type { TaxCategory } from '@daifuku/mod-tax';
import type { ExpenseSettlementKind } from '../contract.ts';

export interface PostingLine {
  accountId: string;
  taxCategory: TaxCategory;
  taxRate: Decimal;
  taxableAmount: Decimal;
  nonDeductibleTax: Decimal;
}

export interface PostingGroup {
  category: TaxCategory;
  rate: Decimal;
  label: string;
  deductibleTax: Decimal;
}

export interface SettlementPostingInput {
  kind: ExpenseSettlementKind;
  partnerId: string;
  total: Decimal;
  /** The advance being cleared (0 unless kind = advance). */
  advanceAmount: Decimal;
  lines: readonly PostingLine[];
  groups: readonly PostingGroup[];
  accounts: { payable: string; advance: string; taxReceivable: string };
}

export interface ClearingPlan {
  direction: 'pay' | 'receive';
  amount: Decimal;
  counter: 'payable' | 'advance';
}

export interface SettlementAmounts {
  /** Credited to 仮払金. */
  advanceCleared: Decimal;
  /** Credited to 未払金. */
  payable: Decimal;
  payAmount: Decimal;
  refundAmount: Decimal;
}

/** How the total splits between the advance and 未払金, and what is paid out or refunded (AC-7). */
export function settlementAmounts(kind: ExpenseSettlementKind, total: Decimal, advance: Decimal): SettlementAmounts {
  if (kind === 'advance') {
    const cleared = total.lt(advance) ? total : advance;
    const payable = total.minus(cleared);
    return {
      advanceCleared: cleared,
      payable,
      payAmount: payable,
      refundAmount: advance.minus(cleared),
    };
  }
  const zero = Decimal.zero();
  return {
    advanceCleared: zero,
    payable: total,
    payAmount: kind === 'reimbursement' ? total : zero,
    refundAmount: zero,
  };
}

/** AC-7: the clearing payment to create, or null (corporate card, or an advance that matches the total exactly). */
export function clearingPlan(kind: ExpenseSettlementKind, total: Decimal, advance: Decimal): ClearingPlan | null {
  const a = settlementAmounts(kind, total, advance);
  if (a.payAmount.gt(0)) return { direction: 'pay', amount: a.payAmount, counter: 'payable' };
  if (a.refundAmount.gt(0)) return { direction: 'receive', amount: a.refundAmount, counter: 'advance' };
  return null;
}

/** AC-8: the balanced line set handed to accounting `postFromSource` (empty when the settlement has no lines). */
export function settlementJournalLines(input: SettlementPostingInput): LineInput[] {
  const out: LineInput[] = [];
  const buckets = new Map<string, { accountId: string; category: TaxCategory; rate: Decimal; sum: Decimal }>();
  for (const line of input.lines) {
    const key = `${line.accountId}|${line.taxCategory}|${line.taxRate.toString()}`;
    const b = buckets.get(key) ?? {
      accountId: line.accountId,
      category: line.taxCategory,
      rate: line.taxRate,
      sum: Decimal.zero(),
    };
    b.sum = b.sum.plus(line.taxableAmount);
    buckets.set(key, b);
  }
  for (const b of buckets.values())
    if (!b.sum.isZero()) out.push({ accountId: b.accountId, debit: b.sum, taxCategory: b.category, taxRate: b.rate });
  for (const g of input.groups)
    if (!g.deductibleTax.isZero())
      out.push({
        accountId: input.accounts.taxReceivable,
        debit: g.deductibleTax,
        taxCategory: g.category,
        taxRate: g.rate,
        memo: `${INPUT_TAX_MEMO} ${g.label}`.trim(),
      });
  const nonDeductible = new Map<string, Decimal>();
  for (const line of input.lines)
    nonDeductible.set(
      line.accountId,
      (nonDeductible.get(line.accountId) ?? Decimal.zero()).plus(line.nonDeductibleTax),
    );
  for (const [accountId, amount] of nonDeductible)
    if (!amount.isZero()) out.push({ accountId, debit: amount, memo: NON_DEDUCTIBLE_MEMO });
  const a = settlementAmounts(input.kind, input.total, input.advanceAmount);
  if (!a.advanceCleared.isZero())
    out.push({ accountId: input.accounts.advance, credit: a.advanceCleared, partnerId: input.partnerId });
  if (!a.payable.isZero())
    out.push({ accountId: input.accounts.payable, credit: a.payable, partnerId: input.partnerId });
  return out;
}
