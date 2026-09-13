// Pure period arithmetic of the contract module (docs/specs/contract.md AC-2/AC-3/AC-4): billing dates, month
// arithmetic, the due check and nextPeriod — examples plus fast-check properties. Date.UTC is used only here, as an
// independent oracle for month lengths (the implementation uses integer arithmetic).
import { ValidationError } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  billingDate,
  coveredPeriods,
  daysInMonth,
  dueReason,
  formatPeriod,
  isAligned,
  monthsBetween,
  nextPeriodOf,
  parsePeriod,
  periodEnd,
  periodOf,
  periodStart,
  statusFor,
  type DueTerms,
} from '../src/services/periods.ts';

const periodArb = fc
  .record({ y: fc.integer({ min: 1990, max: 2100 }), m: fc.integer({ min: 1, max: 12 }) })
  .map(({ y, m }) => formatPeriod(y, m));
const utcDaysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const terms = (over: Partial<DueTerms> = {}): DueTerms => ({
  status: 'active',
  startDate: '2026-05-22',
  endDate: null,
  intervalMonths: 1,
  ...over,
});

describe('month arithmetic', () => {
  it('daysInMonth: leap years and the Date.UTC oracle', () => {
    expect([
      daysInMonth(2026, 2),
      daysInMonth(2028, 2),
      daysInMonth(2000, 2),
      daysInMonth(1900, 2),
      daysInMonth(2026, 9),
      daysInMonth(2026, 12),
    ]).toEqual([28, 29, 29, 28, 30, 31]);
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2400 }),
        fc.integer({ min: 1, max: 12 }),
        (y, m) => daysInMonth(y, m) === utcDaysInMonth(y, m),
      ),
    );
    expect(() => daysInMonth(2026, 13)).toThrow(ValidationError);
  });

  it('parse / format / start / end of a period; invalid periods are VALIDATION', () => {
    expect(parsePeriod('2026-09')).toEqual({ y: 2026, m: 9 });
    expect([
      periodOf('2026-09-11'),
      periodStart('2026-02'),
      periodEnd('2026-02'),
      periodEnd('2028-02'),
      periodEnd('2026-12'),
    ]).toEqual(['2026-09', '2026-02-01', '2026-02-28', '2028-02-29', '2026-12-31']);
    for (const bad of ['2026-13', '2026-9', '2026-00', '26-09', '2026-09-01'])
      expect(() => parsePeriod(bad)).toThrow(ValidationError);
    expect(() => periodOf('2026-02-30')).toThrow(ValidationError);
  });

  it('addMonths / monthsBetween across year boundaries (property: inverse and associative)', () => {
    expect([
      addMonths('2026-11', 3),
      addMonths('2026-01', -1),
      addMonths('2026-12', 1),
      addMonths('2026-05', 0),
      addMonths('2026-05', -17),
    ]).toEqual(['2027-02', '2025-12', '2027-01', '2026-05', '2024-12']);
    expect([monthsBetween('2026-11', '2027-02'), monthsBetween('2027-02', '2026-11')]).toEqual([3, -3]);
    expect(coveredPeriods('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
    fc.assert(
      fc.property(periodArb, fc.integer({ min: -600, max: 600 }), fc.integer({ min: -600, max: 600 }), (p, a, b) => {
        expect(monthsBetween(p, addMonths(p, a))).toBe(a);
        expect(addMonths(addMonths(p, a), b)).toBe(addMonths(p, a + b));
      }),
    );
  });
});

describe('billing date (AC-3)', () => {
  it('billingDay of the period (advance) or the next month (arrears), clamped to the month length; 31 = 月末', () => {
    expect(billingDate('2026-09', 27, 'advance')).toBe('2026-09-27');
    expect(billingDate('2026-09', 1, 'advance')).toBe('2026-09-01');
    expect(billingDate('2026-02', 31, 'advance')).toBe('2026-02-28');
    expect(billingDate('2028-02', 31, 'advance')).toBe('2028-02-29');
    expect(billingDate('2026-02', 30, 'advance')).toBe('2026-02-28');
    expect(billingDate('2026-09', 31, 'advance')).toBe('2026-09-30');
    expect(billingDate('2026-01', 31, 'arrears')).toBe('2026-02-28');
    expect(billingDate('2026-06', 31, 'arrears')).toBe('2026-07-31');
    expect(billingDate('2026-12', 10, 'arrears')).toBe('2027-01-10');
    for (const bad of [0, 32, 1.5]) expect(() => billingDate('2026-09', bad, 'advance')).toThrow(ValidationError);
  });

  it('property: the date lies in the target month on min(billingDay, month length)', () => {
    fc.assert(
      fc.property(
        periodArb,
        fc.integer({ min: 1, max: 31 }),
        fc.constantFrom('advance' as const, 'arrears' as const),
        (p, day, timing) => {
          const target = timing === 'arrears' ? addMonths(p, 1) : p;
          const { y, m } = parsePeriod(target);
          expect(billingDate(p, day, timing)).toBe(
            `${target}-${String(Math.min(day, utcDaysInMonth(y, m))).padStart(2, '0')}`,
          );
        },
      ),
    );
  });
});

