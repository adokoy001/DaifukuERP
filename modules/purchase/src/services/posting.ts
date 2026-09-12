// Journal lines for a submitted bill (docs/specs/purchase.md AC-3). Pure: accounts arrive as ids, amounts as Decimal.
//   Dr expense / purchases   one line per (account, rate group): the group's taxable share of that account
//   Dr 仮払消費税             one line per rate group: deductibleTax
//   Dr expense (first line's account)  控除対象外消費税: Σ nonDeductibleTax (one line, memo fixed)
//   Cr 買掛金                 total, with the supplier as partner
// Under 税込 the rounded group tax is allocated across the accounts of the group (rounded per account, remainder on the
// last account) so that Σ debits equals the group's taxable exactly and the entry always balances.
import { Decimal, type RoundingMode } from '@daifuku/kernel';
import type { LineInput } from '@daifuku/mod-accounting';
import type { TaxCategory } from '@daifuku/mod-tax';
import type { CreditGroup, PurchaseTotals } from './recalculate.ts';

export interface PostingLine {
  ext?: Record<string, unknown>;
  productId: string | null;
  accountId: string | null;
  amount: Decimal;
  taxCategory: TaxCategory;
}

/** Resolved account ids (from setting `purchase.accounts`). */
export interface PostingAccounts {
  purchases: string;
  payable: string;
  taxReceivable: string;
}

export interface PostingInput {
  partnerId: string;
  priceIncludesTax: boolean;
  rounding: { mode: RoundingMode; scale: number };
  lines: readonly PostingLine[];
  groups: readonly CreditGroup[];
  totals: PurchaseTotals;
  accounts: PostingAccounts;
}

export const NON_DEDUCTIBLE_MEMO = '控除対象外消費税';
export const INPUT_TAX_MEMO = '仮払消費税';

interface Bucket {
  ext: Record<string, unknown>;
  accountId: string;
  category: TaxCategory;
  rate: Decimal;
  sum: Decimal;
}

const ONE = Decimal.from(1);

/** Expense lines use their account; product lines fall back to the purchases account. An explicit account wins. */
export function lineAccount(line: Pick<PostingLine, 'accountId' | 'productId'>, accounts: Pick<PostingAccounts, 'purchases'>): string {
  return line.accountId ?? accounts.purchases;
}

function groupKey(category: string, rate: Decimal): string {
  return `${category}|${rate.toString()}`;
}

/** Σ amount per (account, category, rate), in first-appearance order. */
function bucketsOf(input: PostingInput): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const line of input.lines) {
    const group = input.groups.find((g) => g.category === line.taxCategory);
    const rate = group?.rate ?? Decimal.zero();
    const accountId = lineAccount(line, input.accounts);
    const ext = line.ext ?? {};
    const dimensionKey = JSON.stringify(Object.entries(ext).sort(([a], [b]) => a.localeCompare(b)));
    const key = `${accountId}|${groupKey(line.taxCategory, rate)}|${dimensionKey}`;
    const b = map.get(key) ?? { accountId, ext, category: line.taxCategory, rate, sum: Decimal.zero() };
    b.sum = b.sum.plus(line.amount);
    map.set(key, b);
  }
  return [...map.values()];
}

/** Taxable amount per bucket of one group. 税抜: the sums themselves. 税込: sum − allocated share of the rounded tax. */
function taxableByBucket(buckets: Bucket[], group: CreditGroup, input: PostingInput): Decimal[] {
  if (!input.priceIncludesTax || group.tax.isZero()) return buckets.map((b) => b.sum);
  const { mode, scale } = input.rounding;
  const allocated: Decimal[] = [];
  let remaining = group.tax;
  buckets.forEach((b, i) => {
    const share = i === buckets.length - 1 ? remaining : b.sum.times(group.rate).div(ONE.plus(group.rate)).round(mode, scale);
    allocated.push(share);
    remaining = remaining.minus(share);
  });
  return buckets.map((b, i) => b.sum.minus(allocated[i] ?? Decimal.zero()));
}

/** A signed amount becomes a debit when positive and a credit when negative (credit notes post mirrored). */
function debitLine(accountId: string, amount: Decimal, extra: Omit<LineInput, 'accountId' | 'debit' | 'credit'> = {}): LineInput {
  return amount.isNegative() ? { accountId, credit: amount.abs(), ...extra } : { accountId, debit: amount, ...extra };
}
function creditLine(accountId: string, amount: Decimal, extra: Omit<LineInput, 'accountId' | 'debit' | 'credit'> = {}): LineInput {
  return debitLine(accountId, amount.neg(), extra);
}

/** AC-3: the balanced line set to hand to accounting `postFromSource`. Zero amounts produce no line. */
export function buildJournalLines(input: PostingInput): LineInput[] {
  const out: LineInput[] = [];
  const buckets = bucketsOf(input);
  for (const group of input.groups) {
    const own = buckets.filter((b) => groupKey(b.category, b.rate) === groupKey(group.category, group.rate));
    const taxable = taxableByBucket(own, group, input);
    own.forEach((b, i) => {
      const amount = taxable[i] ?? Decimal.zero();
      if (!amount.isZero()) out.push(debitLine(b.accountId, amount, { taxCategory: b.category, taxRate: b.rate, ext: b.ext }));
    });
    if (!group.deductibleTax.isZero()) {
      out.push(debitLine(input.accounts.taxReceivable, group.deductibleTax, { taxCategory: group.category, taxRate: group.rate, memo: `${INPUT_TAX_MEMO} ${group.label}`.trim() }));
    }
  }
  const first = buckets[0];
  if (!input.totals.nonDeductibleTax.isZero() && first) out.push(debitLine(first.accountId, input.totals.nonDeductibleTax, { memo: NON_DEDUCTIBLE_MEMO, ext: first.ext }));
  if (!input.totals.total.isZero()) out.push(creditLine(input.accounts.payable, input.totals.total, { partnerId: input.partnerId }));
  return out;
}
