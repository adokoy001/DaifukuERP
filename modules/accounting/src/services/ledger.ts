// Trial balance rows and running balances (spec AC-8, AC-9). Pure: takes already-aggregated movements.
// Balances are debit-positive (借方 +, 貸方 −) regardless of account type; sign presentation is a UI concern.
import { Decimal } from '@daifuku/kernel';
import type { LineAmounts } from './balance.ts';

export interface AccountInfo {
  id: string;
  code: string;
  name: string;
  type: string;
}

export type Movement = LineAmounts;

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  /** opening net + period debit − period credit, debit-positive. */
  closingBalance: string;
};

export const TRIAL_BALANCE_AMOUNT_KEYS = [
  'openingDebit',
  'openingCredit',
  'periodDebit',
  'periodCredit',
  'closingBalance',
] as const;
type AmountKey = (typeof TRIAL_BALANCE_AMOUNT_KEYS)[number];

const ZERO: Movement = { debit: Decimal.zero(), credit: Decimal.zero() };

/** An opening balance is shown on one side only: the net of everything before the period. */
export function splitOpening(before: Movement): { openingDebit: Decimal; openingCredit: Decimal } {
  const net = before.debit.minus(before.credit);
  return net.isNegative()
    ? { openingDebit: Decimal.zero(), openingCredit: net.neg() }
    : { openingDebit: net, openingCredit: Decimal.zero() };
}

/** One row per account in the given order; `opening`/`period` are keyed by account id and may omit idle accounts. */
export function trialBalanceRows(
  accounts: readonly AccountInfo[],
  opening: ReadonlyMap<string, Movement>,
  period: ReadonlyMap<string, Movement>,
): { rows: TrialBalanceRow[]; totals: Record<AmountKey, string> } {
  const sums: Record<AmountKey, Decimal> = {
    openingDebit: Decimal.zero(),
    openingCredit: Decimal.zero(),
    periodDebit: Decimal.zero(),
    periodCredit: Decimal.zero(),
    closingBalance: Decimal.zero(),
  };
  const rows = accounts.map((a) => {
    const before = opening.get(a.id) ?? ZERO;
    const during = period.get(a.id) ?? ZERO;
    const { openingDebit, openingCredit } = splitOpening(before);
    const amounts: Record<AmountKey, Decimal> = {
      openingDebit,
      openingCredit,
      periodDebit: during.debit,
      periodCredit: during.credit,
      closingBalance: openingDebit.minus(openingCredit).plus(during.debit).minus(during.credit),
    };
    for (const k of TRIAL_BALANCE_AMOUNT_KEYS) sums[k] = sums[k].plus(amounts[k]);
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      openingDebit: amounts.openingDebit.toString(),
      openingCredit: amounts.openingCredit.toString(),
      periodDebit: amounts.periodDebit.toString(),
      periodCredit: amounts.periodCredit.toString(),
      closingBalance: amounts.closingBalance.toString(),
    };
  });
  const totals = Object.fromEntries(TRIAL_BALANCE_AMOUNT_KEYS.map((k) => [k, sums[k].toString()])) as Record<
    AmountKey,
    string
  >;
  return { rows, totals };
}

/** Running balance after each line, starting from `opening` (debit-positive). */
export function runningBalances(opening: Decimal, lines: readonly LineAmounts[]): Decimal[] {
  const out: Decimal[] = [];
  let balance = opening;
  for (const l of lines) {
    balance = balance.plus(l.debit).minus(l.credit);
    out.push(balance);
  }
  return out;
}
