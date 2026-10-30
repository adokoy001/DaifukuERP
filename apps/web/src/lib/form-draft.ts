// form-ergonomics AC-8: unsaved input of the generic form kept in this tab (sessionStorage) per user + tenant + company
// (the boundary of lib/assist-storage.ts), entity and record (`new`, or `new:<seed key>` for a duplicate / quick
// action), and offered back when the same screen opens again. It generalises the "keep the input through a temporary
// failure" rule (quality-foundation AC-5) to reloads and leaving the screen. Only what the user changed is stored:
// changed header values and the rows of changed line grids; read-only, server-owned, hidden and restricted fields
// (permission field groups) are never stored, and fields the user can no longer see are absent from the meta, so they
// are neither stored nor restored. Personal-data entities (lib/recent-records.ts) keep no draft. Pure; no React.
import type { EntityMeta, FieldMeta } from '../api/types.ts';
import { readRaw, writeRaw, type AssistScope, type AssistStorage } from './assist-storage.ts';
import { extFieldsOf } from './ext.ts';
import { initialValues, type FormValue, type FormValues } from './form.ts';
import { nextRowKey, type GridRow } from './lines.ts';
import { isPersonalDataEntity } from './recent-records.ts';

export interface DraftStorage extends AssistStorage {
  removeItem(key: string): void;
}
/** A storage that can list its keys (window.sessionStorage); only the sign-out clean-up needs this. */
export interface DraftKeyedStorage extends DraftStorage {
  readonly length: number;
  key(index: number): string | null;
}

export interface DraftRow {
  id?: string;
  values: FormValues;
}
export interface FormDraft {
  entity: string;
  /** Record id, `new`, or `new:<seed key>`. */
  target: string;
  /** The record version the input was made on; null for a new record. */
  baseVersion: number | null;
  savedAt: string;
  /** Header values the user changed (field name -> form value). */
  values: FormValues;
  /** Complete rows of each line grid the user changed. */
  lines: Record<string, DraftRow[]>;
}

export const DRAFT_PREFIX = 'daifuku.form-draft.v1.';
/** Older drafts are dropped: the sign-in lasts 12 hours, and a draft is for coming back, not for keeping. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_RAW = 500_000;
const MAX_TEXT = 100_000;

/** Undefined when any part of the boundary is unknown or the entity holds personal data: nothing is read or written. */
export function draftKey(scope: AssistScope | undefined, entity: string, target: string): string | undefined {
  if (!scope?.tenantId || !scope.userId || !scope.companyId || !entity || !target) return undefined;
  if (isPersonalDataEntity(entity)) return undefined;
  return `${DRAFT_PREFIX}${JSON.stringify([scope.tenantId, scope.userId, scope.companyId, entity, target])}`;
}

/** The draft target of a form: the record id, else `new` (or `new:<seed key>` for a seeded new record). */
export function draftTarget(recordId: string | undefined, seedKey: string | undefined): string {
  if (recordId) return recordId;
  return seedKey ? `new:${seedKey}` : 'new';
}

/** A field whose value may be kept: a visible, writable input that is not restricted (AC-8). */
export function isDraftField(field: FieldMeta): boolean {
  return (
    !field.hidden && !field.serverOwned && !field.readOnly && field.restricted !== true && field.kind !== 'timestamp'
  );
}

function rowsDiffer(a: readonly GridRow[], b: readonly GridRow[], columns: readonly FieldMeta[]): boolean {
  const shape = (rows: readonly GridRow[]) =>
    JSON.stringify(rows.map((r) => [r.id ?? null, columns.map((c) => r.values[c.name] ?? null)]));
  return shape(a) !== shape(b);
}

export interface DraftInput {
  entity: EntityMeta;
  target: string;
  baseVersion: number | null;
  now: string;
  values: FormValues;
  baseline: FormValues;
  lines: Record<string, GridRow[]>;
  baselineLines: Record<string, GridRow[]>;
  specs: readonly { line: EntityMeta; columns: FieldMeta[] }[];
}

