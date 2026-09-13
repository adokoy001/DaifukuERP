import { describe, expect, it } from 'vitest';
import type { TableResult } from '../api/types.ts';
import { columnTotals, extraTotals, reportTitle, reportDateErrors, reportInitialValues, reportInputFields, reportPeriodLabel, reportPeriodOptions, reportPeriodValues, reportRowsPage } from './report.ts';
import { schemaFields, schemaInitialValues, schemaToPayload } from './schema.ts';

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

describe('report period controls', () => {
  const date = { type: 'string', format: 'date' };
  const fields = schemaFields({ type: 'object', properties: { from: date, to: date, asOf: date, period: { type: 'string' }, year: { type: 'integer' }, accountId: { type: 'string', format: 'uuid' } } }, () => undefined);
  const now = new Date('2026-09-13T03:00:00Z');
  it('initializes actual date/month/year inputs but never fabricates references', () => {
    expect(reportInitialValues(fields, now)).toEqual({ from: '2026-09-01', to: '2026-09-13', asOf: '2026-09-13', period: '2026-09', year: 2026 });
    expect(reportPeriodOptions(fields)).toEqual(['current', 'previous', 'last12']);
  });
  it('resolves inclusive calendar periods across year boundaries, leap years and the Japanese midnight', () => {
    expect(reportPeriodValues(fields, 'previous', new Date('2025-01-10T00:00:00Z'))).toMatchObject({ from: '2024-12-01', to: '2024-12-31', period: '2024-12', year: 2024 });
    expect(reportPeriodValues(fields, 'previous', new Date('2024-03-01T00:00:00Z'))).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(reportPeriodValues(fields, 'current', new Date('2026-09-30T15:00:00Z'))).toMatchObject({ from: '2026-10-01', to: '2026-10-01' });
    expect(reportPeriodValues(fields, 'last12', now)).toMatchObject({ from: '2025-10-01', to: '2026-09-13' });
  });
  it('preserves explicit schema defaults including null/false, and leaves unrelated fields empty', () => {
    const input = schemaFields({ type: 'object', properties: { from: { ...date, default: '2026-01-01' }, to: date, asOf: { ...date, default: null }, includeDraft: { type: 'boolean', default: false }, fiscalYearId: { type: 'string', format: 'uuid' } } }, () => undefined);
    const defaults = reportInitialValues(input, now);
    expect(defaults).toEqual({ to: '2026-09-13' });
    expect(schemaInitialValues(input, defaults)).toEqual({ from: '2026-01-01', to: '2026-09-13', asOf: '', includeDraft: false, fiscalYearId: '' });
    expect(schemaToPayload(schemaInitialValues(fields, reportInitialValues(fields, now)), fields).payload.year).toBe(2026);
  });
  it('preserves specific schema labels and only translates generated labels', () => {
    const input = schemaFields({ type: 'object', properties: { from: { ...date, title: '完了期間の開始日' }, to: date, period: { type: 'string' } } }, () => undefined);
    expect(reportInputFields(input).map((field) => field.label.ja)).toEqual(['完了期間の開始日', '終了日', '対象月（YYYY-MM）']);
    expect(input[1]?.label.ja).toBe('To');
  });
  it('only offers a multi-month shortcut when both date boundaries exist', () => {
    expect(reportPeriodOptions(fields.filter((field) => field.name === 'period'))).toEqual(['current', 'previous']);
    expect(reportPeriodOptions(fields.filter((field) => field.name === 'accountId'))).toEqual([]);
  });
  it('labels and resolves a year-only period differently from a monthly report or an as-of date', () => {
    const year = fields.filter((field) => field.name === 'year');
    expect(reportPeriodValues(year, 'previous', now)).toEqual({ year: 2025 });
    expect(reportPeriodLabel(year, 'previous').ja).toBe('前年');
    expect(reportPeriodLabel(fields.filter((field) => field.name === 'asOf'), 'current').ja).toBe('今日');
    expect(reportPeriodLabel(fields.filter((field) => field.name === 'asOf'), 'previous').ja).toBe('先月末');
    expect(reportPeriodLabel(fields, 'last12').ja).toBe('直近12か月');
  });
  it('rejects impossible dates and reversed boundaries, accepting omitted optional dates and the same day', () => {
    expect(reportDateErrors({ from: '2026-09-14', to: '2026-09-13' }, fields, 'ja').to).toContain('開始日以降');
    expect(reportDateErrors({ from: '2026-02-30', to: '2026-09-13' }, fields, 'en').from).toContain('valid date');
    expect(reportDateErrors({ from: '2026-09-13', to: '2026-09-13' }, fields, 'ja')).toEqual({});
    expect(reportDateErrors({}, fields, 'ja')).toEqual({});
  });
});

