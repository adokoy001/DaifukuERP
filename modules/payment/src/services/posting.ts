// Pure: journal lines for a submitted payment (spec AC-3).
//   receive: Dr 現金/預金 (amount) / Cr 売掛金 (one line per allocation, Σ = allocated) / Cr 前受金 (unallocated)
//   pay:     Dr 買掛金 (one line per allocation, Σ = allocated) / Dr 前払金 (unallocated) / Cr 現金/預金 (amount)
// Zero lines are omitted (accounting rejects debit = credit = 0). Balanced by construction: amount = allocated + unallocated.
import { Decimal, type DecimalInput } from '@daifuku/kernel';
import type { PaymentDirection } from '../entities/payment.ts';
import type { PostingAccounts } from '../settings.ts';

/** Shape accepted by accounting `postFromSource` (`LineInput`), with Decimal amounts. */
export interface JournalLineSpec {
  accountId: string;
  debit?: Decimal;
  credit?: Decimal;
  partnerId?: string | null;
  memo?: string | null;
}

export interface PostingAllocation {
  invoiceNumber: string | null;
  controlAccountId?: string | null;
  amount: DecimalInput;
}

export interface PostingInput {
  direction: PaymentDirection;
  partnerId: string;
  /** The payment's own cash/bank account. */
  accountId: string;
  amount: DecimalInput;
  allocations: readonly PostingAllocation[];
  unallocated: DecimalInput;
  accounts: PostingAccounts;
}

export const MEMO = {
  receivable: '売掛金',
  payable: '買掛金',
  advanceReceived: '前受金',
  advancePaid: '前払金',
  receipt: '入金',
  disbursement: '支払',
} as const;

function line(accountId: string, side: 'debit' | 'credit', amount: Decimal, extra: Omit<JournalLineSpec, 'accountId' | 'debit' | 'credit'> = {}): JournalLineSpec {
  return side === 'debit' ? { accountId, debit: amount, ...extra } : { accountId, credit: amount, ...extra };
}

/** The receivable/payable side, one line per allocation, plus the advance line for what was not allocated. */
function counterLines(input: PostingInput, side: 'debit' | 'credit'): JournalLineSpec[] {
  const receive = input.direction === 'receive';
  const settled = receive ? input.accounts.receivable : input.accounts.payable;
  const advance = receive ? input.accounts.advanceReceived : input.accounts.advancePaid;
  const settledMemo = receive ? MEMO.receivable : MEMO.payable;
  const advanceMemo = receive ? MEMO.advanceReceived : MEMO.advancePaid;
  const out = input.allocations
    .map((a) => ({ accountId: a.controlAccountId ?? settled, amount: Decimal.from(a.amount), memo: a.invoiceNumber ? `${settledMemo} ${a.invoiceNumber}` : settledMemo }))
    .filter((a) => !a.amount.isZero())
    .map((a) => line(a.accountId, side, a.amount, { partnerId: input.partnerId, memo: a.memo }));
  const unallocated = Decimal.from(input.unallocated);
  if (!unallocated.isZero()) out.push(line(advance, side, unallocated, { partnerId: input.partnerId, memo: advanceMemo }));
  return out;
}

/** Journal lines in posting order: cash/bank first for a receipt, last for a disbursement. */
export function journalLinesFor(input: PostingInput): JournalLineSpec[] {
  const amount = Decimal.from(input.amount);
  if (input.direction === 'receive') {
    return [line(input.accountId, 'debit', amount, { partnerId: input.partnerId, memo: MEMO.receipt }), ...counterLines(input, 'credit')];
  }
  return [...counterLines(input, 'debit'), line(input.accountId, 'credit', amount, { partnerId: input.partnerId, memo: MEMO.disbursement })];
}

/** Σcredit − Σdebit over the lines; 0 when balanced. Exposed for tests/property checks. */
export function imbalance(lines: readonly JournalLineSpec[]): Decimal {
  return Decimal.sum(lines.map((l) => l.credit ?? Decimal.zero())).minus(Decimal.sum(lines.map((l) => l.debit ?? Decimal.zero())));
}

/** Journal entry description: 入金/支払 <number> <partner>; before numbering, without the number. */
export function entryDescription(direction: PaymentDirection, partnerName: string, number: string | null): string {
  const kind = direction === 'receive' ? MEMO.receipt : MEMO.disbursement;
  return number ? `${kind} ${number} ${partnerName}` : `${kind} ${partnerName}`;
}
