// Pure helpers for the month-end close guide (/finance/close, docs/specs/close-guide.md). close-guide.test.ts.
// The shapes mirror accounting.close_readiness (modules/accounting/src/actions/close-readiness.ts).
import type { Label, Locale } from '../api/types.ts';

export const CLOSE_READINESS_ACTION = 'accounting.close_readiness';
export const CLOSE_PERIOD_ACTION = 'accounting.close_period';
export const REOPEN_PERIOD_ACTION = 'accounting.reopen_period';

export interface ClosePeriod {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  isClosed: boolean;
}

export interface CloseItem {
  id: string;
  kind: 'draft' | 'unallocated_payment' | 'unreconciled_statement' | 'previous_period';
  label: Label;
  count: number;
  blocking: boolean;
  href?: string;
  entity?: string;
  filter?: { status: 'draft'; field: string; from: string; to: string };
}

export interface CloseReport {
  action: string;
  label: Label;
  input: Record<string, string>;
}

export interface CloseReadiness {
  period: ClosePeriod;
  fiscalYear: { id: string; code: string; isClosed: boolean };
  defaulted: boolean;
  asOf: string;
  items: CloseItem[];
  blockingCount: number;
  ready: boolean;
  reports: CloseReport[];
}

export interface CloseSearch {
  periodId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route search of /finance/close: only a well-formed period id is kept (anything else falls back to the default). */
export function parseCloseSearch(raw: Record<string, unknown>): CloseSearch {
  return typeof raw.periodId === 'string' && UUID.test(raw.periodId) ? { periodId: raw.periodId } : {};
}

/** A server href (`/path?a=b`) as router `to` + `search`, so the router builds the link and keeps client navigation. */
export function splitHref(href: string): { to: string; search: Record<string, string> } {
  const at = href.indexOf('?');
  if (at < 0) return { to: href, search: {} };
  return { to: href.slice(0, at), search: Object.fromEntries(new URLSearchParams(href.slice(at + 1))) };
}

export interface CloseGroups {
  /** Blocking items that still have work (they keep the close button disabled). */
  blocking: CloseItem[];
  /** Non-blocking items with a count: worth checking, they do not stop the close. */
  warnings: CloseItem[];
  /** Items at 0, blocking or not. */
  clear: CloseItem[];
}

export function groupItems(items: readonly CloseItem[]): CloseGroups {
  return {
    blocking: items.filter((item) => item.blocking && item.count > 0),
    warnings: items.filter((item) => !item.blocking && item.count > 0),
    clear: items.filter((item) => item.count === 0),
  };
}

export type CloseState = 'closed' | 'ready' | 'blocked';

export const STATE_LABEL: Record<CloseState, Label> = {
  closed: { ja: '締め済み', en: 'Closed' },
  ready: { ja: '締められます', en: 'Ready to close' },
  blocked: { ja: '締める前の作業があります', en: 'Work left before closing' },
};

export function closeState(readiness: Pick<CloseReadiness, 'period' | 'ready'>): CloseState {
  if (readiness.period.isClosed) return 'closed';
  return readiness.ready ? 'ready' : 'blocked';
}

const range = (from: string, to: string, locale: Locale) => (locale === 'ja' ? `${from}〜${to}` : `${from} to ${to}`);

export function periodRange(period: Pick<ClosePeriod, 'startDate' | 'endDate'>, locale: Locale): string {
  return range(period.startDate, period.endDate, locale);
}

/** Option text of the period picker: code, dates, and whether it is closed. */
export function periodOption(period: ClosePeriod, locale: Locale): string {
  const closed = period.isClosed ? (locale === 'ja' ? '・締め済み' : ', closed') : '';
  return locale === 'ja'
    ? `${period.code}（${periodRange(period, locale)}${closed}）`
    : `${period.code} (${periodRange(period, locale)}${closed})`;
}

/** AC-9: what a count covers, shown next to it until the linked list can filter by status and date. */
export function itemScope(item: CloseItem, locale: Locale): string | undefined {
  if (!item.filter) return undefined;
  const dates = range(item.filter.from, item.filter.to, locale);
  return locale === 'ja' ? `${dates}の下書き` : `drafts dated ${dates}`;
}

export function countText(count: number, locale: Locale): string {
  return locale === 'ja' ? `${count.toLocaleString('ja-JP')} 件` : `${count.toLocaleString('en-US')}`;
}

/** The badge of an item: its count, except the previous period, whose 1 / 0 is a state (still open / closed). */
export function itemBadgeText(item: Pick<CloseItem, 'kind' | 'count'>, locale: Locale): string {
  if (item.kind !== 'previous_period') return countText(item.count, locale);
  if (item.count > 0) return locale === 'ja' ? '未締め' : 'Open';
  return locale === 'ja' ? '締め済み' : 'Closed';
}

/** AC-9: link text naming where the item's link goes (a list, bank matching, or that period on this screen). */
export function itemLinkText(kind: CloseItem['kind']): Label {
  if (kind === 'previous_period') return { ja: 'その期間を開く', en: 'Open that period' };
  if (kind === 'unreconciled_statement') return { ja: '銀行照合を開く', en: 'Open bank matching' };
  return { ja: '一覧を開く', en: 'Open list' };
}

/** AC-10: why the close button is disabled, naming each remaining blocking item. */
export function blockingSummary(items: readonly CloseItem[], locale: Locale): string {
  const parts = groupItems(items).blocking.map((item) =>
    locale === 'ja'
      ? `${item.label.ja} ${countText(item.count, locale)}`
      : `${item.label.en} (${countText(item.count, locale)})`,
  );
  if (parts.length === 0) return '';
  return locale === 'ja'
    ? `締める前に次を確定または削除してください: ${parts.join('、')}`
    : `Submit or delete these before closing: ${parts.join(', ')}`;
}

/** AC-10: why the check right before closing refused (someone closed the period meanwhile, or drafts appeared). */
export function refusalMessage(fresh: Pick<CloseReadiness, 'period' | 'items'>, locale: Locale): string {
  if (fresh.period.isClosed)
    return locale === 'ja' ? 'この期間は既に締められています。' : 'This period has already been closed.';
  return blockingSummary(fresh.items, locale);
}

/** What a finished re-check found, for the polite live region (the badge and reason change silently otherwise). */
export function recheckAnnouncement(readiness: Pick<CloseReadiness, 'period' | 'ready' | 'items'>, locale: Locale) {
  const state = STATE_LABEL[closeState(readiness)][locale];
  const reason = closeState(readiness) === 'blocked' ? blockingSummary(readiness.items, locale) : '';
  return locale === 'ja'
    ? `再点検しました: ${readiness.period.code} ${state}。${reason}`
    : `Checked again: ${readiness.period.code} ${state}. ${reason}`.trimEnd();
}

/** `details.reason` of accounting.close_readiness when the company has no fiscal period (NO_FISCAL_PERIOD). */
export const NO_FISCAL_PERIOD = 'no_fiscal_period';

/**
 * AC-8 / AC-13: the company has no fiscal period yet, so there is nothing to pick or close. Known from an empty
 * period list, or from the check's refusal reason before the list has loaded.
 */
export function noFiscalPeriods(periods: readonly unknown[] | undefined, errorReason: unknown): boolean {
  return periods?.length === 0 || errorReason === NO_FISCAL_PERIOD;
}
