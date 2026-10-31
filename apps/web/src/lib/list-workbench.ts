// Generic list workbench helpers (docs/specs/list-workbench.md AC-6..AC-11): page totals with decimal strings, the
// export request, and the bulk document operations' eligibility and plan. Pure; list-workbench.test.ts.
import type { Docstatus, EntityMeta, FieldMeta, Locale, RecordJson } from '../api/types.ts';
import { isDecimalString, sumDecimalStrings } from './decimal.ts';
import { fieldValue } from './ext.ts';
import { parseSort } from './query.ts';

// ---- counts in UI text (AC-12) --------------------------------------------------------------

/** "3 件" / "1 row" / "3 rows": a locale-formatted count with the English singular or plural noun. */
export function countLabel(n: number, locale: Locale, en: readonly [singular: string, plural: string]): string {
  const shown = n.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
  return locale === 'ja' ? `${shown} 件` : `${shown} ${n === 1 ? en[0] : en[1]}`;
}

export const ROWS = ['row', 'rows'] as const;
export const FILTERS = ['filter', 'filters'] as const;

// ---- page totals (AC-6) ---------------------------------------------------------------------

export interface PageTotal {
  field: FieldMeta;
  /** Decimal string; never a float (ADR-0010). */
  total: string;
}

/** Sums of the money columns over the rows on this page (blank cells are skipped). */
export function pageTotals(rows: readonly RecordJson[], columns: readonly FieldMeta[]): PageTotal[] {
  return columns
    .filter((f) => f.kind === 'decimal' && f.money === true)
    .map((field) => ({
      field,
      total: sumDecimalStrings(
        rows.flatMap((row) => {
          const v = fieldValue(row, field);
          return typeof v === 'string' && isDecimalString(v) ? [v] : [];
        }),
      ),
    }));
}

// ---- CSV export (AC-7) ----------------------------------------------------------------------

export function exportActionName(entity: string): string {
  return `${entity}.export_rows`;
}

/** The `<entity>.export_rows` input for what the list shows: criteria, order and visible columns. */
export function exportInput(
  entity: EntityMeta,
  state: { search?: string | undefined; sort?: string | undefined; where?: Record<string, unknown> | undefined },
  columns: readonly FieldMeta[],
  locale: Locale,
): Record<string, unknown> {
  const sort = parseSort(state.sort);
  const search = state.search?.trim();
  return {
    ...(state.where ? { where: state.where } : {}),
    ...(search ? { search } : {}),
    ...(sort ? { orderBy: [{ field: sort.field, dir: sort.dir }] } : {}),
    columns: [
      ...(entity.kind === 'document' ? ['number', 'docstatus'] : []),
      ...columns.map((c) => c.name).filter((n) => entity.kind !== 'document' || (n !== 'number' && n !== 'docstatus')),
    ],
    locale,
  };
}

// ---- bulk document operations (AC-10/AC-11) -------------------------------------------------

export const BULK_LIMIT = 100;
export type BulkOp = 'submit' | 'cancel' | 'delete';
export const BULK_OPS: readonly BulkOp[] = ['submit', 'cancel', 'delete'];

/** The state a row must be in for the operation (submit/delete: draft, cancel: submitted). */
const REQUIRED_STATE: Record<BulkOp, Docstatus> = { submit: 0, cancel: 1, delete: 0 };

/** Operations offered for the entity: documents only, and only those the caller's ops allow. */
export function bulkOps(entity: EntityMeta): BulkOp[] {
  if (entity.kind !== 'document') return [];
  return BULK_OPS.filter((op) => entity.ops.includes(op));
}

export function bulkEligible(op: BulkOp, row: RecordJson): boolean {
  return (row.docstatus ?? 0) === REQUIRED_STATE[op];
}

export interface BulkPlan {
  targets: RecordJson[];
  /** Selected rows whose state does not allow the operation. */
  ineligible: RecordJson[];
}

