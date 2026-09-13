import { describe, expect, it } from 'vitest';
import { evaluateShift, recommendShift, type ShiftProblem, type ShiftWorkRule } from '../src/scheduling/index.ts';
import { assignment, dateAt, employee, problem, slot } from './shift-fixture.ts';
function prepared(): ShiftProblem {
  const person = employee();
  if (!person.profile) throw new Error('Missing profile');
  person.profile.maxDailyMinutes = 960;
  person.profile.maxWeeklyMinutes = 5760;
  const result = problem([person], [{ ...slot(), startMinute: 540, endMinute: 1200, breakMinutes: 60 }]);
  result.availability = result.availability.map((row) => ({ ...row, startMinute: 0, endMinute: 1440 }));
  return result;
}
function rule(mode: ShiftWorkRule['mode'] = 'monthly_variable'): ShiftWorkRule {
  return {
    employeeId: 'one',
    date: dateAt(0),
    mode,
    dailyLimitMinutes: 600,
    weeklyLimitMinutes: 3000,
    startMinute: 540,
    endMinute: 1200,
    statutoryHoliday: false,
  };
}
const codes = (input: ShiftProblem) => evaluateShift(input, [assignment()]).issues.map((row) => row.code);
describe('shift work-system constraints share legal-period source', () => {
  it('requires an effective declared system before using the higher operational profile', () => {
    const input = prepared();
    expect(codes(input)).toContain('daily_limit');
    input.workRules = [rule()];
    expect(codes(input)).toEqual([]);
  });
  it('preserves stricter individual and company limits even with a variable schedule', () => {
    const input = prepared();
    input.workRules = [rule()];
    const person = input.employees[0];
    if (!person?.profile || !input.rules[0]) throw new Error('Missing fixture');
    person.profile.maxDailyMinutes = 480;
    expect(codes(input)).toContain('daily_limit');
    person.profile.maxDailyMinutes = 960;
    input.rules[0].dailyLimitMinutes = 420;
    expect(codes(input)).toContain('daily_limit');
  });
  it('rejects work outside fixed prior time windows and declared statutory holidays', () => {
    const input = prepared();
    input.workRules = [{ ...rule(), startMinute: 600 }];
    expect(codes(input)).toContain('work_system');
    input.workRules = [{ ...rule(), statutoryHoliday: true }];
    expect(codes(input)).toContain('work_system');
  });
  it('treats flex windows as proposals while respecting the remaining period and monthly budget', () => {
    const input = prepared();
    input.workRules = [{ ...rule('flex'), startMinute: 0, endMinute: 0 }];
    input.periodBudgets = [{ employeeId: 'one', startsOn: dateAt(-2), endsOn: dateAt(20), remainingMinutes: 600 }];
    expect(codes(input)).toEqual([]);
    input.periodBudgets = [
      { ...input.periodBudgets[0], employeeId: 'one', startsOn: dateAt(-2), endsOn: dateAt(20), remainingMinutes: 599 },
    ];
    expect(codes(input)).toContain('period_limit');
    const result = recommendShift(input, { seed: 5 });
    expect(result.assignments).toEqual([]);
    expect(result.evaluation.coverage[0]?.exclusions.period_limit).toBe(1);
  });
  it('returns structured invalid input for malformed or unknown system sources', () => {
    for (const changed of [
      { workRules: [null] },
      { workRules: [{ ...rule(), employeeId: 'unknown' }] },
      { periodBudgets: [{ employeeId: 'one', startsOn: '2026-02-30', endsOn: dateAt(20), remainingMinutes: 100 }] },
    ])
      expect(evaluateShift({ ...prepared(), ...changed } as unknown as ShiftProblem, []).issues).toEqual([
        { code: 'invalid_input' },
      ]);
  });
});
