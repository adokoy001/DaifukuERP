import { describe, expect, it } from 'vitest';
import type { TableResult } from '../api/types.ts';
import { csvFilename, tableToCsv } from './csv.ts';

const result: TableResult = {
  title: { ja: '試算表', en: 'Trial balance' },
  columns: [
    { key: 'code', label: { ja: 'コード', en: 'Code' }, kind: 'text' },
    { key: 'name', label: { ja: '科目名', en: 'Account' }, kind: 'text' },
    { key: 'debit', label: { ja: '借方', en: 'Debit' }, kind: 'decimal' },
  ],
  rows: [
    { code: '100', name: '現金, "小口"', debit: '1000.50' },
    { code: '200', name: 'Line\nbreak', debit: null },
  ],
  totals: { debit: '1000.50' },
};

describe('AC-3 CSV export', () => {
  it('quotes commas/quotes/newlines, keeps decimal strings verbatim, adds totals row, BOM + CRLF', () => {
    const csv = tableToCsv(result, 'ja', '合計');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toEqual(['コード,科目名,借方', '100,"現金, ""小口""",1000.50', '200,"Line\nbreak",', '合計,,1000.50', '']);
    expect(tableToCsv(result, 'en', 'Total').slice(1).split('\r\n')[0]).toBe('Code,Account,Debit');
  });

  it('omits the totals row when the result has none and names the file after the action', () => {
    const { totals: _t, ...noTotals } = result;
    expect(tableToCsv(noTotals, 'ja', '合計').slice(1).split('\r\n')).toHaveLength(4);
    expect(csvFilename('accounting.trial_balance', new Date('2026-09-10T01:02:03Z'))).toBe('accounting_trial_balance_20260910010203.csv');
  });

  it('web-phase15 AC-7: totals that match no column are appended as key,value rows; no empty totals row for them', () => {
    const summary: TableResult = { ...result, totals: { output_tax_total: '100', 'net,due': '100.5' } };
    expect(tableToCsv(summary, 'ja', '合計').slice(1).split('\r\n')).toEqual(['コード,科目名,借方', '100,"現金, ""小口""",1000.50', '200,"Line\nbreak",', 'output_tax_total,100', '"net,due",100.5', '']);
    const mixed: TableResult = { ...result, totals: { debit: '1000.50', net_tax_due: '7' } };
    expect(tableToCsv(mixed, 'en', 'Total').slice(1).split('\r\n').slice(-3)).toEqual(['Total,,1000.50', 'net_tax_due,7', '']);
  });
});
