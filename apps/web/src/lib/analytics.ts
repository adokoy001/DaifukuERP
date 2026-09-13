import type { AnalyticsDataset } from '../api/analytics.ts';
import type { Label } from '../api/types.ts';
import type { PivotAxis, PivotConfig } from './pivot.ts';
import { businessToday } from './operations.ts';

export type AnalyticsPeriod = 'month' | 'previous-month' | '12-months' | '24-months' | 'custom';
export type AnalyticsChart = 'bar' | 'line' | 'none';
export interface AnalyticsSettings {
  dataset: string;
  period: AnalyticsPeriod;
  from: string;
  to: string;
  state: string;
  pivot: PivotConfig;
  chart: AnalyticsChart;
  chartMeasure: number;
  subtotals: boolean;
  expandedRows: string[];
  expandedColumns: string[];
}
export interface AnalyticsTemplate {
  id: string;
  title: Label;
  description: Label;
  settings: AnalyticsSettings;
}
export const PERIODS: { value: AnalyticsPeriod; label: Label }[] = [
  { value: 'month', label: { ja: '今月', en: 'This month' } },
  { value: 'previous-month', label: { ja: '先月', en: 'Last month' } },
  { value: '12-months', label: { ja: '直近12か月', en: 'Last 12 months' } },
  { value: '24-months', label: { ja: '直近24か月', en: 'Last 24 months' } },
  { value: 'custom', label: { ja: '日付を指定', en: 'Custom dates' } },
];
export const OP_LABELS: Record<string, Label> = {
  sum: { ja: '合計', en: 'Sum' },
  avg: { ja: '平均', en: 'Average' },
  min: { ja: '最小', en: 'Minimum' },
  max: { ja: '最大', en: 'Maximum' },
  count: { ja: '値のある件数', en: 'Count of values' },
  rows: { ja: '記録件数', en: 'Record count' },
};
export const GRAIN_LABELS: Record<string, Label> = {
  value: { ja: '値ごと', en: 'Values' },
  year: { ja: '年', en: 'Year' },
  quarter: { ja: '四半期', en: 'Quarter' },
  month: { ja: '年月', en: 'Month' },
  day: { ja: '日', en: 'Day' },
};
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function periodDates(period: AnalyticsPeriod, now = new Date()): { from: string; to: string } {
  const today = businessToday(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const months = period === '24-months' ? 23 : period === '12-months' ? 11 : period === 'previous-month' ? 1 : 0;
  return {
    from: new Date(Date.UTC(year, month - months, 1)).toISOString().slice(0, 10),
    to: period === 'previous-month' ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : today,
  };
}
export function isIsoDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 1 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function settingsDates(settings: AnalyticsSettings, now = new Date()) {
  return settings.period === 'custom' ? { from: settings.from, to: settings.to } : periodDates(settings.period, now);
}
function axis(field: string, dataset: AnalyticsDataset): PivotAxis {
  return dataset.dimensions.find((item) => item.key === field)?.kind === 'date'
    ? { field, grain: 'month' }
    : { field, grain: 'value' };
}
export function defaultAnalytics(dataset: AnalyticsDataset, now = new Date()): AnalyticsSettings {
  return {
    dataset: dataset.id,
    period: '12-months',
    ...periodDates('12-months', now),
    state: dataset.defaultState,
    pivot: {
      rows: dataset.defaultRows.map((key) => axis(key, dataset)),
      columns: dataset.defaultColumns.map((key) => axis(key, dataset)),
      measures: [{ field: dataset.defaultMeasure, op: 'sum' }],
    },
    chart: 'bar',
    chartMeasure: 0,
    subtotals: true,
    expandedRows: [],
    expandedColumns: [],
  };
}
/** Every available dataset has useful monthly and comparative views, using only its actual fields. */
export function analyticsTemplates(datasets: AnalyticsDataset[], now = new Date()): AnalyticsTemplate[] {
  return datasets.flatMap((dataset) => {
    const settings = defaultAnalytics(dataset, now);
    const monthly: AnalyticsSettings = {
      ...settings,
      pivot: {
        ...settings.pivot,
        rows: [
          { field: dataset.dateField, grain: 'year' },
          { field: dataset.dateField, grain: 'month' },
        ],
        columns: [],
      },
      chart: 'line',
    };
    const title = { ja: `${dataset.title.ja}・月次推移`, en: `${dataset.title.en}: monthly trend` };
    const result: AnalyticsTemplate[] = [
      {
        id: `${dataset.id}-monthly`,
        title,
        description: {
          ja: `直近12か月を年→月で確認。${dataset.grain.ja}`,
          en: `Last 12 months, year → month. ${dataset.grain.en}`,
        },
        settings: monthly,
      },
    ];
    if (settings.pivot.rows.length || settings.pivot.columns.length)
      result.push({
        id: `${dataset.id}-comparison`,
        title: { ja: `${dataset.title.ja}・比較`, en: `${dataset.title.en}: comparison` },
        description: dataset.description,
        settings,
      });
    return result;
  });
}
export function validSettingsForDataset(settings: AnalyticsSettings, dataset: AnalyticsDataset): boolean {
  if (settings.dataset !== dataset.id || !dataset.states.some((state) => state.value === settings.state)) return false;
  const axes = [...settings.pivot.rows, ...settings.pivot.columns];
  return (
    axes.every((item) =>
      dataset.dimensions.some(
        (field) =>
          field.key === item.field && (item.grain === undefined || item.grain === 'value' || field.kind === 'date'),
      ),
    ) && settings.pivot.measures.every((item) => dataset.measures.some((field) => field.key === item.field))
  );
}
