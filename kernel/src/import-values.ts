// CSV import, pure part (docs/specs/csv-import.md AC-1..AC-3, AC-9, AC-10; ADR-0028): which entities and fields a file
// may fill, header -> field resolution, and cell string -> field value coercion. No database access here; `ref` cells
// come back as lookups that import.ts resolves through the Repository.
import type { EntityDef } from './dsl/entity.ts';
import { EXT_PREFIX } from './dsl/ext.ts';
import type { AnyField, EnumOpts, FieldKind, TextOpts } from './dsl/fields.ts';
import { DOCUMENT_FIELDS, SYSTEM_FIELDS } from './dsl/types.ts';
import type { Label, Locale } from './i18n.ts';
import { isLocalDate } from './ids.ts';
import { normalizeText } from './normalize.ts';
import { registry } from './registry.ts';

/** AC-2: one request carries at most this many data rows… */
export const IMPORT_MAX_ROWS = 5000;
/** …and at most this many bytes (UTF-8 JSON of the request). */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

const IMPORTABLE_KINDS: ReadonlySet<FieldKind> = new Set([
  'text',
  'int',
  'decimal',
  'bool',
  'date',
  'timestamp',
  'enum',
  'ref',
  'uuid',
]);
const SYSTEM_COLUMNS: ReadonlySet<string> = new Set([...SYSTEM_FIELDS, ...DOCUMENT_FIELDS]);

/** Line entities of any document: imported only with their document, which is out of scope (AC-1). */
function lineEntityNames(): Set<string> {
  return new Set(registry.allEntities().flatMap((e) => (e.doc?.lines ?? []).map((l) => l.entity)));
}

function importableField(fd: AnyField): boolean {
  return IMPORTABLE_KINDS.has(fd.kind) && !fd.opts.serverOwned && !fd.opts.outputHidden;
}

/** AC-1: master entities (not documents, not line entities) with at least one field a file may set. */
export function isImportable(entity: EntityDef): boolean {
  if (entity.kind !== 'entity' || lineEntityNames().has(entity.name)) return false;
  return Object.values(entity.config.fields).some(importableField);
}

export interface ImportField {
  name: string;
  kind: FieldKind;
  label: Label;
  required: boolean;
  hidden: boolean;
  unique: boolean;
}

