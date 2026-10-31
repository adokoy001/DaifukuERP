// Clearing payments (ADR-0039, docs/specs/expense-settlement.md AC-14): a payout or refund that settles an account another
// module's document has already posted (未払金 of an expense settlement, 仮払金 of an advance). The owning module calls
// createClearingPayment in its own submit hook, in the caller's Context and transaction: the payment is created with the
// server-owned `counterAccountId` (only this file holds the write capability for it) and submitted at once, so payment's
// own rules post it (direction/role checks, JPY, cash/bank default, Dr/Cr counter vs cash/bank in hooks/submit.ts).
// The owning document references the payment (`paymentId`), so the kernel refuses to cancel the payment on its own
// (DependencyError) while that document is submitted; cancelling the document cancels the payment.
import {
  defineWriteCapability,
  repo,
  submitDocument,
  ValidationError,
  withWriteCapability,
  type Context,
  type Infer,
  type LocalDate,
} from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { Payment, type PaymentDirection, type PaymentMethod } from './entities/payment.ts';
import { defaultAccountIdFor, PAYMENT_ACCOUNTS_KEY } from './settings.ts';

const CLEARING = defineWriteCapability({
  name: 'payment.clearing',
  entity: Payment.name,
  fields: ['counterAccountId'],
  operations: ['create'],
});

export interface ClearingPaymentInput {
  direction: PaymentDirection;
  partnerId: string;
  date: LocalDate;
  /** Decimal string or Decimal; > 0, whole yen (payment's submit hook checks). */
  amount: string | { toString(): string };
  method: PaymentMethod;
  /** Cash/bank account; defaults from `payment.accounts` by method. */
  accountId?: string | null | undefined;
  /** The account the payment settles: an asset or liability without a tax role, other than the cash/bank account. */
  counterAccountId: string;
  note?: string | null | undefined;
}

const COUNTER_HINT = 'Point the owning setting (for example expense.accounts) at an asset or liability account.';

async function cashAccountId(ctx: Context, input: ClearingPaymentInput): Promise<string> {
  if (input.accountId) return input.accountId;
  const found = await defaultAccountIdFor(ctx, input.method);
  if (!found.id)
    throw new ValidationError(
      `no account has code ${found.code} (${PAYMENT_ACCOUNTS_KEY} default for method ${input.method})`,
      [{ path: 'paymentAccountId', message: `required: default account code ${found.code} does not exist` }],
      `Pass the cash/bank account, create the account with code ${found.code}, or change ${PAYMENT_ACCOUNTS_KEY}.`,
    );
  return found.id;
}

/** AC-14: the counter account exists in the company, is an asset/liability without a tax role, and is not the cash side. */
async function assertCounterAccount(ctx: Context, counterAccountId: string, accountId: string): Promise<void> {
  const account = await repo(ctx, Account).find(counterAccountId);
  const issue = !account
    ? 'account does not exist in this company'
    : account.type !== 'asset' && account.type !== 'liability'
      ? `account ${account.code} is ${account.type}; an asset or liability is required`
      : account.taxRole !== 'none' && account.taxRole !== null && account.taxRole !== undefined
        ? `account ${account.code} has tax role ${account.taxRole}`
        : counterAccountId === accountId
          ? `account ${account.code} is the payment's own cash/bank account`
          : null;
  if (issue)
    throw new ValidationError(
      `counter account is invalid: ${issue}`,
      [{ path: 'counterAccountId', message: issue }],
      COUNTER_HINT,
    );
}

/** Creates and submits a clearing payment in the caller's Context; returns the submitted payment. */
export async function createClearingPayment(ctx: Context, input: ClearingPaymentInput): Promise<Infer<typeof Payment>> {
  const accountId = await cashAccountId(ctx, input);
  await assertCounterAccount(ctx, input.counterAccountId, accountId);
  const created = await withWriteCapability(ctx, CLEARING, (write) =>
    repo(write, Payment).create({
      direction: input.direction,
      partnerId: input.partnerId,
      date: input.date,
      amount: input.amount.toString(),
      method: input.method,
      accountId,
      counterAccountId: input.counterAccountId,
      note: input.note ?? null,
    }),
  );
  return submitDocument(ctx, Payment, created.id);
}
