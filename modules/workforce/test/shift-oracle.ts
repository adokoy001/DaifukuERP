// PV-SHIFT-01 / AC-5: test-only exhaustive oracle. Imports types, never production constraints.
// Scope: <=3 employees, <=4 slots, ordinary Monday weeks, valid input, same-day intervals.
// Not an oracle for variable/flex law, malformed wire data, permissions or transaction isolation.
import type { ShiftAssignment, ShiftEmployee, ShiftExisting, ShiftProblem } from '../src/scheduling/types.ts';
const dayNumber = (value: string) => Date.parse(value + 'T00:00:00Z') / 86400000;
const minutes = (row: { startMinute: number; endMinute: number; breakMinutes: number }) => row.endMinute - row.startMinute - row.breakMinutes;
function assertScope(problem: ShiftProblem): void {
  if (problem.employees.length > 3 || problem.slots.length > 4 || problem.workRules?.length || problem.periodBudgets?.length)
    throw new Error('Oracle supports only <=3 employees x4 slots with ordinary rules');
}
function employeeFeasible(problem: ShiftProblem, employee: ShiftEmployee, own: ShiftAssignment[]): boolean {
  if (!own.length) return true; // Historical violations unrelated to any new assignment are outside the claim.
  const profile = employee.profile;
  if (!profile || !employee.active) return false;
  const placed = own.map((row) => problem.slots.find((slot) => slot.id === row.slotId));
  if (placed.some((row) => row === undefined)) return false;
  const planned = placed.flatMap((row) => row ? [{ ...row, employeeId: employee.id, planned: true }] : []);
  for (const slot of planned) {
    if (slot.date < employee.hiredOn || (employee.terminatedOn !== null && slot.date > employee.terminatedOn)) return false;
    if (slot.skill && !profile.skills.includes(slot.skill)) return false;
    const availability = problem.availability.find((row) => row.employeeId === employee.id && row.date === slot.date);
    if (!availability || availability.preference === 'unavailable' || availability.startMinute > slot.startMinute || availability.endMinute < slot.endMinute) return false;
    if (problem.leave.some((row) => row.employeeId === employee.id && row.date === slot.date)) return false;
    const rule = problem.rules.find((row) => row.date === slot.date);
    if (!rule || slot.breakMinutes < breakRequired(rule, minutes(slot))) return false;
  }
  const rows = [...problem.existing.filter((row) => row.employeeId === employee.id).map((row) => ({ ...row, planned: false })), ...planned];
  for (let first = 0; first < rows.length; first++) for (let second = first + 1; second < rows.length; second++) {
    const a = rows[first], b = rows[second];
    if (!a || !b || (!a.planned && !b.planned)) continue;
    const aStart = dayNumber(a.date) * 1440 + a.startMinute, bStart = dayNumber(b.date) * 1440 + b.startMinute;
    const aEnd = dayNumber(a.date) * 1440 + a.endMinute, bEnd = dayNumber(b.date) * 1440 + b.endMinute;
    if (Math.max(aStart, bStart) < Math.min(aEnd, bEnd)) return false;
    if ((aStart <= bStart ? bStart - aEnd : aStart - bEnd) < profile.minRestMinutes) return false;
  }
  const weekRows = rows.filter((row) => row.date >= problem.weekStart && dayNumber(row.date) < dayNumber(problem.weekStart) + 7);
  if (weekRows.reduce((sum, row) => sum + minutes(row), 0) > Math.min(profile.maxWeeklyMinutes, ...problem.rules.map((row) => row.weeklyLimitMinutes))) return false;
  if (new Set(weekRows.map((row) => row.date)).size > profile.maxDays) return false;
  for (const rule of problem.rules) {
    const daily = weekRows.filter((row) => row.date === rule.date), work = daily.reduce((sum, row) => sum + minutes(row), 0);
    if (work > Math.min(profile.maxDailyMinutes, rule.dailyLimitMinutes)) return false;
    if (daily.reduce((sum, row) => sum + row.breakMinutes, 0) < breakRequired(rule, work)) return false;
  }
  return consecutiveFeasible(rows, profile.maxConsecutiveDays);
}
function breakRequired(rule: ShiftProblem['rules'][number], work: number): number {
  if (work > rule.longBreakAfterMinutes) return rule.longBreakMinutes;
  if (work > rule.breakAfterMinutes) return rule.breakMinutes;
  return 0;
}
function consecutiveFeasible(rows: (ShiftExisting & { planned: boolean })[], maximum: number): boolean {
  const dates = [...new Set(rows.map((row) => dayNumber(row.date)))];
  for (const start of dates) {
    const run = Array.from({ length: maximum + 1 }, (_, offset) => start + offset);
    if (run.every((day) => dates.includes(day)) && rows.some((row) => row.planned && run.includes(dayNumber(row.date)))) return false;
  }
  return true;
}
export function oracleFeasible(problem: ShiftProblem, assignments: ShiftAssignment[]): boolean {
  assertScope(problem);
  const keys = assignments.map((row) => JSON.stringify([row.employeeId, row.slotId]));
  if (new Set(keys).size !== keys.length) return false;
  if (assignments.some((row) => !problem.employees.some((employee) => employee.id === row.employeeId) || !problem.slots.some((slot) => slot.id === row.slotId))) return false;
  if (problem.slots.some((slot) => assignments.filter((row) => row.slotId === slot.id).length > slot.required)) return false;
  return problem.employees.every((employee) => employeeFeasible(problem, employee, assignments.filter((row) => row.employeeId === employee.id)));
}
export function oracleShortage(problem: ShiftProblem, assignments: ShiftAssignment[]): number {
  return problem.slots.reduce((sum, slot) => sum + Math.max(0, slot.required - assignments.filter((row) => row.slotId === slot.id).length), 0);
}
export function* enumerateAssignments(problem: ShiftProblem, fixed: ShiftAssignment[] = []): Generator<ShiftAssignment[]> {
  assertScope(problem);
  const decisions = problem.employees.flatMap((employee) => problem.slots.map((slot) => ({ employeeId: employee.id, slotId: slot.id, locked: fixed.some((row) => row.employeeId === employee.id && row.slotId === slot.id) })));
  for (let mask = 0; mask < 2 ** decisions.length; mask++) {
    const rows = decisions.filter((_, index) => (mask & (1 << index)) !== 0);
    if (fixed.every((row) => rows.some((candidate) => candidate.employeeId === row.employeeId && candidate.slotId === row.slotId))) yield rows;
  }
}
