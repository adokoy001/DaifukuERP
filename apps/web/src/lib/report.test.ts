import { describe, expect, it } from 'vitest';
import type { TableResult } from '../api/types.ts';
import { columnTotals, extraTotals, reportTitle } from './report.ts';

describe('AC-3 reportTitle', () => {
  it('uses the first clause of the description in each language and falls back to the action name', () => {
    const t = reportTitle({
      name: 'accounting.trial_balance',
      description: { ja: '試算表を返します。勘定科目ごとに、期首残高…', en: 'Trial balance: per account, opening balance before `from`.' },
    });
    expect(t).toEqual({ ja: '試算表', en: 'Trial balance' });
    expect(reportTitle({ name: 'tax.summary', description: { ja: '消費税集計表を返します。', en: 'Tax summary.' } })).toEqual({ ja: '消費税集計表', en: 'Tax summary' });
    expect(reportTitle({ name: 'x.y', description: { ja: '返します', en: 'Returns' } }).ja).toBe('返します');
    expect(reportTitle({ name: 'x.y', description: { ja: '', en: '' } })).toEqual({ ja: 'x.y', en: 'x.y' });
    expect(reportTitle({ name: 'x.y', description: { ja: 'あ'.repeat(40), en: 'a'.repeat(40) } }).en).toBe(`${'a'.repeat(32)}…`);
  });
});

describe('web-phase15 AC-7 totals that match no column', () => {
  // Shape of accounting.tax_period_summary as returned by the dev API (2026-09-11).
  const summary: TableResult = {
    title: { ja: '消費税集計', en: 'Tax period summary' },
    columns: [
      { key: 'side', label: { ja: '区分', en: 'Side' }, kind: 'text' },
      { key: 'taxableAmount', label: { ja: '課税標準', en: 'Taxable' }, kind: 'decimal' },
      { key: 'taxAmount', label: { ja: '税額', en: 'Tax' }, kind: 'decimal' },
    ],
    rows: [{ side: 'output', taxableAmount: '1000', taxAmount: '100' }],
    totals: { output_tax_total: '100', input_tax_total: '0', net_tax_due: '100' },
  };
  it('splits totals into column totals and extra key/value totals, keeping the server order', () => {
    expect(columnTotals(summary)).toEqual({});
    expect(extraTotals(summary)).toEqual([
      ['output_tax_total', '100'],
      ['input_tax_total', '0'],
      ['net_tax_due', '100'],
    ]);
    const mixed = { ...summary, totals: { taxAmount: '100', net_tax_due: '100' } };
    expect(columnTotals(mixed)).toEqual({ taxAmount: '100' });
    expect(extraTotals(mixed)).toEqual([['net_tax_due', '100']]);
    const { totals: _t, ...none } = summary;
    expect(extraTotals(none)).toEqual([]);
  });
});
