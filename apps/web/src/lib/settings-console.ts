// Settings console (docs/specs/settings-console.md AC-8..AC-12): tabs by category, order inside a tab, how a setting
// becomes form fields (object / single value / raw JSON), and the text of defaults and history entries. Pure.
import type { JsonSchema, Label, Locale, SettingChange, SettingMeta } from '../api/types.ts';
import { formatTimestamp, shortId } from './format.ts';
import { schemaFields, type RefResolver, type SchemaField } from './schema.ts';

const L = (ja: string, en: string): Label => ({ ja, en });
/** Same rule as i18n.tsx `tr`, kept local so this module stays free of React. */
const tr = (label: Label, locale: Locale): string => label[locale] || label.en;

/** UI strings of the console (kept here, next to the logic that picks them). */
export const SC = {
  subtitle: L(
    '会社ごとの業務設定です。分類のタブから選び、値を変えて「保存」を押します。',
    'Business settings of the current company. Pick a category tab, change a value and press Save.',
  ),
  tabs: L('設定の分類', 'Setting categories'),
  usingDefault: L('既定値を使用中', 'Using the default'),
  customized: L('会社の値', 'Company value'),
  notSet: L('未設定', 'Not set'),
  defaultIs: L('既定値', 'Default'),
  noDefault: L('既定値なし（未設定のまま使われます）', 'No default (used as not set)'),
  invalidStored: L(
    '保存されている値が定義に合わないため、既定値が使われています。保存し直すか、既定に戻してください。',
    'The stored value no longer matches the definition, so the default applies. Save again or reset to the default.',
  ),
  reset: L('既定に戻す', 'Reset to default'),
  resetTitle: L('「{label}」を既定に戻す', 'Reset "{label}" to the default'),
  resetDone: L('既定に戻しました', 'Reset to the default'),
  resetBack: L('戻る', 'Go back'),
  resetDescriptionDefault: L(
    '会社の値を削除し、既定値（{value}）を使います。変更は履歴に残ります。',
    'The company value is removed and the default ({value}) applies. The change stays in the history.',
  ),
  resetDescriptionNoDefault: L(
    '会社の値を削除し、未設定に戻します。変更は履歴に残ります。',
    'The company value is removed and the setting is not set again. The change stays in the history.',
  ),
  history: L('変更履歴', 'Change history'),
  historyEmpty: L('変更の記録はありません', 'No changes recorded'),
  historyNote: L('直近 20 件、新しい順', 'Latest 20, newest first'),
  opUpdate: L('変更', 'Changed'),
  opDelete: L('既定に戻す', 'Reset to default'),
  onBehalfOf: L('{name} の代理', 'for {name}'),
  yes: L('はい', 'Yes'),
  no: L('いいえ', 'No'),
  choose: L('選択してください', 'Choose…'),
  codeMissing: {
    'account-code': L('「{code}」は有効な勘定科目にありません', '"{code}" is not an active account'),
    'warehouse-code': L('「{code}」は倉庫にありません', '"{code}" is not a warehouse'),
  },
  codeNotFoundOption: L('{code}（見つかりません）', '{code} (not found)'),
  codeUnavailable: L(
    '一覧を読み込めないため、コードを直接入力してください。',
    'The list could not be loaded; enter the code directly.',
  ),
  codesTruncated: L('先頭 {n} 件だけを表示しています。', 'Only the first {n} are listed.'),
} as const;

export function fill(label: Label, locale: Locale, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, String(v)), tr(label, locale));
}

/** Tab labels of the kernel's SETTING_CATEGORIES (ADR-0027), in display order. */
export const SETTING_CATEGORY_LABELS: Readonly<Record<string, Label>> = {
  company: L('会社', 'Company'),
  accounting: L('会計', 'Accounting'),
  tax: L('消費税', 'Tax'),
  sales: L('販売', 'Sales'),
  purchase: L('購買', 'Purchasing'),
  inventory: L('在庫', 'Inventory'),
  contract: L('契約', 'Contracts'),
  workforce: L('人事・労務', 'Workforce'),
  industry: L('業界', 'Industry'),
  integration: L('連携', 'Integrations'),
  system: L('システム', 'System'),
};
const CATEGORY_ORDER = Object.keys(SETTING_CATEGORY_LABELS);

