import { describe, expect, it } from 'vitest';
import { evaluateShift, recommendShift, type ShiftIssueCode, type ShiftProblem } from '../src/scheduling/index.ts';
import { assignment, benchmarkProblem, dateAt, employee, problem, slot } from './shift-fixture.ts';
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing test fixture');
  return value;
}
const codes = (p: ShiftProblem, assignments = [assignment()]) =>
  evaluateShift(p, assignments).issues.map((issue) => issue.code);

const eligibilityCases: [string, ShiftIssueCode, (p: ShiftProblem) => void][] = [
  [
    'inactive employee',
    'inactive',
    (p) => {
      present(p.employees[0]).active = false;
    },
  ],
  [
    'before employment',
    'inactive',
    (p) => {
      present(p.employees[0]).hiredOn = dateAt(1);
    },
  ],
  [
    'after termination',
    'inactive',
    (p) => {
      present(p.employees[0]).terminatedOn = dateAt(-1);
    },
  ],
  [
    'missing profile',
    'missing_profile',
    (p) => {
      present(p.employees[0]).profile = null;
    },
  ],
  [
    'unsubmitted availability',
    'missing_availability',
    (p) => {
      p.availability = [];
    },
  ],
  [
    'unavailable day',
    'unavailable',
    (p) => {
      present(p.availability[0]).preference = 'unavailable';
    },
  ],
  [
    'outside submitted window',
    'unavailable',
    (p) => {
      present(p.availability[0]).endMinute = 720;
    },
  ],
  [
    'missing skill',
    'skill',
    (p) => {
      present(present(p.employees[0]).profile).skills = [];
    },
  ],
];
describe('shift scheduling: hard eligibility and input boundaries', () => {
  it.each(eligibilityCases)('excludes %s and explains the shortage', (_, code, change) => {
    const p = problem();
    change(p);
    expect(codes(p)).toContain(code);
    const result = recommendShift(p, { seed: 1, iterations: 10 });
    expect(result.assignments).toEqual([]);
    expect(result.evaluation.issues).toEqual([]);
    expect(result.evaluation.coverage[0]?.exclusions[code]).toBe(1);
    expect(result.evaluation.shortage).toBe(1);
  });
  it.each(['pending', 'approved'] as const)('excludes every leave portion while %s', (status) => {
    for (const portion of ['full', 'morning', 'afternoon'] as const) {
      const p = problem();
      p.leave = [{ employeeId: 'one', date: dateAt(0), portion, status }];
      expect(codes(p)).toContain('leave');
      expect(recommendShift(p, { seed: 0 }).assignments).toEqual([]);
    }
  });
  it('rejects malformed dates, missing rules, duplicate availability and oversized input', () => {
    const bad = [problem(), problem(), problem(), problem(), problem()];
    present(present(bad[0]).slots[0]).date = '2026-02-30';
    present(bad[1]).rules.pop();
    present(bad[2]).availability.push({ ...present(present(bad[2]).availability[0]) });
    present(bad[3]).employees = Array.from({ length: 101 }, (_, i) => employee(String(i)));
    present(bad[4]).slots = Array.from({ length: 43 }, (_, i) => slot(String(i)));
    for (const p of bad) expect(codes(p)).toEqual(['invalid_input']);
    expect(codes(problem(), [assignment('unknown', 'missing')])).toEqual(
      expect.arrayContaining(['unknown_slot', 'unknown_employee']),
    );
  });
  it('accepts zero-time unavailable days but never treats them as available', () => {
    const p = problem(),
      day = present(p.availability[0]);
    day.preference = 'unavailable';
    day.startMinute = 0;
    day.endMinute = 0;
    expect(codes(p)).toContain('unavailable');
    expect(codes(p)).not.toContain('invalid_input');
    expect(recommendShift(p, { seed: 0 }).assignments).toEqual([]);
    day.preference = 'available';
    expect(codes(p)).toEqual(['invalid_input']);
  });
  it('returns invalid_input for malformed runtime objects and missing required break values', () => {
    for (const malformed of [
      { ...problem(), employees: [null] },
      { ...problem(), slots: [{ ...slot(), breakMinutes: undefined }] },
    ]) {
      expect(evaluateShift(malformed as unknown as ShiftProblem, []).issues).toEqual([{ code: 'invalid_input' }]);
    }
  });
  it('reports duplicate employee/slot assignments and slot overcapacity', () => {
    expect(codes(problem(), [assignment(), assignment()])).toEqual(
      expect.arrayContaining(['duplicate', 'over_capacity']),
    );
    const p = problem([employee(), employee('two')]);
    expect(codes(p, [assignment(), assignment('morning', 'two')])).toContain('over_capacity');
  });
});

