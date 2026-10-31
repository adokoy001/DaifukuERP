// Generic list filters (docs/specs/list-workbench.md AC-1..AC-3). Entity meta -> filter controls, URL value <-> filters,
// filters -> REST `where` (kernel Domain). Pure; list-filters.test.ts. Money and quantities stay decimal strings.
import type { EntityMeta, FieldMeta, Label } from '../api/types.ts';
import { compareDecimalStrings } from './decimal.ts';
import { isExtFieldName } from './ext.ts';
import { DOCSTATUS_LABELS } from './format.ts';

/** Business date of a document or record, in this order (same rule as the close guide's draft counts). */
export const BUSINESS_DATE_FIELDS = ['date', 'postingDate', 'documentDate', 'transactionDate'] as const;
/** `?status=` words of the close-guide link contract and the docstatus they mean. */
export const STATUS_WORDS: Record<string, number> = { draft: 0, submitted: 1, cancelled: 2 };
export const DOCSTATUS_VALUES = [0, 1, 2] as const;

export type FilterKind = 'docstatus' | 'date' | 'ref' | 'enum' | 'range' | 'bool';

export interface FilterDef {
  /** Field name (or `docstatus`); also the key in the URL value and in `where`. */
  key: string;
  kind: FilterKind;
  label: Label;
  field?: FieldMeta;
  /** range over an int field: bounds are whole numbers sent as JSON numbers. */
  integer?: boolean;
}

export interface DateRange {
  from?: string;
  to?: string;
}
export interface NumberRange {
  min?: string;
  max?: string;
}
export type FilterValue = number[] | string[] | DateRange | NumberRange | string | boolean;
/** Applied filters by FilterDef.key. Only valid, non-empty values are kept. */
export type ListFilters = Record<string, FilterValue>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const INTEGER = /^[+-]?\d+$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The entity's business date field (first of BUSINESS_DATE_FIELDS that is a date field), if any. */
export function businessDateField(entity: EntityMeta): FieldMeta | undefined {
  for (const name of BUSINESS_DATE_FIELDS) {
    const field = entity.fields.find((f) => f.name === name && f.kind === 'date');
    if (field) return field;
  }
  return undefined;
}

function defFor(field: FieldMeta): FilterDef | undefined {
  switch (field.kind) {
    case 'date':
      return { key: field.name, kind: 'date', label: field.label, field };
    case 'ref':
      return field.ref ? { key: field.name, kind: 'ref', label: field.label, field } : undefined;
    case 'enum':
      return field.values?.length ? { key: field.name, kind: 'enum', label: field.label, field } : undefined;
    case 'decimal':
      return { key: field.name, kind: 'range', label: field.label, field };
    case 'int':
      return { key: field.name, kind: 'range', label: field.label, field, integer: true };
    case 'bool':
      return { key: field.name, kind: 'bool', label: field.label, field };
    default:
      // text is covered by the search box; timestamps, uuid and json have no filter control in v1
      return undefined;
  }
}

/**
 * AC-1: filter controls from meta — the document state, the business date, then the fields of `views.list` and
 * `views.search` (in that order) that have a control kind. Ext fields are not filtered in v1.
 */
export function filterDefs(entity: EntityMeta): FilterDef[] {
  const defs: FilterDef[] = [];
  const seen = new Set<string>();
  const push = (def: FilterDef | undefined) => {
    if (!def || seen.has(def.key)) return;
    seen.add(def.key);
    defs.push(def);
  };
  if (entity.kind === 'document') push({ key: 'docstatus', kind: 'docstatus', label: { ja: '状態', en: 'Status' } });
  const date = businessDateField(entity);
  if (date) push(defFor(date));
  for (const name of [...entity.views.list, ...entity.views.search]) {
    if (isExtFieldName(name) || name === 'docstatus' || name === 'number') continue;
    const field = entity.fields.find((f) => f.name === name);
    if (field && !field.hidden) push(defFor(field));
  }
  return defs;
}

function parseRange(value: unknown, integer: boolean): NumberRange | undefined {
  if (!object(value)) return undefined;
  const pattern = integer ? INTEGER : DECIMAL;
  const out: NumberRange = {};
  for (const key of ['min', 'max'] as const) {
    const v = value[key];
    if (v === undefined || v === '') continue;
    const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
    if (typeof text !== 'string' || !pattern.test(text.trim())) return undefined;
    out[key] = text.trim();
  }
  if (out.min === undefined && out.max === undefined) return undefined;
  if (out.min !== undefined && out.max !== undefined && compareDecimalStrings(out.min, out.max) === 1) return undefined;
  if (integer && [out.min, out.max].some((v) => v !== undefined && !Number.isSafeInteger(Number(v)))) return undefined;
  return out;
}

function parseDateRange(value: unknown): DateRange | undefined {
  if (!object(value)) return undefined;
  const out: DateRange = {};
  for (const key of ['from', 'to'] as const) {
    const v = value[key];
    if (v === undefined || v === '') continue;
    if (!isIsoDate(v)) return undefined;
    out[key] = v;
  }
  if (out.from === undefined && out.to === undefined) return undefined;
  if (out.from !== undefined && out.to !== undefined && out.from > out.to) return undefined;
  return out;
}

/** One filter value checked against its control; undefined when invalid or empty (AC-2: invalid input is ignored). */
export function parseFilterValue(def: FilterDef, value: unknown): FilterValue | undefined {
  switch (def.kind) {
    case 'docstatus': {
      if (!Array.isArray(value)) return undefined;
      const picked = DOCSTATUS_VALUES.filter((d) => value.includes(d));
      return picked.length && picked.length === new Set(value).size ? picked : undefined;
    }
    case 'enum': {
      if (!Array.isArray(value)) return undefined;
      const allowed = def.field?.values ?? [];
      const picked = allowed.filter((v) => value.includes(v));
      return picked.length && picked.length === new Set(value).size ? picked : undefined;
    }
    case 'date':
      return parseDateRange(value);
    case 'range':
      return parseRange(value, def.integer === true);
    case 'ref':
      return typeof value === 'string' && UUID.test(value) ? value : undefined;
    case 'bool':
      return typeof value === 'boolean' ? value : undefined;
  }
}