function humanize(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/** Fields a file may set, in declaration order, with the labels the caller sees (pack label overrides applied). */
export function importFields(entity: EntityDef, appliedPacks?: readonly string[]): ImportField[] {
  const overrides = registry.labelOverrides(entity.name, appliedPacks)?.fields ?? {};
  return Object.entries(entity.config.fields)
    .filter(([, fd]) => importableField(fd))
    .map(([name, fd]) => ({
      name,
      kind: fd.kind,
      label: overrides[name] ?? fd.opts.label ?? { ja: humanize(name), en: humanize(name) },
      required: fd.required && !fd.hasDefault,
      hidden: fd.opts.hidden === true,
      unique: fd.opts.unique === true,
    }));
}

/** AC-5: the default natural key is the first `unique` text field that a file may set. */
export function defaultKeyField(entity: EntityDef): string | undefined {
  return importFields(entity).find((f) => f.unique && f.kind === 'text')?.name;
}

/** Comparison key for headers and labels: NFKC (full-width -> half-width), trimmed, single spaces, case-folded. */
export function headerKey(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export type IgnoredReason = 'server-owned' | 'system' | 'ext' | 'unsupported';

export type HeaderResolution =
  | { kind: 'field'; field: string }
  | { kind: 'ignored'; reason: IgnoredReason }
  | { kind: 'ambiguous'; fields: string[] }
  | { kind: 'unknown' };

/**
 * AC-2/AC-9: a header names a field by its name or its Japanese / English label. Server-owned fields, system columns and
 * ext fields (out of scope in this version) are ignored with a notice; anything else that matches nothing is unknown.
 */
export function resolveHeader(entity: EntityDef, header: string, appliedPacks?: readonly string[]): HeaderResolution {
  const fields = importFields(entity, appliedPacks);
  if (fields.some((f) => f.name === header)) return { kind: 'field', field: header };
  const key = headerKey(header);
  const matches = fields.filter(
    (f) => headerKey(f.name) === key || headerKey(f.label.ja) === key || headerKey(f.label.en) === key,
  );
  if (matches.length === 1 && matches[0]) return { kind: 'field', field: matches[0].name };
  if (matches.length > 1) return { kind: 'ambiguous', fields: matches.map((f) => f.name) };
  if (header.startsWith(EXT_PREFIX)) return { kind: 'ignored', reason: 'ext' };
  if ([...SYSTEM_COLUMNS].some((name) => headerKey(name) === key)) return { kind: 'ignored', reason: 'system' };
  for (const [name, fd] of Object.entries(entity.config.fields)) {
    const label = registry.labelOverrides(entity.name, appliedPacks)?.fields?.[name] ?? fd.opts.label;
    const named = headerKey(name) === key || (label && (headerKey(label.ja) === key || headerKey(label.en) === key));
    // Output-hidden fields are not public: they read as unknown columns.
    if (!named || fd.opts.outputHidden) continue;
    return { kind: 'ignored', reason: fd.opts.serverOwned ? 'server-owned' : 'unsupported' };
  }
  return { kind: 'unknown' };
}

/**
 * AC-10: template header labels of the visible fields the caller may write (`masked`: field-group fields it may not);
 * a label two fields share falls back to the field names so the file maps back.
 */
export function templateHeaders(
  entity: EntityDef,
  locale: Locale,
  masked: ReadonlySet<string>,
  packs?: readonly string[],
): string[] {
  const fields = importFields(entity, packs).filter((f) => !f.hidden && !masked.has(f.name));
  const text = (f: ImportField) => f.label[locale] || f.label.ja || f.name;
  return fields.map((f) => {
    const label = text(f);
    const resolved = resolveHeader(entity, label, packs);
    return resolved.kind === 'field' && resolved.field === f.name ? label : f.name;
  });
}

// ---- cells -----------------------------------------------------------------------------------------

export type CellValue =
  /** Blank cell: the field is left out (create: default applies; update: unchanged). */
  | { status: 'empty' }
  | { status: 'value'; value: string | number | boolean | Date }
  /** `ref` cell: resolved against the target entity by import.ts (code, then displayField). */
  | { status: 'lookup'; text: string }
  | { status: 'invalid'; message: string };

const TRUE_WORDS = new Set(['true', '1', 'yes', 'はい']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'いいえ']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Full-width digits, signs and spaces to ASCII (NFKC), U+2212 minus to '-'. Used for every non-text kind. */
function ascii(raw: string): string {
  return raw.normalize('NFKC').replace(/−/g, '-').trim();
}

/** AC-3: `1,234.50` / `１２３４．５` -> canonical decimal string; never through a JS float. */
export function decimalCell(raw: string): string | undefined {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(ascii(raw).replace(/,/g, ''));
  if (!m || (!m[2] && !m[3])) return undefined;
  const int = (m[2] ?? '').replace(/^0+(?=\d)/, '') || '0';
  const frac = m[3] ?? '';
  return `${m[1] === '-' ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

function intCell(raw: string): number | undefined {
  const s = ascii(raw).replace(/,/g, '');
  if (!/^[+-]?\d+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** AC-3: `YYYY-MM-DD` or `YYYY/MM/DD` (Excel's ja-JP `2026/1/5` too). */
export function dateCell(raw: string): string | undefined {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(ascii(raw));
  if (!m) return undefined;
  const s = `${m[1]}-${(m[2] ?? '').padStart(2, '0')}-${(m[3] ?? '').padStart(2, '0')}`;
  return isLocalDate(s) ? s : undefined;
}

function enumCell(fd: AnyField, raw: string): string | undefined {
  const values = fd.values ?? [];
  const s = ascii(raw);
  if (values.includes(s)) return s;
  const key = headerKey(s);
  const labels = (fd.opts as EnumOpts<string>).labels ?? {};
  const hits = values.filter((v) => {
    const l = labels[v];
    return headerKey(v) === key || (l !== undefined && (headerKey(l.ja) === key || headerKey(l.en) === key));
  });
  return hits.length === 1 ? hits[0] : undefined;
}

function invalid(message: string): CellValue {
  return { status: 'invalid', message };
}

/** AC-3: converts one cell to the field's input type. Blank (or whitespace-only) cells are "not given". */
export function coerceCell(fd: AnyField, raw: string | null | undefined): CellValue {
  if (raw === null || raw === undefined || raw.trim() === '') return { status: 'empty' };
  switch (fd.kind) {
    case 'text':
      return { status: 'value', value: raw };
    case 'int': {
      const n = intCell(raw);
      return n === undefined ? invalid(`"${raw}" is not an integer`) : { status: 'value', value: n };
    }
    case 'decimal': {
      const d = decimalCell(raw);
      return d === undefined ? invalid(`"${raw}" is not a decimal number`) : { status: 'value', value: d };
    }
    case 'bool': {
      const s = headerKey(raw);
      if (TRUE_WORDS.has(s)) return { status: 'value', value: true };
      if (FALSE_WORDS.has(s)) return { status: 'value', value: false };
      return invalid(`"${raw}" is not one of true/false/1/0/yes/no/はい/いいえ`);
    }
    case 'date': {
      const d = dateCell(raw);
      return d === undefined
        ? invalid(`"${raw}" is not a date (YYYY-MM-DD or YYYY/MM/DD)`)
        : { status: 'value', value: d };
    }
    case 'timestamp': {
      const s = ascii(raw);
      const at = TIMESTAMP.test(s) ? new Date(s.replace(' ', 'T')) : undefined;
      return at && !Number.isNaN(at.getTime())
        ? { status: 'value', value: at }
        : invalid(`"${raw}" is not a timestamp with a UTC offset (e.g. 2026-04-01T09:00+09:00)`);
    }
    case 'enum': {
      const v = enumCell(fd, raw);
      return v === undefined
        ? invalid(`"${raw}" is not one of ${(fd.values ?? []).join(', ')} (or their labels)`)
        : { status: 'value', value: v };
    }
    case 'ref':
      return { status: 'lookup', text: raw.trim() };
    case 'uuid': {
      const s = ascii(raw);
      return UUID.test(s) ? { status: 'value', value: s.toLowerCase() } : invalid(`"${raw}" is not a UUID`);
    }
    case 'json':
      return invalid('json fields are not importable');
  }
}

/** Text as the Repository will store it (the field's `normalize`), for key and ref lookups. */
export function storedText(fd: AnyField | undefined, value: string): string {
  return fd?.kind === 'text' ? normalizeText((fd.opts as TextOpts).normalize, value) : value;
}

export function isUuid(s: string): boolean {
  return UUID.test(s);
}