describe('shift scheduling: calendar limits and breaks', () => {
  it('uses the stricter company and individual daily and weekly maximums', () => {
    for (const authority of ['company', 'employee'] as const) {
      const p = problem();
      if (authority === 'company') {
        present(p.rules[0]).dailyLimitMinutes = 180;
        present(p.rules[6]).weeklyLimitMinutes = 180;
      } else {
        present(present(p.employees[0]).profile).maxDailyMinutes = 180;
        present(present(p.employees[0]).profile).maxWeeklyMinutes = 180;
        present(present(p.employees[0]).profile).targetMinutes = 180;
      }
      expect(codes(p)).toEqual(expect.arrayContaining(['daily_limit', 'weekly_limit']));
      expect(recommendShift(p, { seed: 5 }).assignments).toEqual([]);
    }
  });
  it('counts distinct work dates and weekly minutes but does not add preceding-week hours to this week', () => {
    const p = problem([employee()], [slot('first'), slot('second', 1)]);
    present(present(p.employees[0]).profile).maxDays = 1;
    expect(codes(p, [assignment('first'), assignment('second')])).toContain('days_limit');
    present(present(p.employees[0]).profile).maxDays = 6;
    present(present(p.employees[0]).profile).maxWeeklyMinutes = 480;
    present(present(p.employees[0]).profile).targetMinutes = 480;
    p.existing = [{ employeeId: 'one', date: dateAt(-1), startMinute: 540, endMinute: 1020, breakMinutes: 60 }];
    expect(codes(p, [assignment('first'), assignment('second')])).toEqual([]);
  });
  it.each(['before', 'after'] as const)('enforces rest across the %s week boundary', (edge) => {
    const offset = edge === 'before' ? 0 : 6,
      p = problem([employee()], [slot('morning', offset)]);
    present(present(p.employees[0]).profile).minRestMinutes = 1440;
    p.existing = [
      {
        employeeId: 'one',
        date: dateAt(edge === 'before' ? -1 : 7),
        startMinute: 540,
        endMinute: 780,
        breakMinutes: 0,
      },
    ];
    expect(codes(p)).toContain('rest');
    expect(recommendShift(p, { seed: 8 }).assignments).toEqual([]);
  });
  it.each(['before', 'after'] as const)('enforces consecutive days across the %s week boundary', (edge) => {
    const offset = edge === 'before' ? 0 : 6,
      p = problem([employee()], [slot('morning', offset)]);
    p.existing = Array.from({ length: 6 }, (_, index) => ({
      employeeId: 'one',
      date: dateAt(edge === 'before' ? index - 6 : index + 7),
      startMinute: 540,
      endMinute: 780,
      breakMinutes: 0,
    }));
    expect(codes(p)).toContain('consecutive_limit');
  });
  it('detects overlap and requires declared breaks for combined daily work', () => {
    const p = problem([employee()], [slot('first'), { ...slot('second'), startMinute: 720, endMinute: 900 }]);
    present(present(p.employees[0]).profile).minRestMinutes = 0;
    expect(codes(p, [assignment('first'), assignment('second')])).toContain('overlap');
    present(p.slots[1]).startMinute = 780;
    present(p.slots[1]).endMinute = 1020;
    expect(codes(p, [assignment('first'), assignment('second')])).toContain('break');
    present(p.slots[1]).breakMinutes = 45;
    expect(codes(p, [assignment('first'), assignment('second')])).toEqual([]);
  });
  it('uses strict greater-than break thresholds, and exact rest equality is permitted', () => {
    const p = problem();
    present(p.slots[0]).endMinute = 900;
    expect(codes(p)).toEqual([]);
    present(p.slots[0]).endMinute = 901;
    expect(codes(p)).toContain('break');
    present(p.slots[0]).endMinute = 900;
    p.existing = [{ employeeId: 'one', date: dateAt(-1), startMinute: 540, endMinute: 1320, breakMinutes: 60 }];
    expect(codes(p)).toEqual([]); // 22:00 to09:00 is exactly660 minutes.
  });
});

