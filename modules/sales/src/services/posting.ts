// Pure: journal lines for a submitted invoice (spec AC-3). Dr 売掛金 (total) / Cr 売上高 (per invoice line when
// prices are 税抜; per rate group when 税込, because the per-line 税抜 amounts are unrounded and would not sum to the
// once-per-rate rounded group) / Cr 仮受消費税 (one line per rate). Negative amounts (値引き行) flip to the other side
// because journal_line.debit/credit are >= 0.
import { Decimal, ValidationError, type DecimalInput } from '@daifuku/kernel';
import type { TaxCategory } from '@daifuku/mod-tax';
import type { InvoiceTaxSummaryRow } from '../entities/sales-invoice.ts';
import { rateOfCategory } from './recalculate.ts';

/** Account ids resolved from the `sales.accounts` codes. */
export interface PostingAccounts {
  receivable: string;
  revenue: string;
  taxPayable: string;
}

export interface PostingLine {
  ext?: Record<string, unknown>;
  seq: number;
  description: string;
  amount: DecimalInput;
  taxCategory: TaxCategory;
}

export interface PostingInput {
  partnerId: string;
  priceIncludesTax: boolean;
  lines: readonly PostingLine[];
  taxSummary: readonly InvoiceTaxSummaryRow[];
  total: DecimalInput;
}

/** Shape accepted by `postFromSource` (accounting `LineInput`), with Decimal amounts. */
export interface JournalLineSpec {
  accountId: string;
  ext?: Record<string, unknown>;
  debit?: Decimal;
  credit?: Decimal;
  partnerId?: string | null;
  taxCategory?: TaxCategory | null;
  taxRate?: Decimal | null;
  memo?: string | null;
}

function side(
  accountId: string,
  credit: Decimal,
  extra: Omit<JournalLineSpec, 'accountId' | 'debit' | 'credit'>,
): JournalLineSpec {
  return credit.isNegative() ? { accountId, debit: credit.abs(), ...extra } : { accountId, credit, ...extra };
}

/** Percent label for memos: '0.1' -> '10%'. */
export function ratePercent(rate: DecimalInput): string {
  return `${Decimal.from(rate).times(100).toString()}%`;
}

function revenueLines(input: PostingInput, accounts: PostingAccounts): JournalLineSpec[] {
  if (input.priceIncludesTax) {
    for (const group of input.taxSummary) {
      const dimensions = input.lines
        .filter((l) => l.taxCategory === group.category)
        .map((l) => JSON.stringify(Object.entries(l.ext ?? {}).sort(([a], [b]) => a.localeCompare(b))));
      if (new Set(dimensions).size > 1)
        throw new ValidationError(
          'Tax-inclusive grouped posting requires consistent line dimensions per tax category',
          [
            {
              path: 'lines.ext',
              message: 'split the invoice or use consistent dimensions; silent dimension loss is not allowed',
            },
          ],
        );
    }
    return input.taxSummary
      .filter((g) => !Decimal.from(g.taxable).isZero())
      .map((g) =>
        side(accounts.revenue, Decimal.from(g.taxable), {
          taxCategory: g.category,
          taxRate: Decimal.from(g.rate),
          memo: `${g.label || g.category} 税抜`,
          ext: input.lines.find((l) => l.taxCategory === g.category)?.ext ?? {},
        }),
      );
  }
  return input.lines
    .filter((l) => !Decimal.from(l.amount).isZero())
    .map((l) =>
      side(accounts.revenue, Decimal.from(l.amount), {
        taxCategory: l.taxCategory,
        taxRate: Decimal.from(rateOfCategory(input.taxSummary, l.taxCategory)),
        memo: l.description,
        ext: l.ext ?? {},
      }),
    );
}

function taxLines(input: PostingInput, accounts: PostingAccounts): JournalLineSpec[] {
  return input.taxSummary
    .filter((g) => !Decimal.from(g.tax).isZero())
    .map((g) =>
      side(accounts.taxPayable, Decimal.from(g.tax), {
        taxCategory: g.category,
        taxRate: Decimal.from(g.rate),
        memo: `仮受消費税 ${ratePercent(g.rate)}`,
      }),
    );
}

/** Journal lines in posting order: receivable, revenue…, tax…. Balanced by construction (Σ = total). */
export function journalLinesFor(input: PostingInput, accounts: PostingAccounts): JournalLineSpec[] {
  const receivable: JournalLineSpec = {
    accountId: accounts.receivable,
    debit: Decimal.from(input.total),
    partnerId: input.partnerId,
    memo: '売掛金',
  };
  return [receivable, ...revenueLines(input, accounts), ...taxLines(input, accounts)];
}

/** Σcredit − Σdebit over the lines; 0 when balanced. Exposed for tests/property checks. */
export function imbalance(lines: readonly JournalLineSpec[]): Decimal {
  return Decimal.sum(lines.map((l) => l.credit ?? Decimal.zero())).minus(
    Decimal.sum(lines.map((l) => l.debit ?? Decimal.zero())),
  );
}
