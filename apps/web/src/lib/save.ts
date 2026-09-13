// Save planning for the record form (header + line grids, web-phase1 AC-1): pure so the request shape is unit-tested.
// Create: POST body = insert fields + `lines`. Update: PATCH body = { patch: { ...changed fields, lines? }, expectedVersion }
// — `lines` sits inside `patch` because the kernel's <entity>.update input is `{ id, patch: update ∪ { lines }, expectedVersion }`.
// web-phase15 AC-3: registered ext fields (`ext.<key>` form values) become the `ext` object of the same body/patch.
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { extFieldsOf, extPayload } from './ext.ts';
import { diffPatch, toPayload, type FormValues } from './form.ts';
import { gridColumns, linesChanged, rowsToPayload, type GridErrors, type GridRow } from './lines.ts';

export interface LineSpecMeta {
  line: EntityMeta;
  parentField: string;
  columns: FieldMeta[];
}

/** Line grids of a document: `entity.lines` joined with the line entities' meta (unreadable ones are skipped). */
export function lineSpecsOf(entity: EntityMeta, entities: readonly EntityMeta[]): LineSpecMeta[] {
  return (entity.lines ?? []).flatMap((spec) => {
    const line = entities.find((e) => e.name === spec.entity);
    return line ? [{ line, parentField: spec.parentField, columns: gridColumns(line, spec.parentField) }] : [];
  });
}

export interface SaveInput {
  entity: EntityMeta;
  mode: 'create' | 'update';
  record: RecordJson | undefined;
  values: FormValues;
  specs: readonly LineSpecMeta[];
  lines: Record<string, GridRow[]>;
  /** Rows as loaded from the record (to detect changes). */
  originalLines: Record<string, GridRow[]>;
  requiredMessage: string;
}

export interface SavePlan {
  /** Request body: insert input (create) or `{ patch, expectedVersion }` (update). */
  body: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  lineErrors: Record<string, GridErrors>;
  hasErrors: boolean;
  /** Update with nothing changed. */
  empty: boolean;
}

function lineSets(input: SaveInput): {
  lines: Record<string, Record<string, unknown>[]>;
  errors: Record<string, GridErrors>;
  changed: boolean;
} {
  const lines: Record<string, Record<string, unknown>[]> = {};
  const errors: Record<string, GridErrors> = {};
  let changed = false;
  for (const spec of input.specs) {
    const rows = input.lines[spec.line.name] ?? [];
    const { rows: payload, errors: rowErrors } = rowsToPayload(rows, spec.columns, input.requiredMessage);
    if (Object.keys(rowErrors).length > 0) errors[spec.line.name] = rowErrors;
    const differs =
      input.mode === 'create'
        ? rows.length > 0
        : linesChanged(rows, input.originalLines[spec.line.name] ?? [], spec.columns);
    if (!differs) continue;
    changed = true;
    lines[spec.line.name] = payload;
  }
  return { lines, errors, changed };
}

export function planSave(input: SaveInput): SavePlan {
  const { entity, mode, record, values } = input;
  const { payload, errors } = toPayload(values, entity.fields, mode);
  for (const f of entity.fields) {
    if (
      mode === 'create' &&
      f.required &&
      !f.hasDefault &&
      !f.hidden &&
      !f.serverOwned &&
      !f.readOnly &&
      payload[f.name] === undefined &&
      f.kind !== 'timestamp'
    )
      errors[f.name] = input.requiredMessage;
  }
  const ext = extPayload({ values, fields: extFieldsOf(entity), mode, record, requiredMessage: input.requiredMessage });
  Object.assign(errors, ext.errors);
  const sets = lineSets(input);
  const hasErrors = Object.keys(errors).length > 0 || Object.keys(sets.errors).length > 0;
  if (mode === 'create' || !record) {
    const body: Record<string, unknown> = ext.ext ? { ...payload, ext: ext.ext } : { ...payload };
    if (sets.changed) body.lines = sets.lines;
    return { body, fieldErrors: errors, lineErrors: sets.errors, hasErrors, empty: false };
  }
  const patch: Record<string, unknown> = diffPatch(payload, record, entity.fields);
  if (ext.ext) patch.ext = ext.ext;
  if (sets.changed) patch.lines = sets.lines;
  const empty = Object.keys(patch).length === 0;
  return {
    body: { patch, expectedVersion: record.version },
    fieldErrors: errors,
    lineErrors: sets.errors,
    hasErrors,
    empty,
  };
}
