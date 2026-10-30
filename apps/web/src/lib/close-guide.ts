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

/** AC-8: a report link carrying the period's dates (the report page reads them as initial values). */
export function reportHref(report: CloseReport): string {
  const query = new URLSearchParams(report.input).toString();
  return `/r/${report.action}${query ? `?${query}` : ''}`;
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

/** AC-10: why the close button is disabled, naming each remaining blocking item. */
export function blockingSummary(items: readonly CloseItem[], locale: Locale): string {
  const parts = groupItems(items).blocking.map((item) =>
    locale === 'ja' ? `${item.label.ja} ${countText(item.count, locale)}` : `${item.label.en} (${item.count})`,
  );
  if (parts.length === 0) return '';
  return locale === 'ja'
    ? `締める前に次を確定または削除してください: ${parts.join('、')}`
    : `Submit or delete these before closing: ${parts.join(', ')}`;
}
