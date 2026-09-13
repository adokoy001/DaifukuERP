// Double-entry invariants (spec AC-4, AC-6, ADR-0005). Pure: no DB, Decimal only.
import { Decimal } from '@daifuku/kernel';

/** Same shape as the kernel's ValidationError issues (the type itself is not exported from the kernel index). */
export interface Issue {
  path: string;
  message: string;
}

export interface LineAmounts {
  debit: Decimal;
  credit: Decimal;
}

/** What the submit-time validation needs to know about one line. */
export interface LineCheck extends LineAmounts {
  seq: number;
  partnerId: string | null;
  /** From the line's account (`account.partnerRequired`). */
  partnerRequired: boolean;
}

export interface LineTotals {
  totalDebit: Decimal;
  totalCredit: Decimal;
}

export interface LineValidation extends LineTotals {
  issues: Issue[];
  balanced: boolean;
}

export const MIN_LINES = 2;

/** A line must carry exactly one positive side (debit XOR credit); negatives are rejected by the field's min '0'. */
export function xorIssue(line: LineAmounts, path: string): Issue | null {
  const d = line.debit;
  const c = line.credit;
  if (d.isNegative() || c.isNegative()) return { path, message: 'debit and credit must not be negative' };
  const hasDebit = d.gt(0);
  const hasCredit = c.gt(0);
  if (hasDebit && hasCredit) return { path, message: 'a line carries either a debit or a credit, not both' };
  if (!hasDebit && !hasCredit) return { path, message: 'a line must carry a debit or a credit greater than 0' };
  return null;
}

export function sumLines(lines: Iterable<LineAmounts>): LineTotals {
  let totalDebit = Decimal.zero();
  let totalCredit = Decimal.zero();
  for (const l of lines) {
    totalDebit = totalDebit.plus(l.debit);
    totalCredit = totalCredit.plus(l.credit);
  }
  return { totalDebit, totalCredit };
}

/** Exact Decimal comparison: no tolerance (ADR-0010). */
export function isBalanced(lines: Iterable<LineAmounts>): boolean {
  const t = sumLines(lines);
  return t.totalDebit.eq(t.totalCredit);
}

/** Every rule the before_submit hook applies to the line set, as one list of field-addressed issues. */
export function validateLines(lines: readonly LineCheck[]): LineValidation {
  const issues: Issue[] = [];
  if (lines.length < MIN_LINES)
    issues.push({ path: 'lines', message: `a journal entry needs at least ${MIN_LINES} lines` });
  lines.forEach((l, i) => {
    const path = `lines[${i}]`;
    const xor = xorIssue(l, path);
    if (xor) issues.push(xor);
    if (l.partnerRequired && !l.partnerId)
      issues.push({ path: `${path}.partnerId`, message: `line ${l.seq}: the account requires a partner` });
  });
  const totals = sumLines(lines);
  const balanced = totals.totalDebit.eq(totals.totalCredit);
  if (!balanced) {
    issues.push({
      path: 'lines',
      message: `debits (${totals.totalDebit.toString()}) and credits (${totals.totalCredit.toString()}) differ by ${totals.totalDebit.minus(totals.totalCredit).toString()}`,
    });
  }
  return { ...totals, issues, balanced };
}

/** Reversal (逆仕訳): every line with debit and credit swapped; everything else untouched (ADR-0005). */
export function reverseLines<T extends LineAmounts>(lines: readonly T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** Net movement per key (debit − credit), for invariants such as "a reversal leaves every account's net unchanged". */
export function netByKey<T extends LineAmounts>(lines: Iterable<T>, keyOf: (l: T) => string): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const l of lines) {
    const k = keyOf(l);
    out.set(k, (out.get(k) ?? Decimal.zero()).plus(l.debit).minus(l.credit));
  }
  return out;
}