describe('shift scheduling: feasible recommendation and reproducibility', () => {
  it('preserves invalid fixed assignments, reports their violations, and never silently replaces them', () => {
    const p = problem([employee(), employee('two')]);
    present(p.availability[0]).preference = 'unavailable';
    const fixed = assignment('morning', 'one', true),
      result = recommendShift(p, { seed: 10, assignments: [fixed] });
    expect(result.assignments).toEqual([fixed]);
    expect(result.evaluation.issues.map((i) => i.code)).toContain('unavailable');
    expect(result.iterations).toBe(0);
  });
  it('repairs invalid unlocked input while retaining valid fixed work', () => {
    const p = problem([employee(), employee('two')], [slot('first'), slot('second', 1)]);
    const fixed = assignment('first', 'two', true);
    const result = recommendShift(p, { seed: 4, assignments: [fixed, assignment('unknown', 'missing')] });
    expect(result.assignments).toContainEqual(fixed);
    expect(result.assignments.some((a) => a.slotId === 'unknown')).toBe(false);
    expect(result.evaluation.issues).toEqual([]);
    expect(result.evaluation.shortage).toBe(0);
  });
  it('does not mutate inputs and returns exactly the same seed/iteration result', () => {
    const p = problem(
      [employee(), employee('two'), employee('three')],
      Array.from({ length: 7 }, (_, day) => slot(String(day), day)),
    );
    const before = structuredClone(p),
      a = recommendShift(p, { seed: 123, iterations: 350 }),
      b = recommendShift(p, { seed: 123, iterations: 350 });
    expect(p).toEqual(before);
    expect(a).toEqual(b);
    expect(a.iterations).toBe(350);
    expect(a.evaluation.issues).toEqual([]);
    expect(a.evaluation.shortage).toBe(0);
    expect(evaluateShift(p, a.assignments)).toEqual(a.evaluation);
  });
  it('prefers submitted preferences and balances time relative to individual targets', () => {
    const first = employee(),
      second = employee('two');
    present(first.profile).targetMinutes = 240;
    present(second.profile).targetMinutes = 480;
    const p = problem([first, second], [slot('first'), slot('second', 1), slot('third', 2)]);
    const result = recommendShift(p, { seed: 2, iterations: 1200 });
    expect(result.evaluation.shortage).toBe(0);
    expect(result.evaluation.preferenceRate).toBe(1);
    expect(result.evaluation.fairness).toBe(0);
    expect(result.evaluation.employees.map((e) => e.minutes)).toEqual([240, 480]);
    const preferences = problem([employee(), employee('two')]);
    present(preferences.availability[0]).preference = 'available';
    expect(recommendShift(preferences, { seed: 2 }).assignments).toEqual([assignment('morning', 'two')]);
  });
  it('improves a fully covered but nonpreferred starting plan through replacement or exchange', () => {
    const p = problem([employee(), employee('two')], [slot('first'), slot('second', 1)]);
    for (const availability of p.availability)
      availability.preference =
        (availability.employeeId === 'one' && availability.date === dateAt(0)) ||
        (availability.employeeId === 'two' && availability.date === dateAt(1))
          ? 'preferred'
          : 'available';
    const assignments = [assignment('first', 'two'), assignment('second', 'one')];
    const initial = recommendShift(p, { seed: 12, iterations: 0, assignments }),
      optimized = recommendShift(p, { seed: 12, iterations: 150, assignments });
    expect(initial.evaluation.preferenceRate).toBe(0);
    expect(optimized.evaluation.preferenceRate).toBe(1);
    expect(optimized.evaluation.shortage).toBe(0);
    expect(optimized.evaluation.score).toBeLessThan(initial.evaluation.score);
  });
  it('handles100 employees and42 capacity20 slots within the supply bound', () => {
    const p = benchmarkProblem(),
      result = recommendShift(p, { seed: 20260912, iterations: 50 });
    expect(result.assignments).toHaveLength(500);
    expect(result.evaluation.shortage).toBe(340);
    expect(result.evaluation.issues).toEqual([]);
    for (const employee of p.employees) {
      const own = result.assignments.filter((a) => a.employeeId === employee.id);
      expect(own).toHaveLength(5);
      expect(new Set(own.map((a) => present(p.slots.find((slot) => slot.id === a.slotId)).date)).size).toBe(5);
    }
  });
  it('prioritizes coverage and explains unavoidable shortages without infeasible assignments', () => {
    const p = problem();
    present(p.slots[0]).required = 2;
    const result = recommendShift(p, { seed: 7, iterations: 100 });
    expect(result.evaluation.issues).toEqual([]);
    expect(result.evaluation.shortage).toBe(1);
    expect(result.assignments).toHaveLength(1);
    expect(result.evaluation.score).toBeLessThan(evaluateShift(p, []).score);
    expect(recommendShift(p, { seed: 1, iterations: 1000000000 }).iterations).toBe(10000);
  });
});
