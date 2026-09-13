import { describe, expect, it } from 'vitest';
import type { AnalyticsDataset } from '../api/analytics.ts';
import { analyticsTemplates, defaultAnalytics, isIsoDate, periodDates, settingsDates, validSettingsForDataset, type AnalyticsSettings } from './analytics.ts';

const dataset: AnalyticsDataset = {
  id: 'sales', title: { ja: '売上', en: 'Sales' }, description: { ja: '確定した請求', en: 'Submitted invoices' }, grain: { ja: '請求1件', en: 'One invoice' },
  dateField: 'date', dimensions: [{ key: 'date', label: { ja: '請求日', en: 'Invoice date' }, kind: 'date' }, { key: 'partner', label: { ja: '取引先', en: 'Customer' }, kind: 'text' }],
  measures: [{ key: 'amount', label: { ja: '金額', en: 'Amount' }, kind: 'decimal' }], defaultRows: ['partner'], defaultColumns: ['date'], defaultMeasure: 'amount', defaultState: 'submitted',
  states: [{ value: 'submitted', label: { ja: '確定', en: 'Submitted' } }, { value: 'draft', label: { ja: '下書き', en: 'Draft' } }],
};
describe('analysis business dates and useful defaults', () => {
  it('changes month at midnight in Japan, independent of the browser time zone', () => {
    expect(periodDates('month', new Date('2026-09-30T14:59:59.999Z'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodDates('month', new Date('2026-09-30T15:00:00.000Z'))).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });
  it('includes the current partial month within 12 and 24 calendar months', () => {
    const now = new Date('2026-09-13T04:00:00Z');
    expect(periodDates('12-months', now)).toEqual({ from: '2025-10-01', to: '2026-09-13' });
    expect(periodDates('24-months', now)).toEqual({ from: '2024-10-01', to: '2026-09-13' });
  });
  it('resolves previous month across leap years and January boundaries', () => {
    expect(periodDates('previous-month', new Date('2024-03-01T00:00:00Z'))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(periodDates('previous-month', new Date('2025-03-01T00:00:00Z'))).toEqual({ from: '2025-02-01', to: '2025-02-28' });
    expect(periodDates('previous-month', new Date('2026-01-01T00:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('re-resolves saved relative dates at recall while preserving custom dates', () => {
    const settings = defaultAnalytics(dataset, new Date('2024-01-15T00:00:00Z'));
    expect(settings.from).toBe('2023-02-01');
    expect(settingsDates(settings, new Date('2026-09-13T00:00:00Z'))).toEqual({ from: '2025-10-01', to: '2026-09-13' });
    expect(settingsDates({ ...settings, period: 'custom', from: '2024-04-01', to: '2025-03-31' }, new Date('2026-09-13T00:00:00Z'))).toEqual({ from: '2024-04-01', to: '2025-03-31' });
    expect(settings.from).toBe('2023-02-01');
  });
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-9-1', '2026/09/01', '2026-09-01T00:00:00Z', ''])('rejects impossible or noncanonical date %s', value => {
    expect(isIsoDate(value)).toBe(false);
  });
  it('uses approved source defaults and derives date grouping from metadata', () => {
    const defaults = defaultAnalytics(dataset, new Date('2026-09-13T00:00:00Z'));
    expect(defaults).toMatchObject({ dataset: 'sales', state: 'submitted', period: '12-months', chart: 'bar', chartMeasure: 0, expandedRows: [], expandedColumns: [] });
    expect(defaults.pivot).toEqual({ rows: [{ field: 'partner', grain: 'value' }], columns: [{ field: 'date', grain: 'month' }], measures: [{ field: 'amount', op: 'sum' }] });
    expect(validSettingsForDataset(defaults, dataset)).toBe(true);
  });
});
describe('templates and source compatibility', () => {
  it('only offers patterns for authorized catalog entries, with usable dimensions', () => {
    expect(analyticsTemplates([])).toEqual([]);
    const templates = analyticsTemplates([dataset], new Date('2026-09-13T00:00:00Z'));
    expect(templates).toHaveLength(2);
    expect(templates.every(template => validSettingsForDataset(template.settings, dataset))).toBe(true);
    expect(templates.find(template => template.id === 'sales-monthly')?.settings).toMatchObject({ chart: 'line', pivot: { rows: [{ field: 'date', grain: 'year' }, { field: 'date', grain: 'month' }], columns: [] } });
  });
  it('rejects a removed source/state/field or a date grain on a text field', () => {
    const defaults = defaultAnalytics(dataset);
    const cases: AnalyticsSettings[] = [
      { ...defaults, dataset: 'private-payroll' }, { ...defaults, state: 'removed-state' },
      { ...defaults, pivot: { ...defaults.pivot, rows: [{ field: 'secret' }] } },
      { ...defaults, pivot: { ...defaults.pivot, columns: [{ field: 'partner', grain: 'year' }] } },
      { ...defaults, pivot: { ...defaults.pivot, measures: [{ field: 'secret-amount', op: 'sum' }] } },
    ];
    for (const settings of cases) expect(validSettingsForDataset(settings, dataset)).toBe(false);
  });
});