describe('status (AC-2)', () => {
  it('ended once endDate is before the first day of the current month', () => {
    expect(statusFor(null, '2026-09-10')).toBe('active');
    expect(statusFor('2026-08-31', '2026-09-10')).toBe('ended');
    expect(statusFor('2026-09-01', '2026-09-10')).toBe('active');
    expect(statusFor('2026-09-30', '2026-10-01')).toBe('ended');
    expect(statusFor('2027-03-31', '2026-09-10')).toBe('active');
  });
});

describe('due check (AC-3)', () => {
  it('reasons in order: not_active, already_generated, not_started, ended, not_aligned; null = due', () => {
    expect(dueReason(terms({ status: 'draft' }), '2026-06', false)).toBe('not_active');
    expect(dueReason(terms({ status: 'cancelled' }), '2026-06', true)).toBe('not_active');
    expect(dueReason(terms(), '2026-06', true)).toBe('already_generated');
    expect(dueReason(terms(), '2026-04', false)).toBe('not_started');
    expect(dueReason(terms(), '2026-05', false)).toBeNull(); // start month (startDate <= period end)
    expect(dueReason(terms({ endDate: '2026-08-15' }), '2026-08', false)).toBeNull(); // endDate >= period start
    expect(dueReason(terms({ endDate: '2026-08-15' }), '2026-09', false)).toBe('ended');
    expect(dueReason(terms({ status: 'ended', endDate: '2026-08-15' }), '2026-08', false)).toBeNull();
    const quarterly = terms({ startDate: '2026-04-01', intervalMonths: 3 });
    expect(['2026-04', '2026-05', '2026-06', '2026-07', '2027-01'].map((p) => dueReason(quarterly, p, false))).toEqual([
      null,
      'not_aligned',
      'not_aligned',
      null,
      null,
    ]);
    expect(isAligned('2026-03', '2026-04', 3)).toBe(false);
    expect(() => dueReason(terms(), '2026-6', false)).toThrow(ValidationError);
  });
});

describe('nextPeriod (AC-2/AC-4)', () => {
  it('the earliest aligned period without a billing record; in-order generation advances it by intervalMonths', () => {
    expect(nextPeriodOf('2026-05-22', 1, [])).toBe('2026-05');
    expect(nextPeriodOf('2026-05-22', 1, ['2026-05'])).toBe('2026-06');
    expect(nextPeriodOf('2026-05-22', 1, ['2026-05', '2026-06', '2026-08'])).toBe('2026-07'); // a skipped month stays next
    expect(nextPeriodOf('2026-04-01', 3, ['2026-04'])).toBe('2026-07');
    expect(nextPeriodOf('2026-04-01', 3, ['2026-07'])).toBe('2026-04');
    expect(nextPeriodOf('2026-04-01', 3, ['2026-04', '2026-05'])).toBe('2026-07'); // misaligned records are ignored
    expect(nextPeriodOf('2026-11-15', 1, ['2026-11', '2026-12'])).toBe('2027-01');
    expect(() => nextPeriodOf('2026-04-01', 0, [])).toThrow(ValidationError);
  });

  it('property: nextPeriod is aligned, unbilled, every earlier aligned period is billed, and every due period is >= nextPeriod', () => {
    fc.assert(
      fc.property(
        periodArb,
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 30 }),
        fc.integer({ min: 0, max: 40 }),
        (start, k, billedSteps, probeStep) => {
          const billed = billedSteps.map((s) => addMonths(start, s * k));
          const next = nextPeriodOf(`${start}-15`, k, billed);
          expect(isAligned(next, start, k)).toBe(true);
          expect(billed).not.toContain(next);
          for (let p = start; p < next; p = addMonths(p, k)) expect(billed).toContain(p);
          const probe = addMonths(start, probeStep * k);
          if (dueReason(terms({ startDate: `${start}-15`, intervalMonths: k }), probe, billed.includes(probe)) === null)
            expect(next <= probe).toBe(true);
        },
      ),
    );
  });
});
