import { Decimal } from '@daifuku/kernel';
import { issue } from './common.ts';
interface Period {
  startDate: string;
  endDate: string;
}
interface Entry {
  id: string;
  docstatus: number;
  totalDebit: Decimal;
  totalCredit: Decimal;
}
interface Line {
  entryId: string;
  debit: Decimal;
  credit: Decimal;
}
/** Independently cross-check the persisted posting header, not only net ledger balance. */
export function ledgerIntegrityIssues(year: Period, periods: Period[], entries: Entry[], lines: Line[]) {
  const issues = [];
  const ordered = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  let next = year.startDate;
  for (const period of ordered) {
    if (period.startDate !== next || period.endDate < period.startDate || period.endDate > year.endDate)
      issues.push(issue('period_coverage', '会計期間に欠落・重複または年度との不一致があります。'));
    next = new Date(new Date(period.endDate + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  }
  if (!ordered.length || ordered.at(-1)?.endDate !== year.endDate)
    issues.push(issue('period_coverage', '年度全体を覆う会計期間がありません。'));
  const sums = new Map<string, { debit: Decimal; credit: Decimal; count: number }>();
  for (const line of lines) {
    const v = sums.get(line.entryId) ?? { debit: Decimal.from(0), credit: Decimal.from(0), count: 0 };
    v.debit = v.debit.plus(line.debit);
    v.credit = v.credit.plus(line.credit);
    v.count++;
    sums.set(line.entryId, v);
  }
  for (const entry of entries.filter((e) => e.docstatus === 1)) {
    const v = sums.get(entry.id);
    if (!v || v.count < 2 || !v.debit.eq(v.credit) || !v.debit.eq(entry.totalDebit) || !v.credit.eq(entry.totalCredit))
      issues.push(
        issue('posting_totals', '転記済み仕訳の明細合計が借貸または保存済み仕訳合計と一致しません。', entry.id),
      );
  }
  return issues;
}
