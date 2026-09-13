// Company settings owned by payment (spec AC-1 `payment.accounts`; ADR-0013 L1): the account codes a payment posts to.
// The Japanese chart of accounts (l10n/jp) seeds every default code; other charts change the setting, not the code.
import { getSetting, label, repo, StateError, type Context, type SettingDef } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { z } from 'zod';
import type { PaymentMethod } from './entities/payment.ts';

export const PAYMENT_ACCOUNTS_KEY = 'payment.accounts';

const code = z.string().min(1).max(20);

export const paymentAccountsSchema = z.object({
  /** 現金: default `accountId` for method `cash`. */
  cash: code,
  /** 普通預金: default `accountId` for every other method. */
  bank: code,
  /** 売掛金: credited by the allocated part of a receipt. */
  receivable: code,
  /** 買掛金: debited by the allocated part of a disbursement. */
  payable: code,
  /** 前受金: credited by the unallocated part of a receipt. */
  advanceReceived: code,
  /** 前払金: debited by the unallocated part of a disbursement. */
  advancePaid: code,
});
export type PaymentAccountCodes = z.output<typeof paymentAccountsSchema>;
export const PAYMENT_ACCOUNTS_DEFAULT: PaymentAccountCodes = {
  cash: '1000',
  bank: '1100',
  receivable: '1300',
  payable: '2100',
  advanceReceived: '2400',
  advancePaid: '1900',
};

export const PAYMENT_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: PAYMENT_ACCOUNTS_KEY,
    label: label('入出金の勘定科目', 'Payment accounts'),
    description: label(
      '科目コード: cash=現金, bank=普通預金, receivable=売掛金, payable=買掛金, advanceReceived=前受金, advancePaid=前払金',
      'Account codes: cash, bank, receivable, payable, advanceReceived (customer advances), advancePaid (supplier advances)',
    ),
    schema: paymentAccountsSchema,
  },
];

export const ACCOUNTS_HINT = `seed the chart of accounts (l10n/jp) or set ${PAYMENT_ACCOUNTS_KEY}`;

/** Account ids used when a payment is posted (the cash/bank side is the payment's own `accountId`). */
export interface PostingAccounts {
  receivable: string;
  payable: string;
  advanceReceived: string;
  advancePaid: string;
}

export async function loadPaymentAccountCodes(ctx: Context): Promise<PaymentAccountCodes> {
  return getSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, PAYMENT_ACCOUNTS_DEFAULT);
}

async function idsByCode(ctx: Context, codes: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(codes)];
  const found = await repo(ctx, Account).list({ where: { code: { $in: wanted } }, limit: wanted.length });
  return new Map(found.items.map((a) => [a.code, a.id]));
}

/** Ids for the receivable/payable/advance codes; INVALID_STATE naming every missing code (AC-3). */
export async function resolvePostingAccounts(ctx: Context): Promise<PostingAccounts> {
  const codes = await loadPaymentAccountCodes(ctx);
  const roles = ['receivable', 'payable', 'advanceReceived', 'advancePaid'] as const;
  const byCode = await idsByCode(
    ctx,
    roles.map((r) => codes[r]),
  );
  const missing = roles.filter((r) => !byCode.has(codes[r]));
  if (missing.length > 0) {
    throw new StateError(
      `account code(s) ${missing.map((r) => `${codes[r]} (${r})`).join(', ')} do not exist`,
      ACCOUNTS_HINT,
      { setting: PAYMENT_ACCOUNTS_KEY, missing: Object.fromEntries(missing.map((r) => [r, codes[r]])) },
    );
  }
  const id = (r: (typeof roles)[number]) => byCode.get(codes[r]) ?? '';
  return {
    receivable: id('receivable'),
    payable: id('payable'),
    advanceReceived: id('advanceReceived'),
    advancePaid: id('advancePaid'),
  };
}

/** Code of the default cash/bank account for a method (AC-1): cash -> `cash`, everything else -> `bank`. */
export function defaultAccountCodeFor(codes: PaymentAccountCodes, method: PaymentMethod): string {
  return method === 'cash' ? codes.cash : codes.bank;
}

/** Id of the default cash/bank account for a method, or null when no account carries that code. */
export async function defaultAccountIdFor(
  ctx: Context,
  method: PaymentMethod,
): Promise<{ code: string; id: string | null }> {
  const codes = await loadPaymentAccountCodes(ctx);
  const wanted = defaultAccountCodeFor(codes, method);
  const byCode = await idsByCode(ctx, [wanted]);
  return { code: wanted, id: byCode.get(wanted) ?? null };
}
