// Presentation attributes of company settings (ADR-0027): the category tab, the order inside it, and per-property
// labels / widgets for the generic settings console. checkSettingDef runs at registerSetting, so a label for a property
// that does not exist, a widget on the wrong kind of value or a default the schema rejects fails at definition time.
import { z } from 'zod';
import { isAppHref } from './app-href.ts';
import type { Label } from './i18n.ts';

/** Tabs of the settings console, in display order. */
export const SETTING_CATEGORIES = [
  'company',
  'accounting',
  'tax',
  'sales',
  'purchase',
  'inventory',
  'contract',
  'workforce',
  'industry',
  'integration',
  'system',
] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

/**
 * Input widgets beyond what the JSON Schema implies. `account-code` / `warehouse-code` pick an existing code (the stored
 * value stays the code string); `textarea` is multi-line text.
 */
export const SETTING_WIDGETS = ['account-code', 'warehouse-code', 'textarea'] as const;
export type SettingWidget = (typeof SETTING_WIDGETS)[number];

/** How one property of an object setting (or the single value of a scalar setting) is shown. */
export interface SettingFieldDef {
  label: Label;
  description?: Label;
  widget?: SettingWidget;
  /** Labels of enum values (keys must be values of the property's enum). */
  valueLabels?: Readonly<Record<string, Label>>;
}

/**
 * A setting kept by a dedicated screen (setup-wizard AC-12, ADR-0027 §8): the settings console shows its state, help,
 * history and a link to that screen instead of an editor. Presentation only: PUT / DELETE and their checks are unchanged.
 */
export interface SettingManagedBy {
  /** In-app path of the screen (isAppHref). */
  href: string;
  /** Name of the screen, used as "Change in <label>". */
  label: Label;
}

/**
 * The parts of a SettingDef (registry.ts) this module reads. Declared structurally here so the registry can call
 * checkSettingDef without an import cycle.
 */
export interface SettingPresentation {
  key: string;
  label: Label;
  description?: Label;
  schema: z.ZodType;
  default?: unknown;
  category?: SettingCategory;
  order?: number;
  fields?: Readonly<Record<string, SettingFieldDef>>;
  widget?: SettingWidget;
  valueLabels?: Readonly<Record<string, Label>>;
  managedBy?: SettingManagedBy;
  /** Not presentation (registry.ts SettingDef.writeRoles); checked here with the rest of the definition. */
  writeRoles?: readonly string[];
}

/** Key prefixes whose category differs from "industry" when the definition does not name one (spec AC-3). */
const PREFIX_CATEGORIES: Readonly<Record<string, SettingCategory>> = {
  company: 'company',
  tax: 'tax',
  sales: 'sales',
  purchase: 'purchase',
  payment: 'accounting',
  accounting: 'accounting',
  inventory: 'inventory',
  contract: 'contract',
  workforce: 'workforce',
  packs: 'system',
};

/** The category a key falls into when its definition names none: by the module prefix, packs/industry keys -> industry. */
export function defaultSettingCategory(key: string): SettingCategory {
  const prefix = key.split('.')[0] ?? '';
  return Object.hasOwn(PREFIX_CATEGORIES, prefix) ? (PREFIX_CATEGORIES[prefix] as SettingCategory) : 'industry';
}

export function settingCategory(def: Pick<SettingPresentation, 'key' | 'category'>): SettingCategory {
  return def.category ?? defaultSettingCategory(def.key);
}

interface JsonNode {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: JsonNode[];
  oneOf?: JsonNode[];
  properties?: Record<string, JsonNode>;
}

/** The value kind of a schema as the settings console sees it (JSON Schema `input` side, like GET /meta/settings). */
export interface SettingValueInfo {
  /** JSON Schema type after removing a nullable wrapper (`string`, `integer`, `object`, ...), when there is one. */
  type?: string;
  /** String enum values, when the value is an enum. */
  enum?: string[];
}

export type SettingShape =
  | { kind: 'object'; properties: Record<string, SettingValueInfo> }
  | ({ kind: 'scalar' } & SettingValueInfo)
  | { kind: 'other' };

function valueInfo(node: JsonNode): SettingValueInfo {
  const members = node.anyOf ?? node.oneOf;
  if (members) {
    const nonNull = members.filter((m) => m.type !== 'null');
    if (nonNull.length === 1 && nonNull[0]) return valueInfo(nonNull[0]);
  }
  const out: SettingValueInfo = {};
  const types = Array.isArray(node.type) ? node.type.filter((t) => t !== 'null') : node.type ? [node.type] : [];
  if (types.length === 1 && types[0]) out.type = types[0];
  if (Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((v) => typeof v === 'string'))
    out.enum = node.enum as string[];
  return out;
}

/**
 * Object (fixed properties), scalar (string / number / boolean / enum) or other (records, arrays, unrepresentable).
 * Read from the same JSON Schema conversion the API sends, so the console and this check agree on property names.
 * The top level follows the console's rule (apps/web settingForm): a union at the top (`anyOf` / `oneOf`, e.g. a
 * nullable setting) and an object whose `type` is not exactly `object` are "other" (raw JSON), so `fields` / `widget`
 * on them are refused instead of being ignored by the console. Properties are unwrapped like the console's form
 * fields do (a nullable property is still a string field).
 */
