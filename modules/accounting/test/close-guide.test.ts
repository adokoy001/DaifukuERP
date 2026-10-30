// Close guide rules (docs/specs/close-guide.md) — pure, no DB. DB behaviour: apps/api/test/close-readiness.db.test.ts.
import { describe, expect, it } from 'vitest';
import {
  blockingCount,
  closeDateField,
  closeReady,
  defaultClosePeriod,
  isBlockingDraft,
  previousPeriod,
  type ClosePeriodLike,
} from '../src/services/close.ts';

const month = (code: string, isClosed = false): ClosePeriodLike => {
  const [y, m] = code.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    id: `p-${code}`,
    code,
    startDate: `${code}-01`,
    endDate: `${code}-${String(last).padStart(2, '0')}`,
    isClosed,
  };
};
const year = (y: number, closedThrough = 0) =>
  Array.from({ length: 12 }, (_, i) => month(`${y}-${String(i + 1).padStart(2, '0')}`, i + 1 <= closedThrough));

describe('close guide: default period (AC-8)', () => {
  it('AC-8 picks the oldest open period that ended before today', () => {
    expect(defaultClosePeriod(year(2026, 7), '2026-10-29')?.code).toBe('2026-08');
    expect(defaultClosePeriod(year(2026, 0), '2026-10-29')?.code).toBe('2026-01');
  });
  it('AC-8 an open period ending on today is not "before today"; the order of the input does not matter', () => {
    expect(defaultClosePeriod(year(2026, 8).reverse(), '2026-09-30')?.code).toBe('2026-09');
    expect(defaultClosePeriod(year(2026, 9), '2026-10-01')?.code).toBe('2026-10');
  });
  it('AC-8 without an open past period, falls back to the period containing today', () => {
    expect(defaultClosePeriod(year(2026, 9), '2026-10-29')?.code).toBe('2026-10');
  });
  it('AC-8 with no current period, the latest past period, else the earliest one; undefined without periods', () => {
    expect(defaultClosePeriod(year(2025, 12), '2026-02-03')?.code).toBe('2025-12');
    expect(defaultClosePeriod(year(2027), '2026-10-29')?.code).toBe('2027-01');
    expect(defaultClosePeriod([], '2026-10-29')).toBeUndefined();
  });
});

describe('close guide: previous period (AC-5)', () => {
  it('AC-5 is the period ending last before the start, across fiscal years', () => {
    const periods = [...year(2026), ...year(2025)];
    expect(previousPeriod(periods, month('2026-03'))?.code).toBe('2026-02');
    expect(previousPeriod(periods, month('2026-01'))?.code).toBe('2025-12');
    expect(previousPeriod(periods, month('2025-01'))).toBeUndefined();
  });
});

describe('close guide: dated documents and blocking drafts (AC-2, AC-3)', () => {
  it('AC-2 uses the first business-date field of kind date, in the documented order', () => {
    expect(closeDateField({ date: { kind: 'date' }, dueDate: { kind: 'date' } })).toBe('date');
    expect(closeDateField({ transactionDate: { kind: 'date' }, postingDate: { kind: 'date' } })).toBe('postingDate');
    expect(closeDateField({ documentDate: { kind: 'date' } })).toBe('documentDate');
    expect(closeDateField({ date: { kind: 'text' }, transactionDate: { kind: 'date' } })).toBe('transactionDate');
    expect(closeDateField({ startDate: { kind: 'date' }, periodStart: { kind: 'date' } })).toBeUndefined();
  });
  it('AC-3 the journal and documents with journalEntryId block; other drafts warn', () => {
    expect(isBlockingDraft('journal_entry', { date: {} })).toBe(true);
    expect(isBlockingDraft('sales_invoice', { date: {}, journalEntryId: {} })).toBe(true);
    expect(isBlockingDraft('stock_entry', { date: {} })).toBe(false);
  });
});

describe('close guide: ready (AC-6)', () => {
  const items = [
    { blocking: true, count: 0 },
    { blocking: false, count: 3 },
  ];
  it('AC-6 ready while open and every blocking count is 0; warnings never block', () => {
    expect(closeReady(false, items)).toBe(true);
    expect(blockingCount(items)).toBe(0);
  });
  it('AC-6 not ready with a blocking draft or when the period is already closed', () => {
    expect(closeReady(false, [...items, { blocking: true, count: 2 }])).toBe(false);
    expect(blockingCount([...items, { blocking: true, count: 2 }, { blocking: true, count: 1 }])).toBe(3);
    expect(closeReady(true, items)).toBe(false);
  });
});