/** AC-2: the URL's `f` value -> applied filters. Unknown keys and invalid values are dropped, never fatal. */
export function parseFilters(raw: unknown, defs: readonly FilterDef[]): ListFilters {
  const out: ListFilters = {};
  if (!object(raw)) return out;
  for (const def of defs) {
    if (!Object.hasOwn(raw, def.key)) continue;
    const value = parseFilterValue(def, raw[def.key]);
    if (value !== undefined) out[def.key] = value;
  }
  return out;
}

/**
 * AC-3: `?status=draft&from=YYYY-MM-DD&to=YYYY-MM-DD` (the close guide's links) as the document state and the business
 * date range. `status` takes draft / submitted / cancelled, comma-separated; unknown words or dates are ignored.
 */
export function linkFilters(
  params: { status?: string; from?: string; to?: string },
  entity: EntityMeta,
  defs: readonly FilterDef[],
): ListFilters {
  const out: ListFilters = {};
  if (params.status !== undefined && defs.some((d) => d.kind === 'docstatus')) {
    const words = params.status.split(',').map((w) => w.trim().toLowerCase());
    const values = [...new Set(words.map((w) => STATUS_WORDS[w]).filter((v): v is number => v !== undefined))];
    if (values.length && values.length === new Set(words).size)
      out.docstatus = DOCSTATUS_VALUES.filter((d) => values.includes(d));
  }
  const date = businessDateField(entity);
  if (date && defs.some((d) => d.key === date.name) && (params.from !== undefined || params.to !== undefined)) {
    const range = parseDateRange({ from: params.from, to: params.to });
    if (range) out[date.name] = range;
  }
  return out;
}

/** Filters in force: the URL `f` value, overlaid by the link parameters (they are rewritten into `f` on the next change). */
export function effectiveFilters(
  search: { f?: unknown; status?: string; from?: string; to?: string },
  entity: EntityMeta,
  defs: readonly FilterDef[],
): ListFilters {
  return { ...parseFilters(search.f, defs), ...linkFilters(search, entity, defs) };
}

/** AC-2: applied filters -> kernel Domain for `GET /api/:entity?where=` and `<entity>.export_rows`. */
export function filtersToDomain(filters: ListFilters, defs: readonly FilterDef[]): Record<string, unknown> | undefined {
  const where: Record<string, unknown> = {};
  for (const def of defs) {
    const value = filters[def.key];
    if (value === undefined) continue;
    switch (def.kind) {
      case 'docstatus':
        if (Array.isArray(value) && value.length < DOCSTATUS_VALUES.length) where.docstatus = { $in: value };
        break;
      case 'enum':
        if (Array.isArray(value)) where[def.key] = { $in: value };
        break;
      case 'date': {
        const range = value as DateRange;
        where[def.key] = {
          ...(range.from !== undefined ? { $gte: range.from } : {}),
          ...(range.to !== undefined ? { $lte: range.to } : {}),
        };
        break;
      }
      case 'range': {
        const range = value as NumberRange;
        const bound = (v: string) => (def.integer ? Number(v) : v);
        where[def.key] = {
          ...(range.min !== undefined ? { $gte: bound(range.min) } : {}),
          ...(range.max !== undefined ? { $lte: bound(range.max) } : {}),
        };
        break;
      }
      case 'ref':
      case 'bool':
        where[def.key] = value;
        break;
    }
  }
  return Object.keys(where).length ? where : undefined;
}

/** Returns a copy with `key` set, or removed when `value` is undefined or invalid. */
export function withFilter(filters: ListFilters, defs: readonly FilterDef[], key: string, value: unknown): ListFilters {
  const { [key]: _removed, ...rest } = filters;
  const def = defs.find((d) => d.key === key);
  const parsed = def && value !== undefined ? parseFilterValue(def, value) : undefined;
  return parsed === undefined ? rest : { ...rest, [key]: parsed };
}

export function activeFilterCount(filters: ListFilters): number {
  return Object.keys(filters).length;
}

/** Human-readable value of one applied filter (chips, empty state, audit-friendly summaries). */
export function describeFilter(
  def: FilterDef,
  value: FilterValue,
  locale: 'ja' | 'en',
  refLabel?: (id: string) => string | undefined,
): string {
  switch (def.kind) {
    case 'docstatus':
      return (value as number[])
        .map((d) => DOCSTATUS_LABELS[d as 0 | 1 | 2][locale])
        .join(locale === 'ja' ? '・' : ', ');
    case 'enum':
      return (value as string[])
        .map((v) => def.field?.valueLabels?.[v]?.[locale] ?? v)
        .join(locale === 'ja' ? '・' : ', ');
    case 'date': {
      const range = value as DateRange;
      return `${range.from ?? ''} – ${range.to ?? ''}`.trim();
    }
    case 'range': {
      const range = value as NumberRange;
      if (range.min !== undefined && range.max !== undefined) return `${range.min} – ${range.max}`;
      return range.min !== undefined ? `≥ ${range.min}` : `≤ ${range.max ?? ''}`;
    }
    case 'ref':
      return refLabel?.(value as string) ?? `${(value as string).slice(0, 8)}…`;
    case 'bool':
      return value === true ? (locale === 'ja' ? 'はい' : 'Yes') : locale === 'ja' ? 'いいえ' : 'No';
  }
}
