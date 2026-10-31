// Import screen logic (docs/specs/csv-import.md AC-11..AC-13): which fields a file may fill (mirrors kernel
// import-values.ts through /meta), header -> field auto-mapping, the request body, and the error CSV. Pure.
import type { EntityMeta, FieldMeta, Label, Locale } from '../api/types.ts';
import type { CsvTable } from './csv-parse.ts';
import { errorExplanation } from './error-view.ts';

/** Kernel IMPORT_MAX_ROWS / IMPORT_MAX_BYTES (kernel/src/import-values.ts); the server enforces them too. */
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

const KINDS = new Set(['text', 'int', 'decimal', 'bool', 'date', 'timestamp', 'enum', 'ref', 'uuid']);

/** Fields a file may set: server-owned, read-only and json fields are excluded (meta already hides masked ones). */
export function importableFields(entity: EntityMeta): FieldMeta[] {
  return entity.fields.filter((f) => KINDS.has(f.kind) && !f.serverOwned && !f.readOnly);
}

/** Same comparison key as the kernel's headerKey: NFKC, trimmed, single spaces, case-folded. */
export function headerKey(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** One entry per header: the field it fills, or '' (ignored). */
export type ColumnMapping = string[];

const FORMULA_LEAD = '=+@-';
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
/** As lib/csv.ts: spaces and control characters before the first visible one do not hide a formula. */
const firstVisible = (s: string) => [...s].find((c) => c.charCodeAt(0) > 32 && !/\s/.test(c));

/**
 * Spreadsheet formula guard, as lib/csv.ts writes it for text: a cell whose first visible character is = + - @ gets a
 * leading apostrophe, unless it is a plain number such as -5 (the column type is not known here).
 */
export function guardCell(raw: string): string {
  const lead = firstVisible(raw);
  return lead !== undefined && FORMULA_LEAD.includes(lead) && !PLAIN_NUMBER.test(raw.trim()) ? `'${raw}` : raw;
}

/**
 * The inverse when a file is read: one leading apostrophe before = + - @ is the guard of the error CSV or a report
 * export (lib/csv.ts), not data, so a file can be downloaded, fixed and imported again unchanged.
 */
export function unguardCell(cell: string): string {
  if (!cell.startsWith("'")) return cell;
  const lead = firstVisible(cell.slice(1));
  return lead !== undefined && FORMULA_LEAD.includes(lead) ? cell.slice(1) : cell;
}

/** AC-11: exact field name first, then a single field whose name or ja/en label matches; a field is used once. */
export function autoMapColumns(headers: readonly string[], fields: readonly FieldMeta[]): ColumnMapping {
  const used = new Set<string>();
  return headers.map((raw) => {
    const header = unguardCell(raw);
    const exact = fields.find((f) => f.name === header);
    const key = headerKey(header);
    const matches = exact
      ? [exact]
      : fields.filter((f) => [f.name, f.label.ja, f.label.en].some((name) => headerKey(name) === key));
    const field = matches.length === 1 ? matches[0] : undefined;
    if (!field || used.has(field.name)) return '';
    used.add(field.name);
    return field.name;
  });
}

export interface MappingCheck {
  /** Fields chosen for more than one column (blocking). */
  duplicates: string[];
  /** Required fields without a default that no column fills (a warning: hooks may still supply them). */
  missingRequired: FieldMeta[];
  mapped: number;
}

export function checkMapping(mapping: ColumnMapping, fields: readonly FieldMeta[]): MappingCheck {
  const counts = new Map<string, number>();
  for (const name of mapping) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  return {
    duplicates: [...counts].filter(([, n]) => n > 1).map(([name]) => name),
    missingRequired: fields.filter((f) => f.required && !f.hasDefault && !counts.has(f.name)),
    mapped: counts.size,
  };
}

export type OnExisting = 'skip' | 'update' | 'error';

export interface ImportRequest {
  rows: Record<string, string>[];
  mode: 'dry-run' | 'execute';
  onExisting: OnExisting;
  atomic?: boolean;
}

/**
 * Mapped, non-blank cells keyed by field name (blank = not given on the server too, and it keeps the body small), with
 * the formula guard removed (unguardCell).
 */
export function importRows(table: CsvTable, mapping: ColumnMapping): Record<string, string>[] {
  return table.rows.map((record) => {
    const row: Record<string, string> = {};
    mapping.forEach((field, i) => {
      const cell = unguardCell(record[i] ?? '');
      if (field && cell.trim() !== '') row[field] = cell;
    });
    return row;
  });
}

export function requestBytes(body: ImportRequest): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

// ---- results (AC-12/AC-13) ------------------------------------------------------------------------

export interface ImportMessage {
  code: string;
  message: string;
  field?: string;
  column?: string;
  hint?: string;
}

export interface ImportRowResult {
  line: number;
  status: 'created' | 'updated' | 'skipped' | 'error';
  id?: string;
  messages?: ImportMessage[];
}

export interface ImportResult {
  mode: 'dry-run' | 'execute';
  committed: boolean;
  keyField: string | null;
  summary: { created: number; updated: number; skipped: number; errors: number };
  rows: ImportRowResult[];
  notices: { column: string; reason: string; message: string }[];
}

const CODE_TEXT: Record<string, Label> = {
  ref_not_found: { ja: '参照先が見つかりません', en: 'Referenced record not found' },
  ref_ambiguous: { ja: '参照先が複数あります（コードで指定してください）', en: 'Several records match (use the code)' },
  invalid_value: { ja: '値の形式が正しくありません', en: 'Invalid value' },
  exists: { ja: '同じキーの記録が既にあります', en: 'A record with this key already exists' },
  immutable: { ja: '作成後は変更できない項目です', en: 'Cannot change after create' },
  unchanged: { ja: '変更はありません', en: 'No changes' },
  database: { ja: 'データベースが行を受け付けませんでした', en: 'The database rejected the row' },
};

/**
 * One readable line per message: "<field label>: <localized reason> (<server message>)". Import codes have their own
 * text; kernel codes (VALIDATION, CONFLICT, …) use the explanation the error views use.
 */
export function messageText(m: ImportMessage, fields: readonly FieldMeta[], locale: Locale): string {
  const field = m.field ? fields.find((f) => f.name === m.field) : undefined;
  const where = field ? field.label[locale] || field.name : m.column;
  const known = CODE_TEXT[m.code] ?? errorExplanation(m.code, undefined);
  const what = known ? `${known[locale]} (${m.message})` : m.message;
  return where ? `${where}: ${what}` : what;
}

/** A spreadsheet may open the file: every cell carries the formula guard (guardCell; read back by unguardCell). */
function csvCell(raw: string): string {
  const s = guardCell(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * AC-13: the failed rows as they were in the file (original columns and cells; only the formula guard is added, and the
 * import removes it again), followed by the data row number and the reasons. UTF-8 with BOM and CRLF for spreadsheets.
 */
export function errorCsv(
  table: CsvTable,
  result: ImportResult,
  fields: readonly FieldMeta[],
  locale: Locale,
  labels: { line: Label; reason: Label },
): string {
  const out = [[...table.headers.map(csvCell), labels.line[locale], labels.reason[locale]].join(',')];
  for (const row of result.rows) {
    if (row.status !== 'error') continue;
    const record = table.rows[row.line - 1] ?? [];
    const reasons = (row.messages ?? []).map((m) => messageText(m, fields, locale)).join(' / ');
    out.push(
      [
        ...table.headers.map((_, i) => csvCell(record[i] ?? '')),
        String(table.lines[row.line - 1] ?? row.line),
        csvCell(reasons),
      ].join(','),
    );
  }
  return `\uFEFF${out.join('\r\n')}\r\n`;
}
