import { describe, expect, it } from 'vitest';
import { declarationFromForm } from './fiscal-form.ts';
import { monthDays, timeInput, timeMinute, weekdayTemplate } from './work-system-form.ts';
describe('annual declaration wire input', () => {
  it('does not silently assert legal eligibility when confirmations are unchecked', () => {
    const result = declarationFromForm(new FormData(), { spouse: false, relatives: 0, previousEmployers: 0, unpaidMonths: 0 });
    expect(result.resident).toBe(false); expect(result.mainEmployer).toBe(false); expect(result.factsConfirmed).toBe(false);
    expect(result.housingEligibilityConfirmed).toBe(false); expect(result.distinctEarthquakeContractsConfirmed).toBe(false);
    expect(result.spouse).toBeNull(); expect(result.relatives).toEqual([]); expect(result.otherIncome).toBe('');
  });
  it('preserves yen strings and individual family confirmations without substituting facts', () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ otherIncome: '999999999999', resident: 'on', factsConfirmed: 'on', 'relative0.code': 'Child1', 'relative0.income': '850000', 'relative0.resident': 'on', 'relative0.sharedLivelihoodConfirmed': 'on', 'previous0.taxablePay': '1234567', 'unpaid0.period': '2026-01', 'unpaid0.reason': 'Before joining' })) data.set(key, value);
    const result = declarationFromForm(data, { spouse: true, relatives: 1, previousEmployers: 1, unpaidMonths: 1 });
    expect(result.otherIncome).toBe('999999999999'); expect(result.resident).toBe(true); expect(result.mainEmployer).toBe(false);
    expect(result.relatives).toEqual([expect.objectContaining({ code: 'Child1', income: '850000', resident: true, sharedLivelihoodConfirmed: true, eligibilityConfirmed: false, claimDependentDeduction: false })]);
    data.set('relative0.claimDependentDeduction', 'on');
    expect(declarationFromForm(data, { spouse: false, relatives: 1, previousEmployers: 0, unpaidMonths: 0 }).relatives).toEqual([expect.objectContaining({ claimDependentDeduction: true })]);
    expect(result.spouse).toMatchObject({ specialDeductionNotDuplicated: false });
    expect(result.previousEmployers).toEqual([expect.objectContaining({ taxablePay: '1234567' })]);
    expect(result.unpaidMonths).toEqual([{ period: '2026-01', reason: 'Before joining' }]);
  });
});
describe('working-time calendar input', () => {
  it('covers complete calendar months across leap years and year boundaries with a strict size limit', () => {
    expect(monthDays('2028-02', '2028-02')).toHaveLength(29);
    const days = monthDays('2026-12', '2027-02'); expect(days).toHaveLength(90); expect(days[0]).toBe('2026-12-01'); expect(days.at(-1)).toBe('2027-02-28');
    for (const [from, to] of [['2026-01','2026-04'], ['2026-03','2026-02'], ['2026-13','2026-13'], ['bad','2026-01']]) expect(monthDays(from as string, to as string)).toEqual([]);
  });
  it('creates an editable template without scheduling work on statutory holidays', () => {
    const days = weekdayTemplate(monthDays('2026-02', '2026-02'));
    expect(days.filter((day) => day.statutoryHoliday)).toHaveLength(4);
    expect(days.filter((day) => day.statutoryHoliday).every((day) => day.scheduledMinutes === 0)).toBe(true);
    expect(days.reduce((sum, day) => sum + day.scheduledMinutes, 0)).toBe(9600);
    expect(days.every((day) => day.scheduledMinutes <= day.endMinute - day.startMinute)).toBe(true);
  });
  it('does not turn empty or malformed time controls into valid midnight', () => {
    expect(timeMinute('09:30')).toBe(570); expect(timeInput(570)).toBe('09:30');
    for (const value of ['', '24:00', '25:99', '9:30']) expect(timeMinute(value)).toBeNaN();
    expect(timeInput(Number.NaN)).toBe('');
  });
});
