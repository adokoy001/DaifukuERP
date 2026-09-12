import { describe, expect, it } from 'vitest';
import { calculatePay, type PayDay, type PayPolicy, type PayTerms } from '../src/services/pay-calculation.ts';
import { legalPeriodMs, validateWorkSystem } from '../src/services/work-system.ts';
import { workSystem, workingDates } from './work-system-fixtures.ts';
const employeeId = '00000000-0000-4000-8000-000000000001';
const policy: PayPolicy = { id: 'policy', weekStartsOn: 1, dailyLimitMinutes: 480, weeklyLimitMinutes: 2400, monthlyOvertimeThresholdMinutes: 3600, overtimePremiumRate: '0.25', highOvertimePremiumRate: '0.5', holidayPremiumRate: '0.35', nightPremiumRate: '0.25' };
const terms: PayTerms[] = [{ id: 'term', validFrom: '2026-01-01', validTo: '2026-12-31', payType: 'monthly', hourlyRate: '0', monthlySalary: '300000', monthlyBaseMinutes: 9600, paidLeaveDayMinutes: 480 }];
const day = (date: string, hours: number): PayDay => ({ date, workedMs: hours * 3600000, nightMs: 0, dayKind: 'workday', policy });
function distributed(period: string, hours: number): PayDay[] { const dates = workingDates(period), total = hours * 3600000, base = Math.floor(total / dates.length); return dates.map((date, index) => ({ ...day(date, 0), workedMs: base + (index === dates.length - 1 ? total - base * dates.length : 0) })); }
describe('verified ordinary, monthly variable and flex settlement', () => {
  it('rejects non-calendar periods, missing daily plans, excessive planned totals and unconfirmed flex freedom/filing', () => {
    const input = workSystem(employeeId); expect(() => validateWorkSystem(input)).not.toThrow();
    expect(() => validateWorkSystem({ ...input, startsOn: '2026-10-02' })).toThrow(); expect(() => validateWorkSystem({ ...input, days: input.days.slice(1) })).toThrow();
    expect(() => validateWorkSystem({ ...input, agreedTotalMinutes: 20000 })).toThrow();
    const flex = workSystem(employeeId, '2026-04-01', '2026-06-30', 'flex');
    expect(() => validateWorkSystem({ ...flex, employeeChoiceConfirmed: false })).toThrow(); expect(() => validateWorkSystem({ ...flex, filingConfirmed: false })).toThrow();
  });
  it('honors prior ten-hour days without discarding ordinary daily protection', () => {
    const variable = workSystem(employeeId); variable.days = variable.days.map((row) => row.date === '2026-10-01' ? { ...row, scheduledMinutes: 600, endMinute: 1200 } : row.date === '2026-10-02' ? { ...row, scheduledMinutes: 360, endMinute: 960 } : row);
    validateWorkSystem(variable);
    const input = { period: '2026-10', employmentStart: '2026-10-01', employmentEnd: '2026-10-31', terms, days: [day('2026-10-01', 10), day('2026-10-31', 0)], leaves: [] };
    expect(calculatePay(input).overtimeMs).toBe(2 * 3600000);
    expect(calculatePay({ ...input, workSystems: [variable] }).overtimeMs).toBe(0);
    expect(calculatePay({ ...input, days: [day('2026-10-01', 11), day('2026-10-31', 0)], workSystems: [variable] }).overtimeMs).toBe(3600000);
  });
  it('adds only the remaining monthly-variable period excess and ordinary wage difference', () => {
    const system = workSystem(employeeId), days = [...workingDates('2026-10').map((date) => day(date, 8)), day('2026-10-03', 8), day('2026-10-31', 0)];
    const result = calculatePay({ period: '2026-10', employmentStart: '2026-10-01', employmentEnd: '2026-10-31', terms, days, leaves: [], workSystems: [system] });
    expect(result.workedMs).toBe(184 * 3600000); expect(result.overtimeMs).toBe(184 * 3600000 - legalPeriodMs(2400, 31));
    expect(result.basePay.toString()).toBe('315000'); expect(result.details.find((row) => row['date'] === '2026-10-31')?.['regularSupplementMs']).toBe(legalPeriodMs(2400, 31) - 176 * 3600000);
  });
  it('settles three-month flex with monthly 50-hour excess removed from final 40-hour excess', () => {
    const system = workSystem(employeeId, '2026-04-01', '2026-06-30', 'flex');
    // The agreed 480 hours are distributed across the declared days before the period starts.
    let remaining = 480 * 60; system.days = system.days.map((row) => { const scheduledMinutes = Math.min(row.scheduledMinutes, remaining); remaining -= scheduledMinutes; return { ...row, scheduledMinutes }; }); system.agreedTotalMinutes = 480 * 60; validateWorkSystem(system);
    const april = distributed('2026-04', 230), may = distributed('2026-05', 180), june = distributed('2026-06', 160);
    const first = calculatePay({ period: '2026-04', employmentStart: '2026-04-01', employmentEnd: '2026-04-30', terms, days: april, leaves: [], workSystems: [system] });
    expect(first.overtimeMs).toBe(230 * 3600000 - legalPeriodMs(3000, 30));
    const last = calculatePay({ period: '2026-06', employmentStart: '2026-06-01', employmentEnd: '2026-06-30', terms, days: [...april, ...may, ...june], leaves: [], workSystems: [system] });
    expect(last.overtimeMs + first.overtimeMs).toBe(50 * 3600000);
    expect(last.details.find((row) => row['date'] === '2026-06-30')?.['regularSupplementMs']).toBe(40 * 3600000);
    expect(last.premiumPay.gt(0)).toBe(true);
  });
  it('keeps holiday overtime separate and paid leave out of statutory actual work', () => {
    const system = workSystem(employeeId, '2026-02-01', '2026-02-28', 'flex'), dates = workingDates('2026-02');
    const days = dates.slice(1).map((date) => day(date, 8)); days.push({ ...day('2026-02-01', 8), dayKind: 'statutory_holiday' }, day('2026-02-28', 0));
    const result = calculatePay({ period: '2026-02', employmentStart: '2026-02-01', employmentEnd: '2026-02-28', terms, days, leaves: [{ date: dates[0] ?? '', days: '1' }], workSystems: [system] });
    expect(result.overtimeMs).toBe(0); expect(result.paidLeaveDays.toString()).toBe('1'); expect(result.basePay.toString()).toBe('315000'); expect(result.premiumPay.toString()).toBe('5250');
  });
});
