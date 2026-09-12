import type { FormValues } from './form.ts';
import { schemaInitialValues, schemaToPayload, type SchemaField } from './schema.ts';

export interface SchemaModeState {
  values: FormValues;
  errors: Record<string, string>;
  json: string;
  jsonMode: boolean;
}

/** A switch is a conversion, never an independent buffer swap. Unknown JSON keys remain in the buffer. */
export function switchSchemaMode(state: SchemaModeState, fields: readonly SchemaField[]): SchemaModeState {
  if (!state.jsonMode) {
    const { payload, errors } = schemaToPayload(state.values, fields);
    if (Object.keys(errors).length > 0) return { ...state, errors };
    let previous: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(state.json);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) previous = value as Record<string, unknown>;
    } catch { /* The valid form values replace an invalid old buffer. */ }
    for (const field of fields) delete previous[field.name];
    return { ...state, json: JSON.stringify({ ...previous, ...payload }, null, 2), jsonMode: true, errors: {} };
  }
  try {
    const value: unknown = JSON.parse(state.json);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...state, errors: { _json: 'オブジェクト形式の JSON を入力してください / Enter a JSON object.' } };
    return { ...state, values: schemaInitialValues(fields, value as Record<string, unknown>), jsonMode: false, errors: {} };
  } catch {
    return { ...state, errors: { _json: 'JSON の書式を確認してください / Check the JSON syntax.' } };
  }
}
