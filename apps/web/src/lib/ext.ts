// Ext fields in the generic UI (web-phase15 AC-3, ADR-0014): `/meta` lists them in `EntityMeta.extFields` with
// `name: 'ext.<key>'`; the value lives at `row.ext[key]`. Form values are keyed by that dotted name (it cannot collide with
// an entity field name) and go through the same widgets and conversions as ordinary fields. Pure; ext.test.ts.
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { initialValues, isFieldEditable, toPayload, type EditContext, type FormValues } from './form.ts';

export const EXT_PREFIX = 'ext.';

export function isExtFieldName(name: string): boolean {
  return name.startsWith(EXT_PREFIX) && name.length > EXT_PREFIX.length;
}

/** `ext.rank` -> `rank`. */
export function extKey(name: string): string {
  return isExtFieldName(name) ? name.slice(EXT_PREFIX.length) : name;
}

/** The entity's registered ext fields that the form renders (well-formed names, not hidden). */
export function extFieldsOf(entity: EntityMeta): FieldMeta[] {
  return (entity.extFields ?? []).filter((f) => isExtFieldName(f.name) && !f.hidden);
}

function extObject(row: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const ext = row?.ext;
  return typeof ext === 'object' && ext !== null && !Array.isArray(ext) ? (ext as Record<string, unknown>) : {};
}

/** The value of a field on a record: `row.ext[key]` for `ext.<key>`, `row[name]` otherwise (list cells, ref labels). */
export function fieldValue(row: Readonly<Record<string, unknown>>, field: Pick<FieldMeta, 'name'>): unknown {
  return isExtFieldName(field.name) ? extObject(row)[extKey(field.name)] : row[field.name];
}

/** List columns (AC-3): `views.list` names resolved against the entity fields and, for `ext.<key>`, its ext fields. */
export function listColumns(entity: EntityMeta): FieldMeta[] {
  const all = [...entity.fields, ...extFieldsOf(entity)];
  return entity.views.list.flatMap((n) => all.filter((f) => f.name === n));
}

/** Form values of the ext fields read from `record.ext` (blank form without a record). */
export function extInitialValues(fields: readonly FieldMeta[], record?: RecordJson): FormValues {
  if (fields.length === 0) return {};
  if (!record) return initialValues(fields);
  const ext = extObject(record);
  const view: Record<string, unknown> = {};
  for (const f of fields) view[f.name] = ext[extKey(f.name)];
  return initialValues(fields, view);
}

/** Submitted documents: ext fields are editable only when `allowOnSubmit` names `ext` (or the dotted field itself). */
export function isExtFieldEditable(field: FieldMeta, ctx: EditContext): boolean {
  const allow = ctx.allowOnSubmit ?? [];
  return isFieldEditable(field, { ...ctx, allowOnSubmit: allow.includes('ext') ? [...allow, field.name] : allow });
}

export interface ExtPayloadInput {
  values: FormValues;
  fields: readonly FieldMeta[];
  mode: 'create' | 'update';
  record?: RecordJson | undefined;
  requiredMessage: string;
}

export interface ExtPayload {
  /** The whole `ext` object to send (the kernel replaces `ext` as a unit); undefined when there is nothing to send. */
  ext: Record<string, unknown> | undefined;
  /** Field name (`ext.<key>`) -> message. */
  errors: Record<string, string>;
}

/** Whether any registered key converts to a different value than the record's (so an untouched ext is not re-sent). */
function extChanged(input: ExtPayloadInput, payload: Record<string, unknown>): boolean {
  if (input.mode === 'create') return Object.values(payload).some((v) => v !== null);
  const original = toPayload(extInitialValues(input.fields, input.record), input.fields, 'update').payload;
  return input.fields.some((f) => JSON.stringify(payload[f.name] ?? null) !== JSON.stringify(original[f.name] ?? null));
}

/**
 * Form values -> `ext` (AC-3). Keys the form does not render (ADR-0003 free-form keys, ext registered after the page
 * loaded) are kept from the record, empty values drop their key, required ext fields must have a value. Create sends
 * `ext` only when something was entered; update only when a registered key changed.
 */
export function extPayload(input: ExtPayloadInput): ExtPayload {
  const { payload, errors } = toPayload(input.values, input.fields, 'update');
  if (!extChanged(input, payload)) {
    const required =
      input.mode === 'create'
        ? input.fields.filter((f) => f.required && !f.hasDefault && !f.serverOwned && !f.readOnly)
        : [];
    for (const f of required) errors[f.name] ??= input.requiredMessage;
    return { ext: undefined, errors };
  }
  const ext: Record<string, unknown> = { ...extObject(input.record) };
  for (const f of input.fields) {
    const v = payload[f.name];
    if (v === undefined) continue; // timestamps are never sent: keep the stored value
    if (v !== null) {
      ext[extKey(f.name)] = v;
      continue;
    }
    delete ext[extKey(f.name)];
    if (f.required && !f.hasDefault) errors[f.name] ??= input.requiredMessage;
  }
  return { ext, errors };
}
