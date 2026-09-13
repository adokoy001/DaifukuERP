// Pure helpers for report pages (web-phase1 AC-3). report.test.ts.
import type { ActionMeta, Label, Locale, TableColumn, TableResult } from '../api/types.ts';
import { compareDecimalStrings } from './decimal.ts';
import { businessToday, validDate } from './operations.ts';
import type { SchemaField } from './schema.ts';

const TITLE_MAX = 32;
const SENTENCE_END = /[。．.:：（(]/;
/** `試算表を返します` -> `試算表`: the verb tail the action descriptions conventionally end with. */
const JA_VERB_TAIL = /(を|の)?(返|出力|表示|作成|集計|計算)します$/;

function shorten(s: string, tail?: RegExp): string {
  const cut = SENTENCE_END.exec(s);
  let head = (cut && cut.index > 0 ? s.slice(0, cut.index) : s).trim();
  if (tail) head = head.replace(tail, '') || head;
  return head.length > TITLE_MAX ? `${head.slice(0, TITLE_MAX)}…` : head;
}

/** Menu title for a report: actions only carry a description, so its first clause is used (`試算表を返します。…` -> `試算表`). */
export function reportTitle(action: Pick<ActionMeta, 'name' | 'description'>): Label {
  const ja = shorten(action.description.ja, JA_VERB_TAIL);
  const en = shorten(action.description.en);
  return { ja: ja || action.name, en: en || action.name };
}

/** Totals whose key is a column key: shown in the table's totals row. */
export function columnTotals(result: TableResult): Record<string, string> {
  const keys = new Set(result.columns.map((c) => c.key));
  return Object.fromEntries(Object.entries(result.totals ?? {}).filter(([k]) => keys.has(k)));
}

/**
 * web-phase15 AC-7: totals whose key matches no column (e.g. accounting.tax_period_summary `output_tax_total`,
 * `input_tax_total`, `net_tax_due`), in the server's order; shown as a key/value list below the table and appended to CSV.
 */
export function extraTotals(result: TableResult): [string, string][] {
  const keys = new Set(result.columns.map((c) => c.key));
  return Object.entries(result.totals ?? {}).filter(([k]) => !keys.has(k));
}

export type ReportPeriod = 'current' | 'previous' | 'last12';
const INPUT_LABELS: Record<string, Label> = {
  from: { ja: '開始日', en: 'From' },
  to: { ja: '終了日', en: 'To' },
  asOf: { ja: '基準日', en: 'As of' },
  date: { ja: '対象日', en: 'Date' },
  period: { ja: '対象月（YYYY-MM）', en: 'Period (YYYY-MM)' },
  month: { ja: '対象月（YYYY-MM）', en: 'Month (YYYY-MM)' },
  year: { ja: '対象年（西暦）', en: 'Year' },
  accountId: { ja: '勘定科目', en: 'Account' },
  productId: { ja: '商品・品目', en: 'Product' },
  warehouseId: { ja: '倉庫', en: 'Warehouse' },
  partnerId: { ja: '取引先', en: 'Partner' },
};
/** Preserve explicit schema titles/descriptions. Only replace the generated name labels. */
export function reportInputFields(fields: readonly SchemaField[]): SchemaField[] {
  return fields.map((field) => {
    const generated = field.name
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
    const label = INPUT_LABELS[field.name];
    return label && field.label.ja === generated && field.label.en === generated ? { ...field, label } : field;
  });
}

function periodField(field: SchemaField): 'date' | 'month' | 'year' | undefined {
  if (field.kind === 'date' && ['from', 'to', 'asOf', 'date'].includes(field.name)) return 'date';
  if (field.kind === 'text' && ['period', 'month'].includes(field.name)) return 'month';
  if (['int', 'number'].includes(field.kind) && field.name === 'year') return 'year';
  return undefined;
}

export function reportPeriodOptions(fields: readonly SchemaField[]): ReportPeriod[] {
  if (!fields.some(periodField)) return [];
  const hasRange = ['from', 'to'].every((name) =>
    fields.some((field) => field.name === name && periodField(field) === 'date'),
  );
  return hasRange ? ['current', 'previous', 'last12'] : ['current', 'previous'];
}

export function reportPeriodLabel(fields: readonly SchemaField[], period: ReportPeriod): Label {
  if (period === 'last12') return { ja: '直近12か月', en: 'Last 12 months' };
  const kinds = fields.map(periodField).filter(Boolean);
  if (kinds.every((kind) => kind === 'year'))
    return period === 'current' ? { ja: '今年', en: 'This year' } : { ja: '前年', en: 'Previous year' };
  if (kinds.every((kind) => kind === 'date') && !fields.some((field) => field.name === 'from'))
    return period === 'current' ? { ja: '今日', en: 'Today' } : { ja: '先月末', en: 'Previous month end' };
  return period === 'current' ? { ja: '今月', en: 'This month' } : { ja: '先月', en: 'Previous month' };
}

/** Japanese business dates, without converting a YYYY-MM-DD input through the browser timezone. */
export function reportPeriodValues(
  fields: readonly SchemaField[],
  period: ReportPeriod,
  now = new Date(),
): Record<string, string | number> {
  const today = businessToday(now);
  const year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7));
  const monthStart = (offset: number) => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
  const from = monthStart(period === 'previous' ? -1 : period === 'last12' ? -11 : 0);
  const to = period === 'previous' ? new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10) : today;
  const values: Record<string, string | number> = {};
  const onlyYear = fields
    .filter((field) => periodField(field) !== undefined)
    .every((field) => periodField(field) === 'year');
  for (const field of fields) {
    const kind = periodField(field);
    if (kind === 'date') values[field.name] = field.name === 'from' ? from : to;
    if (kind === 'month') values[field.name] = to.slice(0, 7);
    if (kind === 'year')
      values[field.name] = onlyYear ? year - (period === 'previous' ? 1 : 0) : Number(to.slice(0, 4));
  }
  return values;
}

