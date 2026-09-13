// JSON Schema (as emitted by the API's zod -> toJSONSchema) -> form fields (web-phase1 AC-3 report inputs, AC-5 settings).
// Only flat object schemas are rendered field by field; anything else falls back to a JSON textarea. Pure; schema.test.ts.
import type { EntityMeta, FieldMeta, JsonSchema, Label, ValidationIssue } from '../api/types.ts';
import { toPayload, type FormValues } from './form.ts';

export type SchemaKind = 'text' | 'date' | 'enum' | 'number' | 'int' | 'bool' | 'ref' | 'json';

export interface SchemaField {
  name: string;
  kind: SchemaKind;
  label: Label;
  required: boolean;
  default?: unknown;
  description?: string;
  values?: string[];
  ref?: string;
  refDisplayField?: string;
}

function humanize(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function toSnake(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const DATE_NAME_RE = /^(from|to|date|since|until|asOf)$|Date$|From$|To$/;
/** Matches a JSON Schema `pattern` written for YYYY-MM-DD (the literal text `\d{4}-\d{2}-\d{2}`). */
const DATE_PATTERN_RE = /\\d\{4\}-\\d\{2\}-\\d\{2\}/;

/** Collapses `anyOf`/`type: [..., 'null']` nullable wrappers to the non-null member. */
function unwrap(schema: JsonSchema): JsonSchema {
  const { anyOf, oneOf, ...rest } = schema;
  const members = anyOf ?? oneOf;
  if (members) {
    const nonNull = members.filter((m) => m.type !== 'null');
    if (nonNull.length === 1 && nonNull[0]) return unwrap({ ...rest, ...nonNull[0] });
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t) => t !== 'null');
    const first = types[0];
    return types.length === 1 && first !== undefined ? { ...schema, type: first } : { ...schema, type: types };
  }
  return schema;
}

export interface RefResolver {
  (entityName: string): { displayField: string | undefined; entityName?: string } | undefined;
}

/** Resolver over the entities visible in /meta (unknown or unreadable entities stay plain text inputs). */
export function refResolverFrom(entities: readonly EntityMeta[] | undefined, module?: string): RefResolver {
  return (name) => {
    const e = entities?.find((x) => x.name === name) ?? entities?.find((x) => module && x.name === `${module}_${name}`);
    return e ? { displayField: e.displayField, ...(e.name === name ? {} : { entityName: e.name }) } : undefined;
  };
}

/**
 * "ref-by-name": `<entity>Id` (camelCase -> snake_case) names an entity visible in /meta; a qualified prefix is allowed
 * (`defaultPartnerId` -> `default_partner` -> `partner`), longest entity suffix wins.
 */
function refByName(name: string, refOf: RefResolver): { ref: string; displayField: string | undefined } | undefined {
  const m = /^(.+)Id$/.exec(name);
  if (!m?.[1]) return undefined;
  const parts = toSnake(m[1]).split('_');
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join('_');
    const target = refOf(candidate);
    if (target) return { ref: target.entityName ?? candidate, displayField: target.displayField };
  }
  return undefined;
}

function kindOf(
  name: string,
  s: JsonSchema,
  refOf: RefResolver,
): { kind: SchemaKind; ref?: string; refDisplayField?: string } {
  if (Array.isArray(s.enum) && s.enum.every((v) => typeof v === 'string')) return { kind: 'enum' };
  if (s.type === 'boolean') return { kind: 'bool' };
  if (s.type === 'integer') return { kind: 'int' };
  if (s.type === 'number') return { kind: 'number' };
  if (s.type === 'string') {
    const target = s.format === 'uuid' || s.format === undefined ? refByName(name, refOf) : undefined;
    if (target)
      return target.displayField
        ? { kind: 'ref', ref: target.ref, refDisplayField: target.displayField }
        : { kind: 'ref', ref: target.ref };
    if (
      s.format === 'date' ||
      DATE_NAME_RE.test(name) ||
      (typeof s.pattern === 'string' && DATE_PATTERN_RE.test(s.pattern))
    )
      return { kind: 'date' };
    return { kind: 'text' };
  }
  return { kind: 'json' };
}

/** Fields of a flat object schema in declaration order. Returns [] for non-object schemas (caller falls back to JSON). */
export function schemaFields(schema: JsonSchema | undefined, refOf: RefResolver): SchemaField[] {
  if (!schema || schema.type !== 'object' || !schema.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([name, raw]) => {
    const s = unwrap(raw);
    const k = kindOf(name, s, refOf);
    const f: SchemaField = {
      name,
      kind: k.kind,
      label: { ja: s.title ?? humanize(name), en: s.title ?? humanize(name) },
      required: required.has(name) && s.default === undefined,
    };
    if (s.default !== undefined) f.default = s.default;
    if (typeof s.description === 'string') f.description = s.description;
    if (k.kind === 'enum') f.values = (s.enum ?? []).map(String);
    if (k.ref) f.ref = k.ref;
    if (k.refDisplayField) f.refDisplayField = k.refDisplayField;
    return f;
  });
}

const FIELD_KIND: Record<SchemaKind, string> = {
  text: 'text',
  date: 'date',
  enum: 'enum',
  number: 'decimal',
  int: 'int',
  bool: 'bool',
  ref: 'ref',
  json: 'json',
};

/** Adapter so the entity form widgets (FieldWidget) render schema fields unchanged. */
export function toFieldMeta(f: SchemaField): FieldMeta {
  const meta: FieldMeta = {
    name: f.name,
    kind: FIELD_KIND[f.kind],
    label: f.label,
    required: f.required,
    hasDefault: f.default !== undefined,
    hidden: false,
    immutable: false,
  };
  if (f.description) meta.description = { ja: f.description, en: f.description };
  if (f.values) meta.values = f.values;
  if (f.ref) meta.ref = f.ref;
  if (f.refDisplayField) meta.refDisplayField = f.refDisplayField;
  return meta;
}

function defaultValue(f: SchemaField, current: unknown): string | boolean {
  const v = current !== undefined ? current : f.default;
  if (f.kind === 'bool') return v === true;
  if (v === undefined || v === null) return '';
  if (f.kind === 'json') return JSON.stringify(v, null, 2);
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
}

/** Initial form values: `current` (a stored setting value) wins over schema defaults. */
export function schemaInitialValues(
  fields: readonly SchemaField[],
  current?: Record<string, unknown> | null,
): FormValues {
  const out: FormValues = {};
  for (const f of fields) out[f.name] = defaultValue(f, current?.[f.name]);
  return out;
}

/** Form values -> JSON payload. Empty values are omitted (server defaults apply); JSON Schema numbers become JS numbers. */
export function schemaToPayload(
  values: FormValues,
  fields: readonly SchemaField[],
): { payload: Record<string, unknown>; errors: Record<string, string> } {
  const metas = fields.map(toFieldMeta);
  const { payload, errors } = toPayload(values, metas, 'create');
  for (const f of fields) {
    if (f.kind === 'number' && typeof payload[f.name] === 'string') payload[f.name] = Number(payload[f.name]);
    if (f.required && payload[f.name] === undefined && !errors[f.name]) errors[f.name] = 'required';
  }
  return { payload, errors };
}

/** The kernel reports setting issues as `<key>.<field>` (AC-5); the form wants `<field>`. */
export function stripSettingKey(issues: readonly ValidationIssue[], key: string): ValidationIssue[] {
  return issues.map((i) => ({
    ...i,
    path: i.path === key ? '' : i.path.startsWith(`${key}.`) ? i.path.slice(key.length + 1) : i.path,
  }));
}