// ---- selection (AC-11) ----------------------------------------------------------------------

/** Selected rows by id, in the order they were chosen (Map keeps insertion order). */
export type RowSelectionMap = ReadonlyMap<string, RecordJson>;

/**
 * What keeps a selection alive: search, sort and filters. The page is deliberately not part of it, so rows chosen on
 * one page stay selected on the next; any other change of the criteria starts a new, empty selection.
 */
export function selectionCriteria(state: {
  q?: string | undefined;
  sort?: string | undefined;
  where?: Record<string, unknown> | undefined;
}): string {
  return JSON.stringify([state.q ?? '', state.sort ?? '', state.where ?? null]);
}

/** Selects or clears one row; a new row beyond `limit` is refused (the same map is returned). */
export function toggleSelection(
  current: RowSelectionMap,
  row: RecordJson,
  on: boolean,
  limit = BULK_LIMIT,
): RowSelectionMap {
  if (on ? current.has(row.id) || current.size >= limit : !current.has(row.id)) return current;
  const next = new Map(current);
  if (on) next.set(row.id, row);
  else next.delete(row.id);
  return next;
}

/** The page checkbox: selects the page's rows in order until `limit`, or clears them all. */
export function togglePageSelection(
  current: RowSelectionMap,
  rows: readonly RecordJson[],
  on: boolean,
  limit = BULK_LIMIT,
): RowSelectionMap {
  const next = new Map(current);
  for (const row of rows) {
    if (!on) next.delete(row.id);
    else if (next.has(row.id) || next.size < limit) next.set(row.id, row);
  }
  return next;
}

/** Selected rows that are on the page shown take its fresh copy (version, state); others are kept as they were. */
export function refreshSelection(current: RowSelectionMap, rows: readonly RecordJson[]): RowSelectionMap {
  if (!rows.some((row) => current.has(row.id))) return current;
  const next = new Map(current);
  for (const row of rows) if (next.has(row.id)) next.set(row.id, row);
  return next;
}

/** AC-10/AC-11: eligible rows in selection order (at most BULK_LIMIT) and the rows left out for their state. */
export function planBulk(op: BulkOp, selected: readonly RecordJson[], limit = BULK_LIMIT): BulkPlan {
  const eligible = selected.filter((row) => bulkEligible(op, row));
  return { targets: eligible.slice(0, limit), ineligible: selected.filter((row) => !bulkEligible(op, row)) };
}

/** REST call for one row, always with the version the list showed (ADR-0006: a changed row fails with CONFLICT). */
export function bulkRequest(
  entity: string,
  op: BulkOp,
  row: Pick<RecordJson, 'id' | 'version'>,
): { path: string; method: 'POST' | 'DELETE'; body: { expectedVersion: number } } {
  const body = { expectedVersion: row.version };
  return op === 'delete'
    ? { path: `/api/${entity}/${row.id}`, method: 'DELETE', body }
    : { path: `/api/${entity}/${row.id}/${op}`, method: 'POST', body };
}

export type BulkRowStatus = 'pending' | 'running' | 'done' | 'failed';
export interface BulkRowResult {
  id: string;
  label: string;
  status: BulkRowStatus;
  message?: string;
}

export function bulkSummary(results: readonly BulkRowResult[]): { done: number; failed: number; pending: number } {
  return {
    done: results.filter((r) => r.status === 'done').length,
    failed: results.filter((r) => r.status === 'failed').length,
    pending: results.filter((r) => r.status === 'pending' || r.status === 'running').length,
  };
}

/** Row label in confirmations and results: the document number, else the display field, else a short id. */
export function rowLabel(entity: EntityMeta, row: RecordJson): string {
  const candidates = [row.number, entity.displayField ? row[entity.displayField] : undefined, row.name, row.code];
  const found = candidates.find((v): v is string => typeof v === 'string' && v.length > 0);
  return found ?? `${row.id.slice(0, 8)}…`;
}
