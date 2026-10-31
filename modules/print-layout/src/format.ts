// Text formatting for printed documents (docs/specs/print-templates.md AC-5〜AC-8). Pure: no DB, clock or registry.
// Money and rates are the stored Decimal strings; only grouping / percent notation is added, never rounding (AC-7).
import { Decimal, isLocalDate, type Locale } from '@daifuku/kernel';

/** HTML-escapes text nodes and attribute values: `& < > " '` (AC-6). Every record/setting string passes through here. */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** '1234567.5' -> '1,234,567.5' (string arithmetic only, ADR-0010). Non-decimal input is returned as-is. */
export function formatMoney(s: string): string {
  if (!Decimal.isDecimalString(s)) return s;
  const canonical = Decimal.from(s).toString();
  const negative = canonical.startsWith('-');
  const [int = '', frac] = (negative ? canonical.slice(1) : canonical).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** '0.1' -> '10%'. */
export function formatRate(rate: string): string {
  return Decimal.isDecimalString(rate) ? `${Decimal.from(rate).times(100).toString()}%` : rate;
}

/** Sum of stored Decimal strings (AC-7: addition only, no rounding). Non-decimal entries count as zero. */
export function sumDecimals(values: readonly string[]): string {
  return values.reduce((sum, v) => (Decimal.isDecimalString(v) ? sum.plus(v) : sum), Decimal.from('0')).toString();
}

/** How printed documents write dates (company setting `print_layout.date_style`, AC-8). */
export const DATE_STYLES = ['western', 'japanese_era', 'both'] as const;
export type DateStyle = (typeof DATE_STYLES)[number];

/** Converts a Gregorian date to the Japanese era notation (override `print_layout.era_date`; l10n/jp registers it). */
export type EraDateFn = (date: string) => string;

/** '2026-10-30' -> '2026年10月30日' (ja, no zero padding) / '2026-10-30' (en). Not a date: returned as-is. */
export function formatWesternDate(date: string, locale: Locale): string {
  if (locale !== 'ja' || !isLocalDate(date)) return date;
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function eraOf(date: string, era: EraDateFn | undefined): string | undefined {
  if (!era || !isLocalDate(date)) return undefined;
  try {
    const out = era(date);
    return typeof out === 'string' && out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * AC-8: `western` 2026年10月30日 / 2026-10-30, `japanese_era` 令和8年10月30日, `both` 2026年10月30日（令和8年10月30日）
 * (en: 2026-10-30（令和8年10月30日）). Without an era converter, or when it cannot convert the date, the date is western.
 */
export function formatDocumentDate(date: string, style: DateStyle, locale: Locale, era?: EraDateFn): string {
  const western = formatWesternDate(date, locale);
  if (style === 'western') return western;
  const wareki = eraOf(date, era);
  if (!wareki) return western;
  return style === 'japanese_era' ? wareki : `${western}（${wareki}）`;
}
