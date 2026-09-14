// Reproducible synthetic benchmark; timing is reported, never used as a flaky correctness assertion.
import { evaluateShift, recommendShift } from '../src/scheduling/index.ts';
import { benchmarkProblem } from './shift-fixture.ts';
const problem = benchmarkProblem();
const started = performance.now();
const result = recommendShift(problem, { seed: 20260912 });
const durationMs = performance.now() - started;
const checked = evaluateShift(problem, result.assignments);
if (checked.issues.length) throw new Error('Benchmark produced an infeasible assignment');
console.warn(
  JSON.stringify({
    employees: problem.employees.length,
    slots: problem.slots.length,
    required: problem.slots.reduce((sum, slot) => sum + slot.required, 0),
    seed: result.seed,
    iterations: result.iterations,
    durationMs: Math.round(durationMs),
    assignments: result.assignments.length,
    shortage: checked.shortage,
    fairness: checked.fairness,
    issues: checked.issues.length,
  }),
);
