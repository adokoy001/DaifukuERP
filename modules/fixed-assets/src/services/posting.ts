// Journal lines of depreciation runs and disposals (docs/specs/fixed-assets.md AC-12, AC-18, AC-19; D8, D19). Pure:
// account ids and amounts in, LineInput-shaped rows out (accounting.postFromSource validates and posts them).
import { Decimal } from '@daifuku/kernel';
import type { TaxCategory } from '@daifuku/mod-accounting';

export interface JournalLineSpec {
  accountId: string;
  debit?: Decimal;
  credit?: Decimal;
  partnerId?: string | null;
  taxCategory?: TaxCategory | null;
  taxRate?: Decimal | null;
  memo?: string | null;
}

const ZERO = Decimal.zero();
/** D19: depreciation and loss debits are 不課税 (the default tax category of 6700 / 8200 / 8300 in the JP chart). */
const OUT_OF_SCOPE = { taxCategory: 'out_of_scope', taxRate: ZERO } as const;

export interface RunLineAmount {
  expenseAccountId: string;
  accumulatedAccountId: string;
  amount: Decimal;
}

/** AC-12: one debit per expense account, one credit per accumulated-depreciation account (zero amounts dropped). */
export function runJournalLines(lines: readonly RunLineAmount[], memo: string): JournalLineSpec[] {
  const debits = new Map<string, Decimal>();
  const credits = new Map<string, Decimal>();
  for (const l of lines) {
    if (l.amount.isZero()) continue;
    debits.set(l.expenseAccountId, (debits.get(l.expenseAccountId) ?? ZERO).plus(l.amount));
    credits.set(l.accumulatedAccountId, (credits.get(l.accumulatedAccountId) ?? ZERO).plus(l.amount));
  }
  return [
    ...[...debits].map(([accountId, debit]) => ({ accountId, debit, ...OUT_OF_SCOPE, memo })),
    ...[...credits].map(([accountId, credit]) => ({ accountId, credit, memo })),
  ];
}

export interface DisposalPostingInput {
  kind: 'retirement' | 'sale';
  cost: Decimal;
  /** Disposal-year depreciation (AC-18). */
  yearDepreciation: Decimal;
  /** Accumulated depreciation at disposal, including `yearDepreciation`. */
  accumulated: Decimal;
  /** cost − accumulated. */
  bookValue: Decimal;
  accounts: {
    asset: string;
    accumulated: string;
    expense: string;
    lossOnRetirement: string;
    gainOnSale: string;
    lossOnSale: string;
    outputTax: string;
    proceeds: string | null;
  };
  /** Sale only. */
  proceeds: Decimal;
  tax: Decimal;
  taxCategory: TaxCategory | null;
  taxRate: Decimal | null;
  partnerId: string | null;
  memo: string;
}

/** AC-18 / AC-19: retirement or sale, in the spec's line order; zero lines are not created. */
export function disposalJournalLines(input: DisposalPostingInput): JournalLineSpec[] {
  const { accounts: a, memo } = input;
  const out: JournalLineSpec[] = [];
  const push = (line: JournalLineSpec, amount: Decimal) => {
    if (amount.gt(0)) out.push({ ...line, memo });
  };
  push({ accountId: a.expense, debit: input.yearDepreciation, ...OUT_OF_SCOPE }, input.yearDepreciation);
  push({ accountId: a.accumulated, credit: input.yearDepreciation }, input.yearDepreciation);
  if (a.accumulated === a.asset) {
    // Direct method (software): the asset account already carries the depreciation, so only the book value leaves it.
    push({ accountId: a.asset, credit: input.bookValue }, input.bookValue);
  } else {
    push({ accountId: a.accumulated, debit: input.accumulated }, input.accumulated);
    push({ accountId: a.asset, credit: input.cost }, input.cost);
  }
  if (input.kind === 'retirement') {
    push({ accountId: a.lossOnRetirement, debit: input.bookValue, ...OUT_OF_SCOPE }, input.bookValue);
    return out;
  }
  if (!a.proceeds) throw new Error('sale requires a proceeds account');
  const category = input.taxCategory;
  const rate = input.taxRate ?? ZERO;
  push(
    { accountId: a.proceeds, debit: input.proceeds.plus(input.tax), partnerId: input.partnerId },
    input.proceeds.plus(input.tax),
  );
  push({ accountId: a.outputTax, credit: input.tax, taxCategory: category, taxRate: rate }, input.tax);
  push({ accountId: a.gainOnSale, credit: input.proceeds, taxCategory: category, taxRate: rate }, input.proceeds);
  // D8: the untagged debit leaves only the gain on the gain account while the tagged credit carries the taxable base.
  const offset = input.proceeds.lte(input.bookValue) ? input.proceeds : input.bookValue;
  push({ accountId: a.gainOnSale, debit: offset }, offset);
  const loss = input.bookValue.minus(input.proceeds);
  push({ accountId: a.lossOnSale, debit: loss, ...OUT_OF_SCOPE }, loss);
  return out;
}

/** Σdebit − Σcredit (0 for a balanced entry). */
export function imbalance(lines: readonly JournalLineSpec[]): Decimal {
  return lines.reduce((s, l) => s.plus(l.debit ?? ZERO).minus(l.credit ?? ZERO), ZERO);
}
