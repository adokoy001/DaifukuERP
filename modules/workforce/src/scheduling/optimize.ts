// Pure, seeded and bounded shift recommendation for browser execution; this is a heuristic, not an optimality proof.
// Locked assignments are preserved; invalid locked input is reported, and search rejects hard-rule violations.
// Contract: docs/specs/employee-shift-planner.md; evidence: modules/workforce/test/shift-oracle.test.ts.
import {
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  keyOf,
  prepare,
  validAssignments,
  workMinutes,
  type Prepared,
} from './context.ts';
import { employeeMetrics, evaluatePrepared, invalidEvaluation } from './evaluate.ts';
import { assignmentRows, canAdd, canAddToEmployee, hardIssues } from './rules.ts';
import type { ShiftAssignment, ShiftOptimizeOptions, ShiftProblem, ShiftRecommendation } from './types.ts';

type Random = () => number;
type Candidates = Map<string, string[]>;
function randomOf(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function candidatesOf(ctx: Prepared): Candidates {
  return new Map(
    ctx.problem.slots.map((slot) => [
      slot.id,
      ctx.problem.employees
        .filter((employee) => ctx.staticIssues.get(keyOf(employee.id, slot.id))?.length === 0)
        .map((employee) => employee.id),
    ]),
  );
}
function greedy(ctx: Prepared, initial: ShiftAssignment[], candidates: Candidates, random: Random): ShiftAssignment[] {
  const plan = [...initial];
  const minutes = new Map(employeeMetrics(ctx, plan).map((metric) => [metric.employeeId, metric.minutes]));
  const byEmployee = assignmentRows(ctx, plan);
  const counts = new Map(ctx.problem.slots.map((slot) => [slot.id, plan.filter((a) => a.slotId === slot.id).length]));
  const slots = [...ctx.problem.slots].sort(
    (a, b) =>
      (candidates.get(a.id)?.length ?? 0) / a.required - (candidates.get(b.id)?.length ?? 0) / b.required ||
      a.date.localeCompare(b.date) ||
      a.startMinute - b.startMinute ||
      a.id.localeCompare(b.id),
  );
  for (const slot of slots)
    while ((counts.get(slot.id) ?? 0) < slot.required) {
      let best: ShiftAssignment | undefined;
      let cost = Infinity;
      for (const employeeId of candidates.get(slot.id) ?? []) {
        const assignment = { employeeId, slotId: slot.id, locked: false };
        if (!canAddToEmployee(ctx, assignment, byEmployee.get(employeeId) ?? [], counts.get(slot.id) ?? 0)) continue;
        const target = ctx.employees.get(employeeId)?.profile?.targetMinutes ?? 0;
        const before = minutes.get(employeeId) ?? 0;
        const after = before + workMinutes(slot);
        const denominator = Math.max(60, target);
        const delta =
          (((after - target) / denominator) ** 2 - ((before - target) / denominator) ** 2) * 1000 +
          (ctx.preferred.has(keyOf(employeeId, slot.id)) ? 0 : 100) +
          random() * 0.001;
        if (delta < cost) {
          cost = delta;
          best = assignment;
        }
      }
      if (!best) break;
      plan.push(best);
      minutes.set(best.employeeId, (minutes.get(best.employeeId) ?? 0) + workMinutes(slot));
      const rows = byEmployee.get(best.employeeId) ?? [];
      rows.push(best);
      byEmployee.set(best.employeeId, rows);
      counts.set(slot.id, (counts.get(slot.id) ?? 0) + 1);
    }
  return plan;
}
const pick = <T>(values: readonly T[], random: Random): T | undefined => values[Math.floor(random() * values.length)];
function replace(
  ctx: Prepared,
  plan: ShiftAssignment[],
  candidates: Candidates,
  random: Random,
): ShiftAssignment[] | null {
  const row = pick(
    plan.filter((a) => !a.locked),
    random,
  );
  if (!row) return null;
  const employeeId = pick(candidates.get(row.slotId) ?? [], random);
  if (!employeeId || employeeId === row.employeeId) return null;
  const next = plan.filter((a) => a !== row);
  const assignment = { ...row, employeeId };
  return canAdd(ctx, assignment, next) ? [...next, assignment] : null;
}
function swap(ctx: Prepared, plan: ShiftAssignment[], random: Random): ShiftAssignment[] | null {
  const movable = plan.filter((a) => !a.locked);
  const first = pick(movable, random);
  const second = pick(movable, random);
  if (!first || !second || first === second || first.employeeId === second.employeeId || first.slotId === second.slotId)
    return null;
  const next = plan.filter((a) => a !== first && a !== second);
  const a = { ...first, employeeId: second.employeeId };
  const b = { ...second, employeeId: first.employeeId };
  if (!canAdd(ctx, a, next)) return null;
  next.push(a);
  return canAdd(ctx, b, next) ? [...next, b] : null;
}
function fill(
  ctx: Prepared,
  plan: ShiftAssignment[],
  candidates: Candidates,
  random: Random,
): ShiftAssignment[] | null {
  const slot = pick(
    ctx.problem.slots.filter((s) => plan.filter((a) => a.slotId === s.id).length < s.required),
    random,
  );
  if (!slot) return null;
  const employeeId = pick(candidates.get(slot.id) ?? [], random);
  if (!employeeId) return null;
  const assignment = { employeeId, slotId: slot.id, locked: false };
  if (canAdd(ctx, assignment, plan)) return [...plan, assignment];
  const moved = pick(
    plan.filter((a) => a.employeeId === employeeId && !a.locked && a.slotId !== slot.id),
    random,
  );
  if (!moved) return null;
  const next = plan.filter((a) => a !== moved);
  if (!canAdd(ctx, assignment, next)) return null;
  next.push(assignment);
  for (let attempt = 0; attempt < 12; attempt++) {
    const replacement = pick(candidates.get(moved.slotId) ?? [], random);
    if (!replacement) break;
    const row = { employeeId: replacement, slotId: moved.slotId, locked: false };
    if (canAdd(ctx, row, next)) {
      next.push(row);
      break;
    }
  }
  return next;
}
function search(
  ctx: Prepared,
  initial: ShiftAssignment[],
  candidates: Candidates,
  random: Random,
  iterations: number,
): ShiftAssignment[] {
  let current = initial;
  let currentScore = evaluatePrepared(ctx, initial).score;
  let best = initial;
  let bestScore = currentScore;
  for (let index = 0; index < iterations; index++) {
    const move = Math.floor(random() * 3);
    const next =
      move === 0
        ? fill(ctx, current, candidates, random)
        : move === 1
          ? replace(ctx, current, candidates, random)
          : swap(ctx, current, random);
    if (!next) continue;
    const evaluation = evaluatePrepared(ctx, next);
    if (evaluation.issues.length) continue;
    const temperature = 200 * (1 - index / Math.max(1, iterations)) ** 2 + 0.5;
    if (evaluation.score <= currentScore || random() < Math.exp((currentScore - evaluation.score) / temperature)) {
      current = next;
      currentScore = evaluation.score;
    }
    if (currentScore < bestScore) {
      best = current;
      bestScore = currentScore;
    }
  }
  return best;
}
export function recommendShift(problem: ShiftProblem, options: ShiftOptimizeOptions): ShiftRecommendation {
  const seed = Number.isSafeInteger(options?.seed) ? options.seed >>> 0 : 0;
  const provided = options?.assignments ?? [];
  const ctx = prepare(problem);
  if (!ctx || !Number.isSafeInteger(options?.seed) || !validAssignments(provided))
    return { assignments: [], evaluation: invalidEvaluation(), iterations: 0, seed };
  const locked = provided.filter((assignment) => assignment.locked).map((assignment) => ({ ...assignment }));
  if (hardIssues(ctx, locked).length)
    return { assignments: locked, evaluation: evaluatePrepared(ctx, locked, true), iterations: 0, seed };
  const initial = [...locked];
  for (const row of provided) if (!row.locked && canAdd(ctx, row, initial)) initial.push({ ...row });
  const iterations = Number.isFinite(options.iterations ?? DEFAULT_ITERATIONS)
    ? Math.min(MAX_ITERATIONS, Math.max(0, Math.floor(options.iterations ?? DEFAULT_ITERATIONS)))
    : DEFAULT_ITERATIONS;
  const candidates = candidatesOf(ctx);
  const random = randomOf(seed);
  const filled = greedy(ctx, initial, candidates, random);
  const assignments = search(ctx, filled, candidates, random, iterations).sort(
    (a, b) =>
      ctx.problem.slots.findIndex((slot) => slot.id === a.slotId) -
        ctx.problem.slots.findIndex((slot) => slot.id === b.slotId) || a.employeeId.localeCompare(b.employeeId),
  );
  return { assignments, evaluation: evaluatePrepared(ctx, assignments, true), iterations, seed };
}
