// Fiscal year / period arithmetic (spec AC-2) — examples + properties, no DB.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  fiscalYearCode,
  fiscalYearRange,
  isFirstOfMonth,
  isValidRange,
  monthlyPeriods,
  rangeContains,
  rangesOverlap,
} from '../src/services/periods.ts';

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
const arbStart = fc
  .record({ y: fc.integer({ min: 2000, max: 2098 }), m: fc.integer({ min: 1, max: 12 }) })
  .map(({ y, m }) => ymd(y, m, 1));
const arbDate = fc
  .record({
    y: fc.integer({ min: 2000, max: 2099 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ y, m, d }) => ymd(y, m, Math.min(d, daysInMonth(y, m))));

describe('fiscal year / monthly periods — examples', () => {
  it('a January year ends on Dec 31 and yields 12 calendar-month periods coded YYYY-MM', () => {
    expect(fiscalYearRange('2026-01-01')).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' });
    const p = monthlyPeriods('2026-01-01');
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ code: '2026-01', startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(p[1]).toEqual({ code: '2026-02', startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(p[11]).toEqual({ code: '2026-12', startDate: '2026-12-01', endDate: '2026-12-31' });
    expect(fiscalYearCode('2026-01-01')).toBe('FY2026');
  });

  it('an April year (日本の一般的な年度) crosses the calendar year and handles leap February', () => {
    expect(fiscalYearRange('2027-04-01')).toEqual({ startDate: '2027-04-01', endDate: '2028-03-31' });
    const p = monthlyPeriods('2027-04-01');
    expect(p[0]?.code).toBe('2027-04');
    expect(p[9]?.code).toBe('2028-01');
    expect(p[10]).toEqual({ code: '2028-02', startDate: '2028-02-01', endDate: '2028-02-29' });
    expect(p[11]?.endDate).toBe('2028-03-31');
    expect(fiscalYearCode('2027-04-01')).toBe('FY2027');
  });

  it('rejects a start that is not the 1st of a month or not a date', () => {
    expect(isFirstOfMonth('2026-04-01')).toBe(true);
    expect(isFirstOfMonth('2026-04-02')).toBe(false);
    expect(() => fiscalYearRange('2026-04-15')).toThrow(RangeError);
    expect(() => monthlyPeriods('2026-02-30')).toThrow(RangeError);
    expect(() => isFirstOfMonth('2026/04/01')).toThrow(RangeError);
  });

  it('overlap / contains / order are closed-interval string comparisons', () => {
    const fy26 = fiscalYearRange('2026-01-01');
    const fy27 = fiscalYearRange('2027-01-01');
    expect(rangesOverlap(fy26, fy27)).toBe(false);
    expect(rangesOverlap(fy26, { startDate: '2026-12-31', endDate: '2027-12-30' })).toBe(true);
    expect(rangeContains(fy26, '2026-12-31')).toBe(true);
    expect(rangeContains(fy26, '2027-01-01')).toBe(false);
    expect(isValidRange({ startDate: '2026-01-01', endDate: '2026-01-01' })).toBe(true);
    expect(isValidRange({ startDate: '2026-01-02', endDate: '2026-01-01' })).toBe(false);
  });
});

describe('fiscal year / monthly periods — properties', () => {
  it('12 contiguous, non-overlapping periods cover exactly the fiscal year', () => {
    fc.assert(
      fc.property(arbStart, (start) => {
        const year = fiscalYearRange(start);
        const periods = monthlyPeriods(start);
        expect(periods).toHaveLength(12);
        expect(periods[0]?.startDate).toBe(year.startDate);
        expect(periods[11]?.endDate).toBe(year.endDate);
        for (let i = 0; i < 12; i++) {
          const p = periods[i] as { startDate: string; endDate: string; code: string };
          expect(isValidRange(p)).toBe(true);
          expect(p.code).toBe(p.startDate.slice(0, 7));
          expect(p.endDate.slice(0, 7)).toBe(p.code);
          for (let j = i + 1; j < 12; j++)
            expect(rangesOverlap(p, periods[j] as { startDate: string; endDate: string })).toBe(false);
        }
        expect(new Set(periods.map((p) => p.code)).size).toBe(12);
      }),
    );
  });

  it('every date inside the year is in exactly one period; dates outside are in none', () => {
    fc.assert(
      fc.property(arbStart, arbDate, (start, date) => {
        const year = fiscalYearRange(start);
        const hits = monthlyPeriods(start).filter((p) => rangeContains(p, date)).length;
        expect(hits).toBe(rangeContains(year, date) ? 1 : 0);
      }),
    );
  });

  it('consecutive fiscal years never overlap; a year overlaps itself', () => {
    fc.assert(
      fc.property(arbStart, (start) => {
        const a = fiscalYearRange(start);
        const nextStart = monthlyPeriods(start)[11]?.endDate.slice(0, 7) ?? '';
        const [y, m] = nextStart.split('-').map(Number) as [number, number];
        const b = fiscalYearRange(m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1));
        expect(rangesOverlap(a, b)).toBe(false);
        expect(rangesOverlap(b, a)).toBe(false);
        expect(rangesOverlap(a, a)).toBe(true);
        expect(b.startDate > a.endDate).toBe(true);
      }),
    );
  });
});
