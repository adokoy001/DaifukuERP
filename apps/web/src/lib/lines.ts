// Pure line-grid logic (web-phase1 AC-1/AC-2): columns, row model, payload, diff, sums, server issues -> cells.
// No DOM here so it stays unit-testable (lines.test.ts).
import type { EntityMeta, FieldMeta, RecordJson, ValidationIssue } from '../api/types.ts';
import { sumDecimalStrings } from './decimal.ts';
import { initialValues, toPayload, type FormValues } from './form.ts';

export interface GridRow {
  /** Stable client key (React key / focus target); not sent to the server. */
  key: string;
  /** Present for rows that exist on the server (kernel keeps them by id). */
  id?: string;
  values: FormValues;
}

/** rowKey -> field -> message */
export type GridErrors = Record<string, Record<string, string>>;

const KERNEL_DEFAULT_LIST_LENGTH = 6;

/**
 * Grid columns: `views.list` when the line entity declares one, else every non-hidden field; the parent ref and `seq`
 * never appear (assigned by the kernel from array order). /meta cannot tell a declared list from the kernel's default
 * (first 6 non-hidden fields), so that exact default is treated as "not declared". Required fields without a default
 * are always appended so every row can be saved.
 */
export function gridColumns(line: EntityMeta, parentField: string): FieldMeta[] {
  const excluded = new Set([parentField, 'seq']);
  const nonHidden = line.fields.filter((f) => !f.hidden && f.kind !== 'timestamp');
  const kernelDefault = line.fields.filter((f) => !f.hidden).slice(0, KERNEL_DEFAULT_LIST_LENGTH).map((f) => f.name);
  const declared = line.views.list.length > 0 && line.views.list.join(',') !== kernelDefault.join(',');
  const listed = declared ? line.views.list.flatMap((n) => nonHidden.filter((f) => f.name === n)) : nonHidden;
  const seen = new Set(listed.map((f) => f.name));
  const mandatory = nonHidden.filter((f) => f.required && !f.hasDefault && !seen.has(f.name));
  return [...listed, ...mandatory].filter((f) => !excluded.has(f.name));
}

let keySeq = 0;
export function nextRowKey(): string {
  keySeq += 1;
  return `r${keySeq}`;
}

export function newRow(columns: readonly FieldMeta[]): GridRow {
  return { key: nextRowKey(), values: initialValues(columns) };
}

export function rowsFromRecord(columns: readonly FieldMeta[], rows: readonly RecordJson[] | undefined): GridRow[] {
  return (rows ?? []).map((r) => ({ key: nextRowKey(), id: r.id, values: initialValues(columns, r) }));
}

/** All line sets of a record keyed by line entity. Line entities the caller may not read (absent from /meta) are skipped. */
export function linesFromRecord(specs: readonly { line: EntityMeta; columns: FieldMeta[] }[], record: RecordJson | undefined): Record<string, GridRow[]> {
  const out: Record<string, GridRow[]> = {};
  for (const s of specs) out[s.line.name] = rowsFromRecord(s.columns, record?.lines?.[s.line.name]);
  return out;
}

export interface RowsPayload {
  rows: Record<string, unknown>[];
  errors: GridErrors;
}

/**
 * Existing rows carry their id and send empty cells as null (clear); new rows omit empties so server defaults apply.
 * Required cells never become null (the kernel's schemas reject that): with a default the cell is left out (default /
 * previous value), without one the row gets a `requiredMessage` error.
 */
export function rowsToPayload(rows: readonly GridRow[], columns: readonly FieldMeta[], requiredMessage = 'required'): RowsPayload {
  const out: RowsPayload = { rows: [], errors: {} };
  for (const row of rows) {
    const mode = row.id ? 'update' : 'create';
    const { payload, errors } = toPayload(row.values, columns, mode);
    for (const c of columns) {
      if (c.serverOwned || c.readOnly || !c.required || !(mode === 'create' ? payload[c.name] === undefined : payload[c.name] === null)) continue;
      delete payload[c.name];
      if (!c.hasDefault) errors[c.name] = requiredMessage;
    }
    if (Object.keys(errors).length > 0) out.errors[row.key] = errors;
    out.rows.push(row.id ? { id: row.id, ...payload } : payload);
  }
  return out;
}