export function settingShape(schema: z.ZodType): SettingShape {
  let json: JsonNode;
  try {
    json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonNode;
  } catch {
    return { kind: 'other' };
  }
  if (json.anyOf || json.oneOf) return { kind: 'other' };
  const info = valueInfo(json);
  if (info.type === 'object') {
    const props = json.properties;
    if (json.type !== 'object' || !props || Object.keys(props).length === 0) return { kind: 'other' };
    return { kind: 'object', properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, valueInfo(v)])) };
  }
  if (info.type === 'array' || (info.type === undefined && info.enum === undefined)) return { kind: 'other' };
  return { kind: 'scalar', ...info };
}

function isLabel(value: unknown): value is Label {
  if (typeof value !== 'object' || value === null) return false;
  const l = value as Record<string, unknown>;
  return typeof l.ja === 'string' && l.ja.trim() !== '' && typeof l.en === 'string' && l.en.trim() !== '';
}

function checkField(key: string, path: string, field: SettingFieldDef, info: SettingValueInfo): void {
  const where = `setting "${key}" ${path}`;
  if (!isLabel(field.label)) throw new Error(`${where}: label must have non-empty ja and en text`);
  if (field.description !== undefined && !isLabel(field.description))
    throw new Error(`${where}: description must have non-empty ja and en text`);
  if (field.widget !== undefined) {
    if (!(SETTING_WIDGETS as readonly string[]).includes(field.widget))
      throw new Error(`${where}: unknown widget "${String(field.widget)}" (use one of ${SETTING_WIDGETS.join(', ')})`);
    if (info.type !== 'string' || info.enum)
      throw new Error(`${where}: widget "${field.widget}" needs a plain string value, not ${info.type ?? 'unknown'}`);
  }
  if (field.valueLabels !== undefined) {
    if (!info.enum) throw new Error(`${where}: valueLabels are only for enum values`);
    for (const [value, l] of Object.entries(field.valueLabels)) {
      if (!info.enum.includes(value))
        throw new Error(`${where}: valueLabels has "${value}", which is not one of ${info.enum.join(', ')}`);
      if (!isLabel(l)) throw new Error(`${where}: valueLabels.${value} must have non-empty ja and en text`);
    }
  }
}

/** Definition errors (plain Error: a developer fixes the declaration; docs/conventions/errors.md). */
export function checkSettingDef(def: SettingPresentation): void {
  const key = def.key;
  if (!isLabel(def.label)) throw new Error(`setting "${key}": label must have non-empty ja and en text`);
  if (def.description !== undefined && !isLabel(def.description))
    throw new Error(`setting "${key}": description must have non-empty ja and en text`);
  if (def.category !== undefined && !(SETTING_CATEGORIES as readonly string[]).includes(def.category))
    throw new Error(
      `setting "${key}": unknown category "${String(def.category)}" (use one of ${SETTING_CATEGORIES.join(', ')})`,
    );
  if (def.order !== undefined && !Number.isInteger(def.order))
    throw new Error(`setting "${key}": order must be an integer`);
  const shape = settingShape(def.schema);
  if (def.fields !== undefined) {
    if (shape.kind !== 'object')
      throw new Error(
        `setting "${key}": fields are only for object schemas with fixed properties; use widget/valueLabels for a single value`,
      );
    for (const [name, field] of Object.entries(def.fields)) {
      const info = shape.properties[name];
      if (!info)
        throw new Error(
          `setting "${key}": fields.${name} is not a property of the schema (properties: ${Object.keys(shape.properties).join(', ')})`,
        );
      checkField(key, `fields.${name}`, field, info);
    }
  }
  if (def.widget !== undefined || def.valueLabels !== undefined) {
    if (shape.kind !== 'scalar')
      throw new Error(`setting "${key}": widget/valueLabels describe a single value; use fields for object schemas`);
    const field: SettingFieldDef = { label: def.label };
    if (def.widget !== undefined) field.widget = def.widget;
    if (def.valueLabels !== undefined) field.valueLabels = def.valueLabels;
    checkField(key, 'value', field, shape);
  }
  if (def.default !== undefined && !def.schema.safeParse(def.default).success)
    throw new Error(`setting "${key}": default does not match the schema`);
  if (def.managedBy !== undefined) {
    if (!isAppHref(def.managedBy.href))
      throw new Error(`setting "${key}": managedBy.href must be an in-app path such as /setup`);
    if (!isLabel(def.managedBy.label))
      throw new Error(`setting "${key}": managedBy.label must have non-empty ja and en text`);
  }
  if (def.writeRoles !== undefined) {
    if (
      !Array.isArray(def.writeRoles) ||
      def.writeRoles.length === 0 ||
      !def.writeRoles.every((role) => typeof role === 'string' && /^[a-z][a-z0-9_]*$/.test(role))
    )
      throw new Error(`setting "${key}": writeRoles must be a non-empty list of role names such as ["admin"]`);
  }
}