export interface SettingTab {
  id: string;
  label: Label;
  count: number;
}

/** AC-8: only categories that have settings, in the kernel's order; an unknown category comes last under its id. */
export function settingTabs(settings: readonly SettingMeta[]): SettingTab[] {
  const counts = new Map<string, number>();
  for (const s of settings) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const rank = (id: string) => {
    const i = CATEGORY_ORDER.indexOf(id);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...counts.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => ({ id, label: SETTING_CATEGORY_LABELS[id] ?? L(id, id), count: counts.get(id) ?? 0 }));
}

/** AC-8: the `?tab=` value when it names a shown tab, else the first tab. */
export function resolveTab(requested: string | undefined, tabs: readonly SettingTab[]): string | undefined {
  return tabs.some((tab) => tab.id === requested) ? requested : tabs[0]?.id;
}

/** AC-8: one tab's settings by `order` (settings without one after), then by label in the current language. */
export function settingsInTab(settings: readonly SettingMeta[], tab: string, locale: Locale): SettingMeta[] {
  const collator = new Intl.Collator(locale === 'ja' ? 'ja' : 'en');
  return settings
    .filter((s) => s.category === tab)
    .sort(
      (a, b) =>
        (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
        collator.compare(tr(a.label, locale), tr(b.label, locale)) ||
        a.key.localeCompare(b.key),
    );
}

/** `object`: one widget per property; `scalar`: one widget for the whole value; `json`: raw JSON (records, arrays). */
export type SettingFormMode = 'object' | 'scalar' | 'json';
export const SCALAR_FIELD = 'value';

function scalarType(schema: JsonSchema): boolean {
  const type = Array.isArray(schema.type) ? schema.type.filter((t) => t !== 'null') : [schema.type];
  if (type.length === 1 && ['string', 'integer', 'number', 'boolean'].includes(String(type[0]))) return true;
  return Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === 'string');
}

/** AC-9/AC-10: the form fields of one setting; a single value becomes one field labelled with the setting. */
export function settingForm(
  setting: SettingMeta,
  refOf: RefResolver,
): { mode: SettingFormMode; fields: SchemaField[] } {
  const { schema } = setting;
  if (schema.type === 'object' && schema.properties && Object.keys(schema.properties).length > 0)
    return { mode: 'object', fields: schemaFields(schema, refOf, setting.fields) };
  if (scalarType(schema)) {
    const shown: NonNullable<SettingMeta['fields']>[string] = { label: setting.label };
    if (setting.widget) shown.widget = setting.widget;
    if (setting.valueLabels) shown.valueLabels = setting.valueLabels;
    // A checkbox always yields true/false, so it is never marked required; any other single value is.
    const required = schema.type === 'boolean' ? [] : [SCALAR_FIELD];
    const wrapped: JsonSchema = { type: 'object', properties: { [SCALAR_FIELD]: schema }, required };
    return { mode: 'scalar', fields: schemaFields(wrapped, refOf, { [SCALAR_FIELD]: shown }) };
  }
  return { mode: 'json', fields: [] };
}

/**
 * AC-11: "reset to default" is offered for a stored value, except for raw-JSON records without a declared default
 * (e.g. `packs.applied`, whose removal would switch off every applied template); those stay editable as JSON.
 */
export function canReset(setting: SettingMeta, mode: SettingFormMode): boolean {
  return !setting.isDefault && (mode !== 'json' || setting.defaultValue !== undefined);
}

/** What the form starts from: the stored value, else the module default (AC-11), shaped for the form mode. */
export function settingFormValue(setting: SettingMeta, mode: SettingFormMode): unknown {
  const value = setting.value ?? setting.defaultValue ?? null;
  return mode === 'scalar' ? { [SCALAR_FIELD]: value ?? undefined } : value;
}

/** The value to PUT from a built form payload. */
export function settingPayload(mode: SettingFormMode, payload: unknown): unknown {
  if (mode !== 'scalar') return payload;
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)[SCALAR_FIELD]
    : undefined;
}