/** The draft of the current input, or undefined when nothing storable differs from the record (or new form). */
export function buildDraft(input: DraftInput): FormDraft | undefined {
  const values: FormValues = {};
  for (const field of [...input.entity.fields, ...extFieldsOf(input.entity)]) {
    if (!isDraftField(field)) continue;
    const value = input.values[field.name];
    if (value === undefined || value === input.baseline[field.name]) continue;
    values[field.name] = value;
  }
  const lines: Record<string, DraftRow[]> = {};
  for (const spec of input.specs) {
    const columns = spec.columns.filter(isDraftField);
    const rows = input.lines[spec.line.name] ?? [];
    if (!rowsDiffer(rows, input.baselineLines[spec.line.name] ?? [], columns)) continue;
    lines[spec.line.name] = rows.map((row) => {
      const cells: FormValues = {};
      for (const c of columns) {
        const value = row.values[c.name];
        if (value !== undefined) cells[c.name] = value;
      }
      return { ...(row.id ? { id: row.id } : {}), values: cells };
    });
  }
  if (Object.keys(values).length === 0 && Object.keys(lines).length === 0) return undefined;
  return {
    entity: input.entity.name,
    target: input.target,
    baseVersion: input.baseVersion,
    savedAt: input.now,
    values,
    lines,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function formValues(value: unknown): FormValues | undefined {
  if (!isObject(value)) return undefined;
  const out: FormValues = {};
  for (const [name, v] of Object.entries(value)) {
    if (typeof v === 'boolean' || (typeof v === 'string' && v.length <= MAX_TEXT)) out[name] = v;
    else return undefined;
  }
  return out;
}

/** A stored draft for exactly this entity and target, not older than DRAFT_MAX_AGE_MS; anything else reads as none. */
export function parseDraft(
  raw: string | null | undefined,
  entity: string,
  target: string,
  now: number,
): FormDraft | undefined {
  if (!raw || raw.length > MAX_RAW) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || parsed.version !== 1 || parsed.entity !== entity || parsed.target !== target)
    return undefined;
  const { baseVersion, savedAt } = parsed;
  if (baseVersion !== null && !(typeof baseVersion === 'number' && Number.isInteger(baseVersion))) return undefined;
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return undefined;
  const age = now - Date.parse(savedAt);
  if (age > DRAFT_MAX_AGE_MS || age < -60_000) return undefined;
  const values = formValues(parsed.values);
  if (!values || !isObject(parsed.lines)) return undefined;
  const lines: Record<string, DraftRow[]> = {};
  for (const [name, rows] of Object.entries(parsed.lines)) {
    if (!Array.isArray(rows)) return undefined;
    const out: DraftRow[] = [];
    for (const row of rows) {
      const cells = isObject(row) ? formValues(row.values) : undefined;
      if (!isObject(row) || !cells || (row.id !== undefined && typeof row.id !== 'string')) return undefined;
      out.push(typeof row.id === 'string' ? { id: row.id, values: cells } : { values: cells });
    }
    lines[name] = out;
  }
  return { entity, target, baseVersion, savedAt, values, lines };
}

export function serializeDraft(draft: FormDraft): string {
  return JSON.stringify({ version: 1, ...draft });
}

/**
 * Whether a stored draft is offered: a new-record draft always; a record draft only while the record still has the
 * version the input was made on (`stale` otherwise: someone saved in between, so the input is not restored).
 */
export function draftOffer(draft: FormDraft, recordVersion: number | undefined): 'offer' | 'stale' {
  if (draft.baseVersion === null) return recordVersion === undefined ? 'offer' : 'stale';
  return draft.baseVersion === recordVersion ? 'offer' : 'stale';
}

function sameKind(field: FieldMeta, value: FormValue): boolean {
  return field.kind === 'bool' ? typeof value === 'boolean' : typeof value === 'string';
}

/**
 * The form state with a draft restored over the record's (or new form's) baseline. Only fields and columns that are
 * still storable in the current meta are applied; a row keeps the record's values of columns the draft does not hold.
 */
export function applyDraft(
  draft: FormDraft,
  base: {
    entity: EntityMeta;
    values: FormValues;
    lines: Record<string, GridRow[]>;
    specs: readonly { line: EntityMeta; columns: FieldMeta[] }[];
  },
): { values: FormValues; lines: Record<string, GridRow[]> } {
  const values: FormValues = { ...base.values };
  for (const field of [...base.entity.fields, ...extFieldsOf(base.entity)]) {
    const value = draft.values[field.name];
    if (value !== undefined && isDraftField(field) && sameKind(field, value)) values[field.name] = value;
  }
  const lines: Record<string, GridRow[]> = { ...base.lines };
  for (const spec of base.specs) {
    const rows = draft.lines[spec.line.name];
    if (!rows) continue;
    const columns = spec.columns.filter(isDraftField);
    const existing = new Map((base.lines[spec.line.name] ?? []).flatMap((r) => (r.id ? [[r.id, r] as const] : [])));
    // A row id the record no longer has is dropped rather than re-created as a new row.
    lines[spec.line.name] = rows.flatMap((row) => {
      const from = row.id ? existing.get(row.id) : undefined;
      if (row.id && !from) return [];
      const cells: FormValues = { ...(from?.values ?? initialValues(spec.columns)) };
      for (const c of columns) {
        const value = row.values[c.name];
        if (value !== undefined && sameKind(c, value)) cells[c.name] = value;
      }
      return [{ key: nextRowKey(), ...(from?.id ? { id: from.id } : {}), values: cells }];
    });
  }
  return { values, lines };
}

/** Reading `sessionStorage` itself throws when site data is blocked; that is "no storage", not an error. */
export function draftStorage(): DraftKeyedStorage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readDraft(
  storage: DraftStorage | undefined,
  key: string | undefined,
  entity: string,
  target: string,
  now: number,
): FormDraft | undefined {
  return parseDraft(readRaw(storage, key), entity, target, now);
}

/** False when the draft could not be kept (no storage, quota exceeded, unknown boundary). */
export function writeDraft(storage: DraftStorage | undefined, key: string | undefined, draft: FormDraft): boolean {
  return writeRaw(storage, key, serializeDraft(draft));
}

export function removeDraft(storage: DraftStorage | undefined, key: string | undefined): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    /* Storage can be unavailable in private sessions. */
  }
}

/** Explicit sign-out: every form draft of this tab is removed (a shared computer keeps no typed values). Never throws. */
export function forgetDrafts(storage: DraftKeyedStorage | undefined): number {
  if (!storage) return 0;
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
  } catch {
    return 0;
  }
  for (const key of keys) removeDraft(storage, key);
  return keys.length;
}