/** Whether the grid differs from the server rows (order, membership or any cell). Both sides go through the same payload mapping. */
export function linesChanged(rows: readonly GridRow[], original: readonly GridRow[], columns: readonly FieldMeta[]): boolean {
  return JSON.stringify(rowsToPayload(rows, columns).rows) !== JSON.stringify(rowsToPayload(original, columns).rows);
}

export function moveRow(rows: readonly GridRow[], from: number, to: number): GridRow[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return [...rows];
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

/** Column sums for decimal columns (AC-2 "参考値"). Invalid cells are skipped; `int` columns are summed too. */
export function columnSums(rows: readonly GridRow[], columns: readonly FieldMeta[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    if (c.kind !== 'decimal' && c.kind !== 'int') continue;
    out[c.name] = sumDecimalStrings(rows.map((r) => (typeof r.values[c.name] === 'string' ? (r.values[c.name] as string) : '')));
  }
  return out;
}

export interface SplitIssues {
  /** lineEntity -> rowIndex -> field -> message */
  lines: Record<string, Record<number, Record<string, string>>>;
  /** Issues about a whole line set (e.g. unknown line entity) or the header; left for the form. */
  rest: ValidationIssue[];
}

const WRAPPERS = new Set(['patch', 'input', 'body']);

/** Splits `patch.lines.<entity>.<i>.<field>` / `lines.<entity>.<i>.<field>` issues from header issues. */
export function splitLineIssues(issues: readonly ValidationIssue[]): SplitIssues {
  const out: SplitIssues = { lines: {}, rest: [] };
  for (const issue of issues) {
    const segs = issue.path.split('.').filter((s) => s.length > 0);
    const first = segs[0];
    const start = first !== undefined && WRAPPERS.has(first) ? 1 : 0;
    const [tag, entity, index, field] = segs.slice(start);
    const row = index === undefined ? NaN : Number(index);
    if (tag !== 'lines' || entity === undefined || !Number.isInteger(row) || field === undefined) {
      out.rest.push(issue);
      continue;
    }
    const byRow = (out.lines[entity] ??= {});
    const byField = (byRow[row] ??= {});
    byField[field] = byField[field] ? `${byField[field]}; ${issue.message}` : issue.message;
  }
  return out;
}

/** Row-index errors -> row-key errors for the rows as they were sent. */
export function rowErrorsByKey(rows: readonly GridRow[], byIndex: Record<number, Record<string, string>> | undefined): GridErrors {
  const out: GridErrors = {};
  if (!byIndex) return out;
  for (const [i, errs] of Object.entries(byIndex)) {
    const row = rows[Number(i)];
    if (row) out[row.key] = errs;
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Polymorphic reference in a grid row (docs/conventions/ui.md, web-phase15): a uuid/text `<x>Id` cell whose row also has
 * an enum `<x>Entity` naming a readable entity (payment_allocation.invoiceId + invoiceEntity). The grid shows a link with
 * the target's number/display value under the raw id. Undefined unless both cells hold a usable value.
 */
export function polymorphicTarget(field: FieldMeta, values: FormValues, siblings: readonly FieldMeta[], entities: readonly EntityMeta[]): { entity: EntityMeta; id: string } | undefined {
  if ((field.kind !== 'uuid' && field.kind !== 'text') || !field.name.endsWith('Id')) return undefined;
  const entityField = `${field.name.slice(0, -2)}Entity`;
  if (!siblings.some((f) => f.name === entityField && f.kind === 'enum')) return undefined;
  const id = values[field.name];
  const name = values[entityField];
  const entity = entities.find((e) => e.name === name);
  return typeof id === 'string' && UUID_RE.test(id) && entity ? { entity, id } : undefined;
}