/** Only known period fields receive defaults; identifiers, settings and explicit schema defaults are never invented. */
export function reportInitialValues(fields: readonly SchemaField[], now = new Date()): Record<string, string | number> {
  const candidates = reportPeriodValues(fields, 'current', now);
  const defaults: Record<string, string | number> = {};
  for (const field of fields) {
    const value = candidates[field.name];
    if (field.default === undefined && value !== undefined) defaults[field.name] = value;
  }
  return defaults;
}

export function reportDateErrors(
  input: Record<string, unknown>,
  fields: readonly SchemaField[],
  locale: Locale,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = input[field.name];
    if (periodField(field) === 'date' && value !== undefined && value !== null && value !== '' && !validDate(value)) {
      errors[field.name] =
        locale === 'ja' ? '実在する日付を YYYY-MM-DD で入力してください。' : 'Enter a valid date as YYYY-MM-DD.';
    }
  }
  const range = ['from', 'to'].every((name) =>
    fields.some((field) => field.name === name && periodField(field) === 'date'),
  );
  if (range && validDate(input.from) && validDate(input.to) && input.from > input.to) {
    errors.to =
      locale === 'ja' ? '終了日は開始日以降にしてください。' : 'The end date must be on or after the start date.';
  }
  return errors;
}

export interface ReportSort {
  key: string;
  direction: 'asc' | 'desc';
}
export interface ReportRow {
  row: Record<string, unknown>;
  index: number;
}
export interface ReportRowsPage {
  rows: ReportRow[];
  matched: number;
  total: number;
  page: number;
  pages: number;
  from: number;
  to: number;
}
const missing = (value: unknown) => value === undefined || value === null || value === '';

function compareReportCells(a: unknown, b: unknown, column: TableColumn, collator: Intl.Collator): number {
  if (column.kind === 'decimal' || column.kind === 'int') {
    const compared = compareDecimalStrings(String(a), String(b));
    if (compared !== undefined) return compared;
  }
  if (column.kind === 'bool' && typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/** A view of already returned rows only. Totals and input rows remain unchanged; numeric sorting never uses Number. */
export function reportRowsPage(
  result: TableResult,
  opts: {
    query?: string;
    sort?: ReportSort;
    page?: number;
    pageSize?: number;
    locale?: Locale;
    cellText?: (column: TableColumn, value: unknown) => string;
  } = {},
): ReportRowsPage {
  const pageSize = opts.pageSize === 25 ? 25 : 50;
  const query = (opts.query ?? '')
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase(opts.locale ?? 'ja');
  let rows = result.rows.map((row, index) => ({ row, index }));
  if (query)
    rows = rows.filter(({ row }) =>
      result.columns.some((column) => {
        const value = row[column.key];
        const raw = missing(value) ? '' : String(value);
        const displayed = opts.cellText?.(column, value) ?? '';
        return `${raw}\n${displayed}`
          .normalize('NFKC')
          .toLocaleLowerCase(opts.locale ?? 'ja')
          .includes(query);
      }),
    );
  const column = result.columns.find((item) => item.key === opts.sort?.key);
  if (column && opts.sort) {
    const direction = opts.sort.direction === 'desc' ? -1 : 1;
    const collator = new Intl.Collator(opts.locale ?? 'ja', { numeric: true, sensitivity: 'base' });
    rows.sort((a, b) => {
      const av = a.row[column.key],
        bv = b.row[column.key];
      // Empty cells remain last in both directions. Equal values retain the server's original order.
      if (missing(av) !== missing(bv)) return missing(av) ? 1 : -1;
      const compared = missing(av) && missing(bv) ? 0 : compareReportCells(av, bv, column, collator);
      return compared * direction || a.index - b.index;
    });
  }
  const matched = rows.length,
    pages = Math.max(1, Math.ceil(matched / pageSize));
  const requested = typeof opts.page === 'number' && Number.isFinite(opts.page) ? Math.floor(opts.page) : 0;
  const page = Math.max(0, Math.min(pages - 1, requested)),
    offset = page * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    matched,
    total: result.rows.length,
    page,
    pages,
    from: matched ? offset + 1 : 0,
    to: Math.min(matched, offset + pageSize),
  };
}
