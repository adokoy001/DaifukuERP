import { describe, it, expect } from 'vitest';
import { Decimal } from '@daifuku/kernel';
import { ledgerIntegrityIssues } from '../src/ledger-validation.ts';
const D = Decimal.from,
  year = { startDate: '2026-01-01', endDate: '2026-12-31' };
const entries = [{ id: '1', docstatus: 1, totalDebit: D(100), totalCredit: D(100) }],
  lines = [
    { entryId: '1', debit: D(100), credit: D(0) },
    { entryId: '1', debit: D(0), credit: D(100) },
  ];
describe('independent ledger evidence checks', () => {
  it('requires complete, non-overlapping annual period coverage', () => {
    expect(ledgerIntegrityIssues(year, [year], entries, lines)).toEqual([]);
    for (const periods of [
      [],
      [{ ...year, startDate: '2026-02-01' }],
      [{ ...year, endDate: '2026-11-30' }],
      [year, year],
    ])
      expect(ledgerIntegrityIssues(year, periods, entries, lines).map((i) => i.code)).toContain('period_coverage');
  });
  it('detects omitted balanced lines or changed posting totals even if net ledger balance remains zero', () => {
    expect(ledgerIntegrityIssues(year, [year], entries, []).map((i) => i.code)).toContain('posting_totals');
    const balancedWrong = lines.map((r) => ({ ...r, debit: r.debit.times(2), credit: r.credit.times(2) }));
    expect(ledgerIntegrityIssues(year, [year], entries, balancedWrong).map((i) => i.code)).toContain('posting_totals');
  });
});
