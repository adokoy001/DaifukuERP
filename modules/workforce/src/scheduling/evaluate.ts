import { dayIndex, keyOf, prepare, validAssignments, workMinutes, type Prepared } from './context.ts';
import { assignmentRows, employeeIssues, hardIssues } from './rules.ts';
import type {
  ShiftAssignment,
  ShiftCoverage,
  ShiftEmployeeMetric,
  ShiftEvaluation,
  ShiftIssueCode,
  ShiftProblem,
} from './types.ts';

export function invalidEvaluation(): ShiftEvaluation {
  return {
    issues: [{ code: 'invalid_input' }],
    coverage: [],
    employees: [],
    shortage: 0,
    preferenceRate: 0,
    fairness: 0,
    score: 1000000000,
  };
}
export function employeeMetrics(ctx: Prepared, assignments: ShiftAssignment[]): ShiftEmployeeMetric[] {
  const rows = assignmentRows(ctx, assignments);
  return ctx.problem.employees.map((employee) => {
    let minutes = 0,
      preferred = 0,
      assigned = 0;
    const dates = new Set<string>();
    for (const row of ctx.existing.get(employee.id) ?? [])
      if (dayIndex(row.date) >= ctx.start && dayIndex(row.date) < ctx.start + 7) {
        minutes += workMinutes(row);
        dates.add(row.date);
      }
    for (const row of rows.get(employee.id) ?? []) {
      const slot = ctx.slots.get(row.slotId);
      if (!slot) continue;
      minutes += workMinutes(slot);
      dates.add(slot.date);
      assigned++;
      if (ctx.preferred.has(keyOf(employee.id, row.slotId))) preferred++;
    }
    return {
      employeeId: employee.id,
      minutes,
      targetMinutes: employee.profile?.targetMinutes ?? 0,
      days: dates.size,
      preferred,
      assignments: assigned,
    };
  });
}
export function softMetrics(ctx: Prepared, metrics: ShiftEmployeeMetric[]) {
  const eligible = metrics.filter((metric) =>
    ctx.problem.slots.some((slot) => ctx.staticIssues.get(keyOf(metric.employeeId, slot.id))?.length === 0),
  );
  const ratios = eligible.map((metric) => metric.minutes / Math.max(60, metric.targetMinutes));
  const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / Math.max(1, ratios.length);
  const fairness = Math.sqrt(ratios.reduce((sum, ratio) => sum + (ratio - mean) ** 2, 0) / Math.max(1, ratios.length));
  const preferred = metrics.reduce((sum, metric) => sum + metric.preferred, 0),
    count = metrics.reduce((sum, metric) => sum + metric.assignments, 0);
  const deviation =
    eligible.reduce(
      (sum, metric) => sum + ((metric.minutes - metric.targetMinutes) / Math.max(60, metric.targetMinutes)) ** 2,
      0,
    ) / Math.max(1, eligible.length);
  return {
    fairness,
    preferenceRate: count ? preferred / count : 0,
    penalty: Math.min(999999, Math.round((count - preferred) * 100 + deviation * 1000 + fairness * 1000)),
  };
}
function coverage(ctx: Prepared, assignments: ShiftAssignment[], exclusions: boolean): ShiftCoverage[] {
  const byEmployee = assignmentRows(ctx, assignments);
  return ctx.problem.slots.map((slot) => {
    const placed = assignments.filter((a) => a.slotId === slot.id),
      reasons: Partial<Record<ShiftIssueCode, number>> = {};
    if (exclusions)
      for (const employee of ctx.problem.employees) {
        if (placed.some((a) => a.employeeId === employee.id)) continue;
        const staticProblems = ctx.staticIssues.get(keyOf(employee.id, slot.id)) ?? [];
        const problems = staticProblems.length
          ? staticProblems
          : employeeIssues(ctx, employee.id, [
              ...(byEmployee.get(employee.id) ?? []),
              { slotId: slot.id, employeeId: employee.id, locked: false },
            ]);
        for (const code of new Set(problems.map((issue) => issue.code))) reasons[code] = (reasons[code] ?? 0) + 1;
      }
    return {
      slotId: slot.id,
      required: slot.required,
      assigned: placed.length,
      shortage: Math.max(0, slot.required - placed.length),
      exclusions: reasons,
    };
  });
}
export function evaluatePrepared(ctx: Prepared, assignments: ShiftAssignment[], exclusions = false): ShiftEvaluation {
  const issues = hardIssues(ctx, assignments),
    employees = employeeMetrics(ctx, assignments),
    covered = coverage(ctx, assignments, exclusions);
  const shortage = covered.reduce((sum, slot) => sum + slot.shortage, 0),
    soft = softMetrics(ctx, employees);
  return {
    issues,
    coverage: covered,
    employees,
    shortage,
    preferenceRate: soft.preferenceRate,
    fairness: soft.fairness,
    score: issues.length * 1000000000 + shortage * 1000000 + soft.penalty,
  };
}
export function evaluateShift(problem: ShiftProblem, assignments: ShiftAssignment[]): ShiftEvaluation {
  const ctx = prepare(problem);
  return ctx && validAssignments(assignments) ? evaluatePrepared(ctx, assignments, true) : invalidEvaluation();
}