function scalarText(value: unknown, locale: Locale, valueLabels?: Record<string, Label>): string {
  if (value === null || value === undefined) return tr(SC.notSet, locale);
  if (typeof value === 'boolean') return tr(value ? SC.yes : SC.no, locale);
  if (typeof value === 'string') return valueLabels?.[value] ? tr(valueLabels[value], locale) : value;
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

export interface ValuePart {
  /** Field label, or '' for a single-value setting. */
  label: string;
  text: string;
  name: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Property names in schema order, then any other keys the value carries. */
function propertyNames(setting: SettingMeta, ...values: unknown[]): string[] {
  const names = Object.keys(setting.schema.properties ?? {});
  for (const v of values) for (const k of Object.keys(asRecord(v) ?? {})) if (!names.includes(k)) names.push(k);
  return names;
}

function fieldLabel(setting: SettingMeta, name: string, locale: Locale): string {
  const shown = setting.fields?.[name];
  return shown ? tr(shown.label, locale) : name;
}

/** AC-11: a value as labelled parts ("売掛金 1300"); missing properties are left out. */
export function valueParts(setting: SettingMeta, value: unknown, locale: Locale): ValuePart[] {
  const record = asRecord(value);
  if (setting.schema.type === 'object' && record) {
    return propertyNames(setting, record)
      .filter((name) => record[name] !== undefined)
      .map((name) => ({
        name,
        label: fieldLabel(setting, name, locale),
        text: scalarText(record[name], locale, setting.fields?.[name]?.valueLabels),
      }));
  }
  return [{ name: SCALAR_FIELD, label: '', text: scalarText(value, locale, setting.valueLabels) }];
}

/** The parts joined for one line ("売掛金 1300、売上高 4000" / "Accounts receivable 1300, Revenue 4000"). */
export function valueText(setting: SettingMeta, value: unknown, locale: Locale): string {
  return valueParts(setting, value, locale)
    .map((p) => (p.label ? `${p.label} ${p.text}` : p.text))
    .join(locale === 'ja' ? '、' : ', ');
}

export interface ChangeRow {
  label: string;
  before: string;
  after: string;
}

/** AC-12: what one history entry changed, per property for objects (unchanged properties are left out). */
export function changeRows(setting: SettingMeta, change: SettingChange, locale: Locale): ChangeRow[] {
  const before = asRecord(change.before);
  const after = asRecord(change.after);
  const objectOrUnset = (v: unknown) => v === null || v === undefined || asRecord(v) !== null;
  if (
    setting.schema.type === 'object' &&
    (before || after) &&
    objectOrUnset(change.before) &&
    objectOrUnset(change.after)
  ) {
    const rows: ChangeRow[] = [];
    for (const name of propertyNames(setting, before, after)) {
      const b = before?.[name];
      const a = after?.[name];
      if (JSON.stringify(b ?? null) === JSON.stringify(a ?? null)) continue;
      const labels = setting.fields?.[name]?.valueLabels;
      rows.push({
        label: fieldLabel(setting, name, locale),
        before: scalarText(b ?? null, locale, labels),
        after: scalarText(a ?? null, locale, labels),
      });
    }
    return rows;
  }
  return [
    {
      label: '',
      before: scalarText(change.before, locale, setting.valueLabels),
      after: scalarText(change.after, locale, setting.valueLabels),
    },
  ];
}

export function opLabel(op: string): Label {
  if (op === 'update') return SC.opUpdate;
  if (op === 'delete') return SC.opDelete;
  return L(op, op);
}

/** Who made a change: the user's name when known, else `type:id…`; agents add the user they acted for. */
export function actorText(change: SettingChange, locale: Locale): string {
  const actor = change.actorName ?? `${change.actorType}:${shortId(change.actorId)}`;
  if (!change.onBehalfOf) return actor;
  const name = change.onBehalfOfName ?? shortId(change.onBehalfOf);
  const note = fill(SC.onBehalfOf, locale, { name });
  return locale === 'ja' ? `${actor}（${note}）` : `${actor} (${note})`;
}

export function changeTime(change: SettingChange, locale: Locale): string {
  return formatTimestamp(change.at, locale);
}
