import { describe, expect, it } from 'vitest';
import {
  calculatePay,
  type PayDay,
  type PayInput,
  type PayPolicy,
  type PayTerms,
} from '../src/services/pay-calculation.ts';
const hour = 3600000;
const policy: PayPolicy = {
  id: 'ordinary',
  weekStartsOn: 1,
  dailyLimitMinutes: 480,
  weeklyLimitMinutes: 2400,
  monthlyOvertimeThresholdMinutes: 3600,
  overtimePremiumRate: '0.25',
  highOvertimePremiumRate: '0.50',
  holidayPremiumRate: '0.35',
  nightPremiumRate: '0.25',
};
const terms: PayTerms = {
  id: 'hourly',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
  payType: 'hourly',
  hourlyRate: '1000',
  monthlySalary: '0',
  monthlyBaseMinutes: 9600,
  paidLeaveDayMinutes: 480,
};
const day = (date: string, hours: number, extra: Partial<PayDay> = {}): PayDay => ({
  date,
  workedMs: hours * hour,
  nightMs: 0,
  dayKind: 'workday',
  policy,
  ...extra,
});
const input = (extra: Partial<PayInput> = {}): PayInput => ({
  period: '2026-09',
  employmentStart: '2026-09-01',
  employmentEnd: '2026-09-30',
  terms: [terms],
  days: [],
  leaves: [],
  ...extra,
});
const monthly = (extra: Partial<PayTerms> = {}): PayTerms => ({
  ...terms,
  id: 'monthly',
  payType: 'monthly',
  hourlyRate: '0',
  monthlySalary: '300000',
  ...extra,
});
const amounts = (result: ReturnType<typeof calculatePay>) => [
  result.basePay.toString(),
  result.premiumPay.toString(),
  result.grossPay.toString(),
];
describe('independent ordinary payroll calculation examples', () => {
  it('deduplicates daily and weekly overtime for six nine-hour days', () => {
    const result = calculatePay(
      input({ days: [7, 8, 9, 10, 11, 12].map((n) => day(`2026-09-${String(n).padStart(2, '0')}`, 9)) }),
    );
    expect(result.workedMs).toBe(54 * hour);
    expect(result.overtimeMs).toBe(14 * hour);
    expect(amounts(result)).toEqual(['54000', '3500', '57500']);
    expect(result.details[5]).toMatchObject({ regularMs: 0, overtimeMs: 9 * hour });
  });
  it('charges only overtime above 60 monthly hours at the higher premium', () => {
    const dates = [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22];
    const result = calculatePay(input({ days: dates.map((n) => day(`2026-09-${String(n).padStart(2, '0')}`, 12)) }));
    expect(result.overtimeMs).toBe(64 * hour);
    expect(amounts(result)).toEqual(['192000', '17000', '209000']);
    expect(result.details[14]).toMatchObject({ highOvertimeMs: 0 });
    expect(result.details[15]).toMatchObject({ highOvertimeMs: 4 * hour });
  });
  it('adds holiday and night premiums, without counting statutory holiday hours as weekly overtime', () => {
    const workdays = [7, 8, 9, 10, 11].map((n) => day(`2026-09-${String(n).padStart(2, '0')}`, 8));
    const result = calculatePay(
      input({ days: [...workdays, day('2026-09-13', 8, { dayKind: 'statutory_holiday', nightMs: 2 * hour })] }),
    );
    expect(result.overtimeMs).toBe(0);
    expect(amounts(result)).toEqual(['48000', '3300', '51300']);
    expect(result.details[5]).toMatchObject({ holidayMs: 8 * hour, overtimeMs: 0, nightMs: 2 * hour });
  });
  it('includes the previous month in the boundary week, without paying it twice or carrying its monthly overtime', () => {
    const result = calculatePay(
      input({ days: [day('2026-08-31', 12), ...[1, 2, 3, 4, 5].map((n) => day(`2026-09-0${n}`, 8))] }),
    );
    expect(result.workedMs).toBe(40 * hour);
    expect(result.overtimeMs).toBe(8 * hour);
    expect(amounts(result)).toEqual(['40000', '2000', '42000']);
    expect(result.details).toHaveLength(5);
  });
  it('keeps seconds through aggregation and rounds monetary totals, not each punch or day', () => {
    const result = calculatePay(
      input({
        days: [
          day('2026-09-01', 0, { workedMs: 1000, nightMs: 1000 }),
          day('2026-09-02', 0, { workedMs: 1000, nightMs: 1000 }),
        ],
      }),
    );
    expect(result.workedMs).toBe(2000);
    expect(amounts(result)).toEqual(['1', '1', '2']);
  });
  it('prorates monthly pay by the agreed calendar-day convention for hire and termination', () => {
    expect(
      amounts(calculatePay(input({ employmentStart: '2026-09-11', employmentEnd: '2026-09-20', terms: [monthly()] }))),
    ).toEqual(['100000', '0', '100000']);
    const result = calculatePay(
      input({
        terms: [
          monthly({ id: 'old', validTo: '2026-09-15' }),
          monthly({ id: 'new', validFrom: '2026-09-16', monthlySalary: '360000' }),
        ],
      }),
    );
    expect(amounts(result)).toEqual(['330000', '0', '330000']);
  });
  it('keeps the exact agreed monthly salary across all 31 calendar days', () => {
    const result = calculatePay(
      input({ period: '2026-08', employmentStart: '2026-08-01', employmentEnd: '2026-08-31', terms: [monthly()] }),
    );
    expect(amounts(result)).toEqual(['300000', '0', '300000']);
  });
  it('pays hourly leave with effective day minutes and rates, while monthly leave adds no duplicate base pay', () => {
    const hourly = calculatePay(
      input({
        terms: [
          { ...terms, validTo: '2026-09-15' },
          { ...terms, id: 'new', validFrom: '2026-09-16', hourlyRate: '1200' },
        ],
        leaves: [
          { date: '2026-09-15', days: '0.5' },
          { date: '2026-09-16', days: '1' },
        ],
      }),
    );
    expect(amounts(hourly)).toEqual(['13600', '0', '13600']);
    expect(hourly.paidLeaveDays.toString()).toBe('1.5');
    const salaried = calculatePay(
      input({ terms: [monthly()], leaves: [{ date: '2026-09-15', days: '1' }], days: [day('2026-09-14', 9)] }),
    );
    expect(amounts(salaried)).toEqual(['301875', '469', '302344']);
    expect(salaried.paidLeavePay).toBe('0');
  });
  it('refuses missing / overlapping conditions, inconsistent workweek origin and duplicate attendance', () => {
    expect(() => calculatePay(input({ terms: [{ ...terms, validFrom: '2026-09-02' }] }))).toThrow();
    expect(() => calculatePay(input({ terms: [terms, { ...terms, id: 'duplicate' }] }))).toThrow();
    expect(() =>
      calculatePay(
        input({ days: [day('2026-09-01', 8), day('2026-09-02', 8, { policy: { ...policy, weekStartsOn: 0 } })] }),
      ),
    ).toThrow();
    expect(() => calculatePay(input({ days: [day('2026-09-01', 8), day('2026-09-01', 1)] }))).toThrow();
    expect(() => calculatePay(input({ days: [day('2026-09-01', 8, { nightMs: 9 * hour })] }))).toThrow();
  });
});
