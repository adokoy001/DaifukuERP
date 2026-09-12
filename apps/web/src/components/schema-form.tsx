// JSON Schema-driven form (web-phase1 AC-3 report inputs, AC-5 settings). Flat object schemas render one FieldWidget
// per property through lib/schema.ts; anything else (non-object schemas) is edited as raw JSON.
import { useEffect, useState } from 'react';
import { useLocale } from '../i18n.tsx';
import type { FormValue, FormValues } from '../lib/form.ts';
import { schemaInitialValues, schemaToPayload, toFieldMeta, type SchemaField } from '../lib/schema.ts';
import { S } from '../strings.ts';
import { switchSchemaMode } from '../lib/schema-mode.ts';
import { FieldWidget } from './fields/field-widget.tsx';

export interface SchemaFormState {
  values: FormValues;
  errors: Record<string, string>;
  /** Raw JSON text, used when the schema is not a flat object (or the user switched to JSON mode). */
  json: string;
  jsonMode: boolean;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function fresh(fields: readonly SchemaField[], current: unknown, jsonMode: boolean): SchemaFormState {
  return { values: schemaInitialValues(fields, asObject(current)), errors: {}, json: JSON.stringify(current ?? {}, null, 2), jsonMode };
}

export type SchemaPayload = { ok: true; payload: unknown } | { ok: false; errors: Record<string, string> };

/**
 * Form state for one schema; `current` (a stored value) seeds the fields and resets them whenever its identity changes
 * (after a save). `jsonOnly` is for schemas that are not objects (edited as raw JSON). `fields` must be memoised by the
 * caller — the reset effect keys on it.
 */
export function useSchemaForm(fields: readonly SchemaField[], opts: { current?: unknown; jsonOnly?: boolean } = {}) {
  const { current, jsonOnly } = opts;
  const forceJson = jsonOnly === true;
  const [state, setState] = useState<SchemaFormState>(() => fresh(fields, current, forceJson));
  useEffect(() => {
    setState((s) => fresh(fields, current, forceJson || s.jsonMode));
  }, [fields, current, forceJson]);
  const setValue = (name: string, v: FormValue) =>
    setState((s) => {
      const errors = { ...s.errors };
      delete errors[name];
      return { ...s, values: { ...s.values, [name]: v }, errors };
    });
  const setJson = (json: string) => setState((s) => ({ ...s, json, errors: {} }));
  const setErrors = (errors: Record<string, string>) => setState((s) => ({ ...s, errors }));
  const toggleJson = () => setState((s) => forceJson ? s : switchSchemaMode(s, fields));
  /** Values -> JSON payload (form mode) or parsed text (JSON mode); errors are keyed by field, `_json` for the textarea. */
  const build = (): SchemaPayload => {
    if (state.jsonMode) {
      try {
        return { ok: true, payload: JSON.parse(state.json) as unknown };
      } catch (e) {
        return { ok: false, errors: { _json: e instanceof Error ? e.message : 'invalid JSON' } };
      }
    }
    const { payload, errors } = schemaToPayload(state.values, fields);
    return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, payload };
  };
  return { state, setValue, setJson, setErrors, toggleJson, canToggle: !forceJson, build };
}

export interface SchemaFieldsProps {
  fields: readonly SchemaField[];
  form: ReturnType<typeof useSchemaForm>;
  disabled: boolean;
  /** Element id prefix so several schema forms on one page do not collide. */
  idPrefix: string;
}

export function SchemaFields({ fields, form, disabled, idPrefix }: SchemaFieldsProps) {
  const { t } = useLocale();
  const { state } = form;
  if (state.jsonMode) {
    const err = state.errors._json;
    return (
      <div className="flex flex-col gap-0.5">
        <label htmlFor={`${idPrefix}-json`} className="text-xs font-medium text-neutral-700">
          JSON
        </label>
        <textarea id={`${idPrefix}-json`} rows={6} spellCheck={false} className={`input font-mono text-xs ${err ? 'input-error' : ''}`} value={state.json} disabled={disabled} aria-invalid={err !== undefined} onChange={(e) => form.setJson(e.target.value)} />
        {err ? (
          <span role="alert" className="text-xs text-red-700">
            {err}
          </span>
        ) : (
          <span className="text-[11px] text-neutral-500">{t(S.jsonHint)}</span>
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-3">
      {fields.map((f) => (
        <FieldWidget key={f.name} idPrefix={idPrefix} field={toFieldMeta(f)} value={state.values[f.name] ?? ''} onChange={(v) => form.setValue(f.name, v)} disabled={disabled} error={state.errors[f.name]} />
      ))}
    </div>
  );
}
