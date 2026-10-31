// Month-end close guide rules (docs/specs/close-guide.md). Pure: which period to suggest, which period precedes it,
// which date field a document is dated by, whether its drafts block the close, and when the period is ready.
import type { LocalDate } from '@daifuku/kernel';

export interface ClosePeriodLike {
  id: string;
  code: string;
  startDate: LocalDate;
  endDate: LocalDate;
  isClosed: boolean;
}

/** Business-date fields, in priority order; a document's drafts are counted by the first one it declares (AC-2). */
export const CLOSE_DATE_FIELDS = ['date', 'postingDate', 'documentDate', 'transactionDate'] as const;

/** Field whose presence means submitting the document posts a journal entry (sales/purchase invoices, payments). */
export const POSTING_FIELD = 'journalEntryId';

/** Entity names whose drafts block the close even without `journalEntryId` (the journal itself). */
const ALWAYS_BLOCKING = new Set(['journal_entry']);

const byStart = <P extends ClosePeriodLike>(a: P, b: P) =>
  a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;

/**
 * AC-8 default: the oldest open period that ended before today; else the period containing today. When neither
 * exists (all past periods closed and no year opened for today), the most recent period that ended before today,
 * else the earliest period. undefined only when there are no periods at all.
 */
export function defaultClosePeriod<P extends ClosePeriodLike>(periods: readonly P[], today: LocalDate): P | undefined {
  const sorted = [...periods].sort(byStart);
  return (
    sorted.find((p) => !p.isClosed && p.endDate < today) ??
    sorted.find((p) => p.startDate <= today && today <= p.endDate) ??
    sorted.filter((p) => p.endDate < today).at(-1) ??
    sorted[0]
  );
}

/** AC-5: the period that ends last before `period` starts (across fiscal years), if any. */
export function previousPeriod<P extends ClosePeriodLike>(
  periods: readonly P[],
  period: ClosePeriodLike,
): P | undefined {
  return [...periods]
    .sort(byStart)
    .filter((p) => p.endDate < period.startDate && p.id !== period.id)
    .at(-1);
}

/** AC-2: the first business-date field (of kind `date`) a document declares, or undefined when it has none. */
export function closeDateField(fields: Readonly<Record<string, { kind: string }>>): string | undefined {
  return CLOSE_DATE_FIELDS.find((name) => fields[name]?.kind === 'date');
}

/** AC-3: drafts of documents that post to the ledger (and of the journal itself) block the close. */
export function isBlockingDraft(entity: string, fields: Readonly<Record<string, unknown>>): boolean {
  return ALWAYS_BLOCKING.has(entity) || Object.hasOwn(fields, POSTING_FIELD);
}

/** Sum of counts over blocking items. */
export function blockingCount(items: readonly { blocking: boolean; count: number }[]): number {
  return items.reduce((sum, item) => sum + (item.blocking ? item.count : 0), 0);
}

/** AC-6: ready only while the period is open and every blocking item is 0. */
export function closeReady(isClosed: boolean, items: readonly { blocking: boolean; count: number }[]): boolean {
  return !isClosed && blockingCount(items) === 0;
}
