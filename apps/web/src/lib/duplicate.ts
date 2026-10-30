// document-links AC-1/AC-5/AC-7: initial values for a new record ("draft seed") — built from a record by 複製 or from a
// quick action, handed to /e/:entity/new through router history state, and turned into form state by record-form.tsx.
// Pure (duplicate.test.ts). Nothing is created until the user saves.
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { extFieldsOf, extInitialValues } from './ext.ts';
import { initialValues, type FormValues } from './form.ts';
import { linesFromRecord, type GridRow } from './lines.ts';

/** Where a seed came from: shown above the form ("INV-2026-0001 を複製しています") with a link back. */
export interface SeedSource {
  mode: 'duplicate' | 'quick';
  entity: string;
  id: string;
  /** Number, display value or short id of the source record. */
  title: string;
  /** The source's business date (the copy uses today's date instead). */
  date: string | null;
  /** Quick action id (lib/quick-actions.ts) for mode `quick`. */
  action?: string;
}

/** Initial values of a new record (API JSON values, as `GET /api/:entity/:id` returns them). */
export interface DraftSeed {
  kind: typeof SEED_KIND;
  /** Unique per launch: the form remounts for a new seed. */
  key: string;
  /** The entity whose new-record page the seed is for; ignored on any other page. */
  entity: string;
  values: Record<string, unknown>;
  ext: Record<string, unknown>;
  /** line entity -> rows without ids (they are new rows of the new record). */
  lines: Record<string, Record<string, unknown>[]>;
  source: SeedSource;
}

export const SEED_KIND = 'daifuku.draft-seed.v1';
/** Router history state key. */
export const SEED_STATE_KEY = 'draftSeed';

let seedCounter = 0;
export function seedKey(): string {
  seedCounter += 1;
  return `${Date.now().toString(36)}-${seedCounter}`;
}

/** The browser's calendar date as YYYY-MM-DD (the date a person means by "today"). */
export function todayLocal(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * AC-1: fields a copy leaves out — server-owned / read-only (totals, status, journal links), timestamps, hidden fields,
 * and values that must differ per record (`unique`: codes, the numbering field). System columns, `docstatus`, `number`
 * and `amendedFrom` are not entity fields and are never copied either.
 */
export function isCopyable(field: FieldMeta): boolean {
  return !field.serverOwned && !field.readOnly && !field.hidden && !field.unique && field.kind !== 'timestamp';
}

function copyValue(field: FieldMeta, value: unknown, today: string): unknown {
  // AC-1 (open question resolved): a dated field with a default ("today") takes today's date; other dates are left
  // empty so derived dates (due dates computed from payment terms) are recomputed instead of copied stale.
  if (field.kind === 'date') return field.hasDefault ? today : null;
  return value === undefined ? null : value;
}

function copyFields(
  fields: readonly FieldMeta[],
  row: Readonly<Record<string, unknown>>,
  today: string,
  skip: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (isCopyable(f) && !skip.has(f.name)) out[f.name] = copyValue(f, row[f.name], today);
  return out;
}

function copyExt(entity: EntityMeta, record: RecordJson, today: string): Record<string, unknown> {
  const ext = record.ext && typeof record.ext === 'object' ? record.ext : {};
  const out: Record<string, unknown> = {};
  for (const f of extFieldsOf(entity)) {
    const key = f.name.slice('ext.'.length);
    if (isCopyable(f) && key in ext) out[key] = copyValue(f, ext[key], today);
  }
  return out;
}

/** Line entities of a document the caller can read (present in /meta), with their parent field. */
function lineMetas(entity: EntityMeta, entities: readonly EntityMeta[]): { line: EntityMeta; parentField: string }[] {
  return (entity.lines ?? []).flatMap((spec) => {
    const line = entities.find((e) => e.name === spec.entity);
    return line ? [{ line, parentField: spec.parentField }] : [];
  });
}

/** AC-1: a copy of `record` as a new draft of the same entity (no ids, numbers, statuses or server-owned values). */
export function duplicateSeed(
  entity: EntityMeta,
  record: RecordJson,
  entities: readonly EntityMeta[],
  today: string,
  title: string,
): DraftSeed {
  const lines: Record<string, Record<string, unknown>[]> = {};
  for (const { line, parentField } of lineMetas(entity, entities)) {
    const skip = new Set([parentField, 'seq']);
    lines[line.name] = (record.lines?.[line.name] ?? []).map((row) => copyFields(line.fields, row, today, skip));
  }
  return {
    kind: SEED_KIND,
    key: seedKey(),
    entity: entity.name,
    values: copyFields(entity.fields, record, today, new Set()),
    ext: copyExt(entity, record, today),
    lines,
    source: {
      mode: 'duplicate',
      entity: entity.name,
      id: record.id,
      title,
      date: typeof record.date === 'string' ? record.date : null,
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A seed read back from router history state: only a well-formed seed for `entity` is used (state survives reloads). */
export function seedFromState(state: unknown, entity: string): DraftSeed | undefined {
  const seed = isObject(state) ? state[SEED_STATE_KEY] : undefined;
  if (!isObject(seed) || seed.kind !== SEED_KIND || seed.entity !== entity || typeof seed.key !== 'string')
    return undefined;
  if (!isObject(seed.values) || !isObject(seed.ext) || !isObject(seed.lines) || !isObject(seed.source))
    return undefined;
  const lines = seed.lines;
  if (!Object.values(lines).every((rows) => Array.isArray(rows) && rows.every(isObject))) return undefined;
  const src = seed.source;
  if (
    (src.mode !== 'duplicate' && src.mode !== 'quick') ||
    typeof src.entity !== 'string' ||
    typeof src.id !== 'string' ||
    typeof src.title !== 'string'
  )
    return undefined;
  return seed as unknown as DraftSeed;
}

/** Router history state carrying the seed (spread over the current state by the caller). */
export function seedState(seed: DraftSeed): Record<string, unknown> {
  return { [SEED_STATE_KEY]: seed };
}

/**
 * Header form values of a seeded new record: the entity defaults, overridden by the seed's values (fields the seed
 * leaves out keep their default), plus the seed's ext values.
 */
export function seededValues(entity: EntityMeta, seed: DraftSeed): FormValues {
  const given = entity.fields.filter((f) => f.name in seed.values);
  const ext = extFieldsOf(entity);
  const extGiven = ext.filter((f) => f.name.slice('ext.'.length) in seed.ext);
  return {
    ...initialValues(entity.fields),
    ...initialValues(given, seed.values),
    ...extInitialValues(ext),
    ...extInitialValues(extGiven, { ext: seed.ext } as unknown as RecordJson),
  };
}

/** Grid rows of a seeded new record: every row is new (no id). */
export function seededLines(
  specs: readonly { line: EntityMeta; columns: FieldMeta[] }[],
  seed: DraftSeed,
): Record<string, GridRow[]> {
  const rows = linesFromRecord(specs, { lines: seed.lines } as unknown as RecordJson);
  return Object.fromEntries(
    Object.entries(rows).map(([name, list]) => [name, list.map(({ key, values }) => ({ key, values }))]),
  );
}
