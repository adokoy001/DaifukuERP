// Display formatting for cells, docstatus and audit entries. Pure; unit-tested in format.test.ts.
import type { AuditEntry, Docstatus, FieldMeta, Label, Locale } from '../api/types.ts';

export const DOCSTATUS_LABELS: Record<Docstatus, Label> = {
  0: { ja: '下書き', en: 'Draft' },
  1: { ja: '確定', en: 'Submitted' },
  2: { ja: '取消', en: 'Cancelled' },
};

export function docstatusLabel(ds: unknown): Label {
  return ds === 1 || ds === 2 ? DOCSTATUS_LABELS[ds] : DOCSTATUS_LABELS[0];
}

export function formatTimestamp(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Adds thousands separators to a decimal string without converting to a float (ADR-0010). */
export function groupDigits(s: string): string {
  const m = /^([+-]?)(\d+)(\.\d+)?$/.exec(s);
  if (!m) return s;
  const [, sign = '', int = '', frac = ''] = m;
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac}`;
}

/** numeric(20,6): the most fraction digits a stored decimal has, and the most the screen shows (web-phase15 AC-8). */
export const MAX_DISPLAY_SCALE = 6;

/**
 * Display rule for decimal strings (web-phase15 AC-8; ADR-0010: strings only). `minScale` fraction digits are always
 * shown (money: the currency's minor units, JPY = 0 — see decimalMinScale), further significant digits up to
 * MAX_DISPLAY_SCALE, trailing zeros beyond the minimum dropped, thousands grouped. JPY: "150" -> "150", "33.3" -> "33.3",
 * "1234.500000" -> "1,234.5"; 2 minor units: "100.000000" -> "100.00". Display only; values never change.
 */
export function formatDecimal(s: string, minScale = 0): string {
  const m = /^([+-]?\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return s;
  const int = m[1] ?? '';
  const keep = Math.max(0, minScale);
  const frac = (m[2] ?? '').slice(0, Math.max(MAX_DISPLAY_SCALE, keep)).replace(/0+$/, '').padEnd(keep, '0');
  const body = frac ? `${int}.${frac}` : int;
  // "-0.000000" would otherwise read "-0" / "-0.00"
  return groupDigits(/^-0+(\.0*)?$/.test(body) ? body.slice(1) : body);
}

/** A money FieldMeta.scale at or above this is the kernel's storage scale ("currency unknown"), not the currency's digits. */
const STORAGE_SCALE = 6;

/**
 * Minimum fraction digits of a decimal (web-phase15 AC-4/AC-8, docs/conventions/ui.md): money uses FieldMeta.scale
 * (the kernel resolves it from the company currency) and falls back to the /auth/me currency; other decimals
 * (quantities, rates) show only their significant digits. Without field info (report columns) the currency applies.
 */
export function decimalMinScale(field: Pick<FieldMeta, 'money' | 'scale'> | undefined, currencyScale: number): number {
  if (!field) return currencyScale;
  if (field.money !== true) return 0;
  return field.scale !== undefined && field.scale < STORAGE_SCALE ? field.scale : currencyScale;
}

/** Input fields at rest (AC-8: same rule), except that a typed value with more digits than the screen shows stays raw. */
export function formatDecimalInput(raw: string, minScale: number): string {
  const frac = (/^[+-]?\d+\.(\d+)$/.exec(raw.trim())?.[1] ?? '').replace(/0+$/, '');
  return frac.length > Math.max(MAX_DISPLAY_SCALE, minScale) ? raw : formatDecimal(raw, minScale);
}

export interface Formatted {
  text: string;
  align: 'left' | 'right';
  mono: boolean;
}

export interface DisplayOptions {
  /** Resolved display value for ref fields (undefined -> short id). */
  refLabel?: string | undefined;
  /** Minor units of the company currency (/auth/me); money without a meta scale keeps this many digits. Default 0. */
  currencyScale?: number | undefined;
}

/** Text shown in list cells and read-only views. */
export function formatValue(
  field: FieldMeta | undefined,
  value: unknown,
  locale: Locale,
  opts: DisplayOptions = {},
): Formatted {
  if (value === null || value === undefined) return { text: '', align: 'left', mono: false };
  const kind = field?.kind ?? (typeof value === 'number' ? 'int' : 'text');
  const refLabel = opts.refLabel;
  switch (kind) {
    case 'bool':
      return { text: value === true ? '✓' : '—', align: 'left', mono: false };
    case 'int':
      return { text: groupDigits(String(value)), align: 'right', mono: true };
    case 'decimal':
      return {
        text: formatDecimal(String(value), decimalMinScale(field, opts.currencyScale ?? 0)),
        align: 'right',
        mono: true,
      };
    case 'timestamp':
      return { text: formatTimestamp(String(value), locale), align: 'left', mono: true };
    case 'date':
      return { text: String(value), align: 'left', mono: true };
    case 'enum': {
      const l = field?.valueLabels?.[String(value)];
      return { text: l ? l[locale] : String(value), align: 'left', mono: false };
    }
    case 'ref':
      return refLabel !== undefined
        ? { text: refLabel, align: 'left', mono: false }
        : { text: shortId(String(value)), align: 'left', mono: true };
    case 'uuid':
      return { text: shortId(String(value)), align: 'left', mono: true };
    case 'json':
      return { text: JSON.stringify(value), align: 'left', mono: true };
    default:
      return {
        text: typeof value === 'string' ? value : JSON.stringify(value),
        align: 'left',
        mono: field?.name === 'code' || field?.name === 'number',
      };
  }
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

const AUDIT_NOISE = new Set([
  'updatedAt',
  'updatedBy',
  'version',
  'createdAt',
  'createdBy',
  'tenantId',
  'companyId',
  'id',
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** AC-6: which fields an audit entry touched. Create lists the non-null fields written; update/others diff before vs after. */
export function changedFields(entry: Pick<AuditEntry, 'before' | 'after'>): string[] {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  if (!before && !after) return [];
  if (!before && after)
    return Object.keys(after).filter((k) => !AUDIT_NOISE.has(k) && after[k] !== null && after[k] !== undefined);
  if (before && !after) return [];
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) => !AUDIT_NOISE.has(k) && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null));
}

export interface FieldChange {
  name: string;
  before: unknown;
  after: unknown;
}

/** The changed fields of an audit entry with their old/new values (create: `before` is undefined). */
export function fieldChanges(entry: Pick<AuditEntry, 'before' | 'after'>): FieldChange[] {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  return changedFields(entry).map((name) => ({ name, before: before?.[name], after: after?.[name] }));
}

const CHANGE_TEXT_MAX = 40;

/** One value of an audit change, through the same display rules as cells (decimals by scale), cut so the row stays short. */
export function changeValueText(
  field: FieldMeta | undefined,
  value: unknown,
  locale: Locale,
  opts: DisplayOptions = {},
): string {
  if (value === null || value === undefined) return '—';
  const text = formatValue(field, value, locale, opts).text;
  return text.length > CHANGE_TEXT_MAX ? `${text.slice(0, CHANGE_TEXT_MAX)}…` : text;
}
