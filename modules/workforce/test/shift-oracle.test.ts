import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateShift, recommendShift, type ShiftAssignment, type ShiftProblem } from '../src/scheduling/index.ts';
import { denseProblem, smallProblem } from './shift-oracle-fixture.ts';
import { enumerateAssignments, oracleFeasible, oracleShortage } from './shift-oracle.ts';
function compare(problem: ShiftProblem, fixed: ShiftAssignment[] = []) {
  let feasible = 0;
  let forbidden = 0;
  let examined = 0;
  let minimum = Infinity;
  for (const rows of enumerateAssignments(problem, fixed)) {
    const valid = oracleFeasible(problem, rows);
    const actual = evaluateShift(problem, rows);
    expect(
      actual.issues.some((issue) => issue.code === 'invalid_input'),
      'generator must stay inside the supported input contract',
    ).toBe(false);
    expect(actual.issues.length === 0, JSON.stringify({ rows, issues: actual.issues })).toBe(valid);
    if (valid) {
      feasible++;
      minimum = Math.min(minimum, oracleShortage(problem, rows));
    } else forbidden++;
    examined++;
  }
  return { feasible, forbidden, examined, minimum };
}
function recommendAndMeasure(problem: ShiftProblem, minimum: number, fixed: ShiftAssignment[] = []) {
  const result = recommendShift(problem, { seed: 20260913, iterations: 150, assignments: fixed });
  expect(oracleFeasible(problem, result.assignments)).toBe(true);
  for (const row of fixed) expect(result.assignments).toContainEqual(row);
  const shortage = oracleShortage(problem, result.assignments);
  expect(result.evaluation.shortage).toBe(shortage);
  expect(shortage - minimum).toBeGreaterThanOrEqual(0); // Quality gap; not an assertion of global optimality.
  return shortage - minimum;
}
describe('AC-5 / PV-SHIFT-01 independent bounded assignment oracle', () => {
  it('enumerates all4096 assignments, reaches valid/forbidden outcomes and measures the seeded quality gap', () => {
    const problem = denseProblem();
    const result = compare(problem);
    expect(result.examined).toBe(4096);
    expect(result.feasible).toBeGreaterThan(1);
    expect(result.forbidden).toBeGreaterThan(1);
    expect(result.minimum).toBe(0);
    expect(recommendAndMeasure(problem, result.minimum)).toBe(0);
    const fixed = [{ employeeId: 'p0', slotId: 's0', locked: true }];
    const constrained = compare(problem, fixed);
    expect(constrained.examined).toBe(2048);
    expect(constrained.feasible).toBeGreaterThan(0);
    expect(constrained.forbidden).toBeGreaterThan(0);
    recommendAndMeasure(problem, constrained.minimum, fixed);
  }, 30000);
  it('compares generated ordinary problems with every bounded assignment and preserves input data', () => {
    let examined = 0;
    let allowed = 0;
    let denied = 0;
    let gaps = 0;
    fc.assert(
      fc.property(smallProblem, (problem) => {
        const before = structuredClone(problem);
        const result = compare(problem);
        examined += result.examined;
        allowed += result.feasible;
        denied += result.forbidden;
        expect(result.feasible).toBeGreaterThan(1); // Empty and the generated anchor assignment must both be allowed.
        expect(result.forbidden).toBeGreaterThan(0); // Overcapacity/ineligible assignments must be reached.
        gaps += recommendAndMeasure(problem, result.minimum);
        expect(problem).toEqual(before);
      }),
      { seed: 20260913, numRuns: 16 },
    );
    console.info('PV-SHIFT-01 bounded cases', { examined, allowed, denied, totalShortageGap: gaps });
    expect(examined).toBeGreaterThan(1000);
    expect(allowed).toBeGreaterThan(16);
    expect(denied).toBeGreaterThan(16);
    expect(gaps).toBeGreaterThanOrEqual(0);
  }, 30000);
  it('checks exact minute thresholds and independently rejects eligibility changes', () => {
    const check = (change: (p: ShiftProblem) => void, valid: boolean) => {
      const p = denseProblem();
      change(p);
      const rows = [{ employeeId: 'p0', slotId: 's0', locked: false }];
      expect(oracleFeasible(p, rows)).toBe(valid);
      expect(evaluateShift(p, rows).issues.length === 0).toBe(valid);
    };
    for (const [limit, valid] of [
      [240, true],
      [239, false],
    ] as const)
      check((p) => {
        const person = p.employees[0];
        if (!person?.profile) throw new Error('Expected profile');
        person.profile.maxDailyMinutes = limit;
        person.profile.maxWeeklyMinutes = limit;
        person.profile.targetMinutes = 0;
      }, valid);
    for (const [endMinute, valid] of [
      [1320, true],
      [1321, false],
    ] as const)
      check((p) => {
        p.existing = [{ employeeId: 'p0', date: '2026-09-13', startMinute: 780, endMinute, breakMinutes: 60 }];
      }, valid);
    for (const [endMinute, valid] of [
      [900, true],
      [901, false],
    ] as const)
      check((p) => {
        const slot = p.slots[0];
        if (!slot) throw new Error('Expected slot');
        slot.endMinute = endMinute;
      }, valid);
    check((p) => {
      p.leave = [{ employeeId: 'p0', date: p.weekStart, portion: 'morning', status: 'pending' }];
    }, false);
    check((p) => {
      p.availability = p.availability.filter((row) => row.employeeId !== 'p0');
    }, false);
    for (const change of [
      { active: false },
      { profile: null },
      { hiredOn: '2026-09-15' },
      { terminatedOn: '2026-09-13' },
    ])
      check((p) => {
        const person = p.employees[0];
        if (!person) throw new Error('Expected employee');
        Object.assign(person, change);
      }, false);
    check((p) => {
      p.existing = ['2026-09-12', '2026-09-13'].map((date) => ({
        employeeId: 'p0',
        date,
        startMinute: 540,
        endMinute: 780,
        breakMinutes: 0,
      }));
    }, false);
  });
  it('detects a feasible greedy result with a positive optimality gap without claiming every recommendation is optimal', () => {
    const problem = denseProblem();
    problem.slots = problem.slots.slice(0, 3).map((row, index) => ({ ...row, skill: ['a', 'b', 'c'][index] ?? 'a' }));
    problem.employees = problem.employees.map((row, index) => {
      if (!row.profile) throw new Error('Expected a complete profile');
      return {
        ...row,
        profile: {
          ...row.profile,
          skills: index === 0 ? ['a', 'b'] : index === 1 ? ['b', 'c'] : ['a', 'c'],
          maxDays: 1,
          targetMinutes: index === 0 ? 480 : 240,
        },
      };
    });
    const oracle = compare(problem);
    const greedy = recommendShift(problem, { seed: 20260913, iterations: 0 });
    expect(oracle.minimum).toBe(0);
    expect(oracleFeasible(problem, greedy.assignments)).toBe(true);
    expect(oracleShortage(problem, greedy.assignments) - oracle.minimum).toBe(1);
    expect(recommendAndMeasure(problem, oracle.minimum)).toBeLessThanOrEqual(1);
  });
  it('independently rejects invalid fixed work and unsupported oracle extensions', () => {
    const problem = denseProblem();
    const fixed = [{ employeeId: 'p1', slotId: 's0', locked: true }];
    expect(oracleFeasible(problem, fixed)).toBe(false);
    const result = recommendShift(problem, { seed: 7, assignments: fixed });
    expect(result.assignments).toEqual(fixed);
    expect(result.evaluation.issues.length).toBeGreaterThan(0);
    expect(result.iterations).toBe(0);
    expect(() =>
      oracleFeasible(
        {
          ...problem,
          periodBudgets: [
            { employeeId: 'p0', startsOn: problem.weekStart, endsOn: '2026-09-20', remainingMinutes: 480 },
          ],
        },
        [],
      ),
    ).toThrow(/ordinary/);
    expect(oracleFeasible(problem, [{ employeeId: 'unknown', slotId: 's0', locked: false }])).toBe(false);
    expect(oracleFeasible(problem, [...fixed, ...fixed])).toBe(false);
  });
});
