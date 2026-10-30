// Settings console (docs/specs/settings-console.md AC-8..AC-12): tabs by category, order inside a tab, how a setting
// becomes form fields (object / single value / raw JSON), and the text of defaults and history entries. Pure.
import type { CodeList, CodeOption, JsonSchema, Label, Locale, SettingChange, SettingMeta } from '../api/types.ts';
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
  invalidBadge: L('定義に合わない値', 'Invalid stored value'),
  notSet: L('未設定', 'Not set'),
  defaultIs: L('既定値', 'Default'),
  /** A history side that was unset while the setting declares a default (AC-12). */
  defaultValueIs: L('既定値（{value}）', 'Default ({value})'),
  invalidStored: L(
    '保存されている値が定義に合わないため、既定値が使われています。保存し直すか、既定に戻してください。',
    'The stored value no longer matches the definition, so the default applies. Save again or reset to the default.',
  ),
  invalidStoredNoDefault: L(
    '保存されている値が定義に合わないため、未設定として扱われています。保存し直すか、既定に戻してください。',
    'The stored value no longer matches the definition, so the setting is treated as not set. Save again or reset it.',
  ),
  reset: L('既定に戻す', 'Reset to default'),
  resetting: L('戻しています…', 'Resetting…'),
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
  resetTemplateNote: L(
    'テンプレートを適用した会社では、テンプレートが書いた値も会社の値です。既定に戻すと、テンプレートの値ではなくモジュールの既定値になります。',
    'In a company with an applied template, values the template wrote are company values too: resetting goes back to the module default, not to the template value.',
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
  /** The empty choice of an optional code field (the module's own fallback applies). */
  notSpecified: L('指定しない', 'Not specified'),
  typeCode: L('コードを直接入力…', 'Type a code…'),
  pickCode: L('一覧から選ぶ', 'Pick from the list'),
  typedNote: L(
    '一覧に無いコードも保存できます（後から科目・倉庫を作る場合）。',
    'A code that is not in the list can be saved too (when the record is created later).',
  ),
  codeMissing: {
    'account-code': L('「{code}」は有効な勘定科目にありません', '"{code}" is not an active account'),
    'warehouse-code': L('「{code}」は倉庫にありません', '"{code}" is not a warehouse'),
  },
  codeNotFoundOption: L('{code}（見つかりません）', '{code} (not found)'),
  codeUnavailable: L(
    '一覧を読み込めないため、コードを直接入力してください。',
    'The list could not be loaded; enter the code directly.',
  ),
  codeForbidden: {
    'account-code': L(
      '勘定科目を参照する権限が無いため、コードを直接入力してください。',
      'You cannot view accounts; enter the code directly.',
    ),
    'warehouse-code': L(
      '倉庫を参照する権限が無いため、コードを直接入力してください。',
      'You cannot view warehouses; enter the code directly.',
    ),
  },
  codesTruncated: L('先頭 {n} 件だけを表示しています（全 {total} 件）。', 'Only the first {n} of {total} are listed.'),
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
}

/** AC-8: only categories that have settings, in the kernel's order; an unknown category comes last under its id. */
export function settingTabs(settings: readonly SettingMeta[]): SettingTab[] {
  const categories = [...new Set(settings.map((s) => s.category))];
  const rank = (id: string) => {
    const i = CATEGORY_ORDER.indexOf(id);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return categories
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => ({ id, label: SETTING_CATEGORY_LABELS[id] ?? L(id, id) }));
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

/**
 * AC-11: the company has a stored value that the definition rejects (GET returns `value: null` with `isDefault: false`);
 * the module falls back to its default, or treats the setting as not set when there is none.
 */
export function storedValueInvalid(setting: SettingMeta): boolean {
  return !setting.isDefault && setting.value === null;
}

/** AC-11: the warning for an invalid stored value, saying what applies instead. */
export function invalidStoredText(setting: SettingMeta): Label {
  return setting.defaultValue !== undefined ? SC.invalidStored : SC.invalidStoredNoDefault;
}

/**
 * setup-wizard AC-12: how a setting kept by a dedicated screen (`managedBy`) is offered — a link for admins (the screen
 * is admin only), a sentence for everyone else (the settings role would get 403 there). null when it is not managed.
 */
export function managedByView(
  setting: SettingMeta,
  roles: readonly string[] | undefined,
): { kind: 'link'; href: string; text: Label } | { kind: 'text'; text: Label } | null {
  const managed = setting.managedBy;
  if (!managed) return null;
  if ((roles ?? []).includes('admin'))
    return {
      kind: 'link',
      href: managed.href,
      text: { ja: `${managed.label.ja}で変更`, en: `Change in ${managed.label.en}` },
    };
  return {
    kind: 'text',
    text: {
      ja: `会社の管理者が${managed.label.ja}の画面で変更します`,
      en: `A company administrator changes this in ${managed.label.en}`,
    },
  };
}

/** Whether any template (pack) is recorded as applied in this company (`packs.applied`, ADR-0015). */
export function templatesApplied(settings: readonly SettingMeta[]): boolean {
  const applied = settings.find((s) => s.key === 'packs.applied')?.value;
  return typeof applied === 'object' && applied !== null && Object.keys(applied).length > 0;
}

/** AC-10: a stored code is neither in the list nor ruled out by it (the list is cut off), so look it up by itself. */
export function codeLookupNeeded(code: string, list: CodeList): boolean {
  return code !== '' && list.total > list.options.length && !list.options.some((o) => o.code === code);
}

/**
 * AC-10: whether a stored code is flagged as missing: it is not in the list and either the list is complete or a
 * direct lookup found nothing (`lookup` null). An unfinished or failed lookup (`undefined`) flags nothing.
 */
export function codeIsMissing(code: string, list: CodeList, lookup: CodeOption | null | undefined): boolean {
  if (code === '' || list.options.some((o) => o.code === code)) return false;
  if (list.total <= list.options.length) return true;
  return lookup === null;
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

const unset = (v: unknown) => v === null || v === undefined;

/**
 * A side of a history entry where the company had no value: "default (4000)" when the setting declares a default (the
 * module used it), else "not set". `name` picks one property of an object default.
 */
function unsetText(setting: SettingMeta, name: string | null, locale: Locale): string {
  const fallback = name === null ? setting.defaultValue : asRecord(setting.defaultValue)?.[name];
  if (unset(fallback)) return tr(SC.notSet, locale);
  const labels = name === null ? setting.valueLabels : setting.fields?.[name]?.valueLabels;
  return fill(SC.defaultValueIs, locale, { value: scalarText(fallback, locale, labels) });
}

/**
 * AC-12: what one history entry changed, per property for objects (unchanged properties are left out). A side with no
 * stored value (first save, reset) reads as the declared default, since that is what the module used.
 */
export function changeRows(setting: SettingMeta, change: SettingChange, locale: Locale): ChangeRow[] {
  const before = asRecord(change.before);
  const after = asRecord(change.after);
  const objectOrUnset = (v: unknown) => unset(v) || asRecord(v) !== null;
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
      const side = (record: Record<string, unknown> | null, v: unknown) =>
        record === null ? unsetText(setting, name, locale) : scalarText(v ?? null, locale, labels);
      rows.push({ label: fieldLabel(setting, name, locale), before: side(before, b), after: side(after, a) });
    }
    return rows;
  }
  const side = (v: unknown) =>
    unset(v) ? unsetText(setting, null, locale) : scalarText(v, locale, setting.valueLabels);
  return [{ label: '', before: side(change.before), after: side(change.after) }];
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
