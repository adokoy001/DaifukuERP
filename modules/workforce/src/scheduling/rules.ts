import { dayIndex, keyOf, requiredBreak, workMinutes, type Prepared, type Timeline } from './context.ts';
import type { ShiftAssignment, ShiftEmployee, ShiftIssue } from './types.ts';

const uniqueIssues = (issues: ShiftIssue[]): ShiftIssue[] => [...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values()];
export function assignmentRows(ctx: Prepared, assignments: ShiftAssignment[]): Map<string, ShiftAssignment[]> {
  const result = new Map<string, ShiftAssignment[]>();
  for (const assignment of assignments) { const rows = result.get(assignment.employeeId) ?? []; rows.push(assignment); result.set(assignment.employeeId, rows); }
  return result;
}
function timeline(ctx: Prepared, employeeId: string, assignments: readonly ShiftAssignment[]): Timeline[] {
  const result = [...(ctx.existing.get(employeeId) ?? [])];
  for (const assignment of assignments) {
    const slot = ctx.slots.get(assignment.slotId);
    if (slot) result.push({ employeeId, date: slot.date, startMinute: slot.startMinute, endMinute: slot.endMinute, breakMinutes: slot.breakMinutes, slotId: slot.id });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}
function intervalIssues(rows: Timeline[], employee: ShiftEmployee): ShiftIssue[] {
  const result: ShiftIssue[] = [];
  let previous: Timeline | undefined, previousEnd = -Infinity;
  for (const row of rows) {
    const start = dayIndex(row.date) * 1440 + row.startMinute, end = dayIndex(row.date) * 1440 + row.endMinute;
    if (previous && (row.slotId !== undefined || previous.slotId !== undefined)) {
      const code = start < previousEnd ? 'overlap' : start - previousEnd < (employee.profile?.minRestMinutes ?? 0) ? 'rest' : null;
      if (code) result.push({ code, employeeId: employee.id, ...(row.slotId ? { slotId: row.slotId } : previous.slotId ? { slotId: previous.slotId } : {}) });
    }
    if (end > previousEnd) { previous = row; previousEnd = end; }
  }
  return result;
}
function calendarIssues(ctx: Prepared, rows: Timeline[], employee: ShiftEmployee): ShiftIssue[] {
  const profile = employee.profile;
  if (!profile) return [];
  const issues: ShiftIssue[] = [], add = (code: ShiftIssue['code']) => issues.push({ code, employeeId: employee.id });
  const dates = new Map<string, { minutes: number; breaks: number; assigned: boolean }>();
  for (const row of rows) {
    const current = dates.get(row.date) ?? { minutes: 0, breaks: 0, assigned: false };
    current.minutes += workMinutes(row); current.breaks += row.breakMinutes; current.assigned ||= row.slotId !== undefined; dates.set(row.date, current);
  }
  let minutes = 0, days = 0, consecutive = 0, last = -Infinity, runAssigned = false;
  for (const [date, value] of [...dates].sort(([a], [b]) => a.localeCompare(b))) {
    const index = dayIndex(date);
    if (index !== last + 1) { consecutive = 0; runAssigned = false; }
    consecutive++; runAssigned ||= value.assigned; last = index;
    if (consecutive > profile.maxConsecutiveDays && runAssigned) add('consecutive_limit');
    if (index < ctx.start || index >= ctx.start + 7) continue;
    minutes += value.minutes; days++;
    const rule = ctx.rules.get(date);
    if (rule && value.minutes > Math.min(profile.maxDailyMinutes, rule.dailyLimitMinutes)) add('daily_limit');
    if (rule && value.breaks < requiredBreak(rule, value.minutes)) add('break');
  }
  const weekly = Math.min(profile.maxWeeklyMinutes, ...ctx.problem.rules.map((rule) => rule.weeklyLimitMinutes));
  if (minutes > weekly) add('weekly_limit');
  if (days > profile.maxDays) add('days_limit');
  return issues;
}
export function employeeIssues(ctx: Prepared, employeeId: string, assignments: readonly ShiftAssignment[]): ShiftIssue[] {
  const employee = ctx.employees.get(employeeId);
  if (!employee) return [{ code: 'unknown_employee', employeeId }];
  if (!assignments.length) return [];
  const rows = timeline(ctx, employeeId, assignments);
  return uniqueIssues([...intervalIssues(rows, employee), ...calendarIssues(ctx, rows, employee)]);
}
export function canAddToEmployee(ctx: Prepared, assignment: ShiftAssignment, employeeRows: readonly ShiftAssignment[], slotCount: number): boolean {
  const slot = ctx.slots.get(assignment.slotId);
  if (!slot || !ctx.employees.has(assignment.employeeId) || (ctx.staticIssues.get(keyOf(assignment.employeeId, assignment.slotId))?.length ?? 1)) return false;
  if (employeeRows.some((a) => a.slotId === assignment.slotId) || slotCount >= slot.required) return false;
  return employeeIssues(ctx, assignment.employeeId, [...employeeRows, assignment]).length === 0;
}
export function canAdd(ctx: Prepared, assignment: ShiftAssignment, plan: ShiftAssignment[]): boolean {
  return canAddToEmployee(ctx, assignment, plan.filter((a) => a.employeeId === assignment.employeeId), plan.filter((a) => a.slotId === assignment.slotId).length);
}
export function hardIssues(ctx: Prepared, assignments: ShiftAssignment[]): ShiftIssue[] {
  const issues: ShiftIssue[] = [], seen = new Set<string>(), counts = new Map<string, number>();
  for (const assignment of assignments) {
    const key = keyOf(assignment.employeeId, assignment.slotId);
    if (!ctx.employees.has(assignment.employeeId)) issues.push({ code: 'unknown_employee', employeeId: assignment.employeeId, slotId: assignment.slotId });
    if (!ctx.slots.has(assignment.slotId)) issues.push({ code: 'unknown_slot', employeeId: assignment.employeeId, slotId: assignment.slotId });
    if (seen.has(key)) issues.push({ code: 'duplicate', employeeId: assignment.employeeId, slotId: assignment.slotId });
    seen.add(key); counts.set(assignment.slotId, (counts.get(assignment.slotId) ?? 0) + 1);
    issues.push(...(ctx.staticIssues.get(key) ?? []));
  }
  for (const [slotId, count] of counts) if (count > (ctx.slots.get(slotId)?.required ?? Infinity)) issues.push({ code: 'over_capacity', slotId });
  for (const [employeeId, rows] of assignmentRows(ctx, assignments)) issues.push(...employeeIssues(ctx, employeeId, rows));
  return uniqueIssues(issues);
}
