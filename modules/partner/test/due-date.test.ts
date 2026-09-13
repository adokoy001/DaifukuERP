import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { closingDateOf, computeDueDate, daysInMonth, resolveDueDate } from '../src/services/due-date.ts';

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

/** Any valid calendar date in 2000..2099 (leap years included). */
const arbDate = fc
  .record({
    y: fc.integer({ min: 2000, max: 2099 }),
    m: fc.integer({ min: 1, max: 12 }),
    dayFrac: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ y, m, dayFrac }) => ymd(y, m, Math.min(dayFrac, daysInMonth(y, m))));
const arbTerms = fc.record({
  closingDay: fc.integer({ min: 1, max: 31 }),
  paymentMonthOffset: fc.integer({ min: 0, max: 3 }),
  paymentDay: fc.integer({ min: 1, max: 31 }),
});

describe('computeDueDate (spec AC-10, AC-5) — examples', () => {
  it('月末締め翌月末払い: invoice mid-month pays at the end of next month', () => {
    expect(computeDueDate('2026-09-10', 31, 1, 31)).toBe('2026-10-31');
  });

  it('31 clamps to short months (February, 30-day months, leap year)', () => {
    expect(computeDueDate('2026-01-15', 31, 1, 31)).toBe('2026-02-28');
    expect(computeDueDate('2028-01-15', 31, 1, 31)).toBe('2028-02-29');
    expect(computeDueDate('2026-03-05', 31, 1, 31)).toBe('2026-04-30');
    expect(closingDateOf('2026-02-10', 31)).toBe('2026-02-28');
    expect(closingDateOf('2026-02-10', 30)).toBe('2026-02-28');
  });

  it('20日締め翌月10日払い: on/before the 20th belongs to this period, after it to the next', () => {
    expect(computeDueDate('2026-09-20', 20, 1, 10)).toBe('2026-10-10');
    expect(computeDueDate('2026-09-21', 20, 1, 10)).toBe('2026-11-10');
    expect(resolveDueDate('2026-09-21', { closingDay: 20, paymentMonthOffset: 1, paymentDay: 10 })).toEqual({
      closingDate: '2026-10-20',
      dueDate: '2026-11-10',
    });
  });

  it('offset 0 (当月払い): a payment day before the closing date rolls to the following month', () => {
    expect(computeDueDate('2026-09-05', 20, 0, 31)).toBe('2026-09-30');
    expect(computeDueDate('2026-09-05', 31, 0, 10)).toBe('2026-10-10');
  });

  it('offset 3 crosses the year boundary', () => {
    expect(computeDueDate('2026-11-30', 31, 3, 15)).toBe('2027-02-15');
    expect(computeDueDate('2026-12-31', 31, 1, 31)).toBe('2027-01-31');
  });

  it('rejects out-of-range terms and malformed dates', () => {
    expect(() => computeDueDate('2026-09-10', 0, 1, 31)).toThrow(RangeError);
    expect(() => computeDueDate('2026-09-10', 31, 4, 31)).toThrow(RangeError);
    expect(() => computeDueDate('2026-09-10', 31, 1, 32)).toThrow(RangeError);
    expect(() => computeDueDate('2026-02-30', 31, 1, 31)).toThrow(RangeError);
    expect(() => computeDueDate('2026/09/10', 31, 1, 31)).toThrow(RangeError);
  });
});

describe('computeDueDate — properties', () => {
  it('result >= closingDate >= invoiceDate, and both are valid calendar dates', () => {
    fc.assert(
      fc.property(arbDate, arbTerms, (invoiceDate, terms) => {
        const { closingDate, dueDate } = resolveDueDate(invoiceDate, terms);
        expect(closingDate >= invoiceDate).toBe(true);
        expect(dueDate >= closingDate).toBe(true);
        for (const s of [closingDate, dueDate]) {
          const [y, m, d] = s.split('-').map(Number) as [number, number, number];
          expect(d).toBeGreaterThanOrEqual(1);
          expect(d).toBeLessThanOrEqual(daysInMonth(y, m));
        }
      }),
    );
  });

  it('day-of-month never exceeds the month length and equals min(paymentDay, month length)', () => {
    fc.assert(
      fc.property(arbDate, arbTerms, (invoiceDate, terms) => {
        const due = computeDueDate(invoiceDate, terms.closingDay, terms.paymentMonthOffset, terms.paymentDay);
        const [y, m, d] = due.split('-').map(Number) as [number, number, number];
        expect(d).toBe(Math.min(terms.paymentDay, daysInMonth(y, m)));
      }),
    );
  });

  it('is idempotent w.r.t. the closing period: every invoice date in a period yields the same due date', () => {
    fc.assert(
      fc.property(arbDate, arbTerms, fc.integer({ min: 0, max: 30 }), (invoiceDate, terms, back) => {
        const closing = closingDateOf(invoiceDate, terms.closingDay);
        // walk back up to `back` days but never past the period start (the day after the previous closing date)
        const [y, m, d] = invoiceDate.split('-').map(Number) as [number, number, number];
        const t = new Date(Date.UTC(y, m - 1, d));
        t.setUTCDate(t.getUTCDate() - back);
        const other = t.toISOString().slice(0, 10);
        fc.pre(closingDateOf(other, terms.closingDay) === closing);
        expect(computeDueDate(other, terms.closingDay, terms.paymentMonthOffset, terms.paymentDay)).toBe(
          computeDueDate(invoiceDate, terms.closingDay, terms.paymentMonthOffset, terms.paymentDay),
        );
        expect(computeDueDate(closing, terms.closingDay, terms.paymentMonthOffset, terms.paymentDay)).toBe(
          computeDueDate(invoiceDate, terms.closingDay, terms.paymentMonthOffset, terms.paymentDay),
        );
      }),
    );
  });

  it('the due date is at most (offset + 2) months after the invoice date', () => {
    fc.assert(
      fc.property(arbDate, arbTerms, (invoiceDate, terms) => {
        const due = computeDueDate(invoiceDate, terms.closingDay, terms.paymentMonthOffset, terms.paymentDay);
        const months = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7));
        expect(months(due) - months(invoiceDate)).toBeLessThanOrEqual(terms.paymentMonthOffset + 2);
      }),
    );
  });
});