describe('returned report rows search, sort and pagination', () => {
  const result: TableResult = {
    title: { ja: 'テスト', en: 'Test' },
    columns: [
      { key: 'name', kind: 'text', label: { ja: '名称', en: 'Name' } },
      { key: 'amount', kind: 'decimal', label: { ja: '金額', en: 'Amount' } },
    ],
    rows: Array.from({ length: 127 }, (_, i) => ({ name: `拠点${i}`, amount: `${i}.000001` })),
    totals: { amount: '8001.000127' },
  };
  it('bounds the DOM page and clamps empty, negative, oversized and non-finite page requests', () => {
    expect(reportRowsPage(result)).toMatchObject({ matched: 127, page: 0, pages: 3, from: 1, to: 50 });
    expect(reportRowsPage(result, { page: 9 })).toMatchObject({ page: 2, from: 101, to: 127 });
    expect(reportRowsPage(result, { page: -2 }).page).toBe(0);
    expect(reportRowsPage(result, { page: Infinity }).page).toBe(0);
    expect(reportRowsPage(result, { pageSize: 50000 }).rows).toHaveLength(50);
    expect(reportRowsPage(result, { pageSize: 25 }).rows).toHaveLength(25);
    expect(reportRowsPage(result, { query: 'not-found' })).toMatchObject({ matched: 0, page: 0, pages: 1, from: 0, to: 0, rows: [] });
  });
  it('sorts huge and negative decimal values exactly, preserves ties and puts missing cells last in either direction', () => {
    const exact = { ...result, rows: ['9007199254740993.000001', '9007199254740993.000002', '-0.000002', '-0.000001', '1', '1.000000', null].map((amount, i) => ({ amount, name: String(i) })) };
    expect(reportRowsPage(exact, { sort: { key: 'amount', direction: 'asc' } }).rows.map(({ index }) => index)).toEqual([2, 3, 4, 5, 0, 1, 6]);
    expect(reportRowsPage(exact, { sort: { key: 'amount', direction: 'desc' } }).rows.map(({ index }) => index)).toEqual([1, 0, 4, 5, 3, 2, 6]);
  });
  it('searches normalized raw and displayed values while preserving server totals, references and source row order', () => {
    const original = JSON.stringify(result);
    const view = reportRowsPage(result, { query: '拠点１２６', sort: { key: 'amount', direction: 'desc' }, page: 8 });
    expect(view).toMatchObject({ matched: 1, page: 0, from: 1, to: 1 });
    expect(view.rows[0]?.row).toBe(result.rows[126]);
    expect(reportRowsPage(result, { query: 'JAPAN', cellText: (_column, value) => value === '拠点0' ? 'Japan' : '' }).matched).toBe(1);
    expect(JSON.stringify(result)).toBe(original);
    expect(columnTotals(result)).toEqual({ amount: '8001.000127' });
  });
  it('orders text naturally and handles invalid numeric strings without breaking the table', () => {
    const source = { ...result, rows: [{ name: 'item10', amount: 'N/A' }, { name: 'item2', amount: '2' }, { name: 'item1', amount: '' }] };
    expect(reportRowsPage(source, { sort: { key: 'name', direction: 'asc' }, locale: 'en' }).rows.map(({ row }) => row.name)).toEqual(['item1', 'item2', 'item10']);
    expect(reportRowsPage(source, { sort: { key: 'amount', direction: 'desc' } }).rows).toHaveLength(3);
    expect(reportRowsPage(source, { sort: { key: 'unknown', direction: 'asc' } }).rows.map(({ index }) => index)).toEqual([0, 1, 2]);
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
