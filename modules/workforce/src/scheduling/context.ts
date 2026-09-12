import type { ShiftAssignment, ShiftDayRule, ShiftEmployee, ShiftExisting, ShiftIssue, ShiftProblem, ShiftSlot } from './types.ts';

export const MAX_EMPLOYEES = 100, MAX_SLOTS = 42, MAX_ASSIGNMENTS = 840;
export const DEFAULT_ITERATIONS = 1200, MAX_ITERATIONS = 10000;
const DAY = 86400000;
export const dayIndex = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY;
export const dateOf = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);
const integer = (value: number, min: number, max: number): boolean => Number.isSafeInteger(value) && value >= min && value <= max;
const date = (value: string): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayIndex(value)) && dateOf(dayIndex(value)) === value;
const text = (value: string, max = 100): boolean => typeof value === 'string' && value.length > 0 && value.length <= max;
export const keyOf = (employeeId: string, slotId: string): string => JSON.stringify([employeeId, slotId]);
export const workMinutes = (slot: Pick<ShiftSlot, 'startMinute' | 'endMinute' | 'breakMinutes'>): number => slot.endMinute - slot.startMinute - slot.breakMinutes;
export interface Timeline extends ShiftExisting { slotId?: string }
export interface Prepared {
  problem: ShiftProblem; start: number; employees: Map<string, ShiftEmployee>; slots: Map<string, ShiftSlot>;
  rules: Map<string, ShiftDayRule>; existing: Map<string, Timeline[]>;
  staticIssues: Map<string, ShiftIssue[]>; preferred: Set<string>;
}
function validInterval(row: { startMinute: number; endMinute: number; breakMinutes?: number }): boolean {
  return integer(row.startMinute, 0, 1439) && integer(row.endMinute, 1, 1440) && row.endMinute > row.startMinute && (row.breakMinutes === undefined || integer(row.breakMinutes, 0, row.endMinute - row.startMinute - 1));
}
function validEmployee(e: ShiftEmployee): boolean {
  if (!text(e.id) || !text(e.name, 200) || typeof e.code !== 'string' || typeof e.active !== 'boolean' || !date(e.hiredOn) || (e.terminatedOn !== null && (!date(e.terminatedOn) || e.terminatedOn < e.hiredOn))) return false;
  if (e.profile === null) return true;
  const p = e.profile;
  return !!p && Array.isArray(p.skills) && p.skills.length <= 30 && p.skills.every((s) => text(s, 80)) && ['full_time', 'part_time', 'contract'].includes(p.employmentType)
    && integer(p.maxDailyMinutes, 60, 480) && integer(p.maxWeeklyMinutes, 60, 2400) && integer(p.targetMinutes, 0, p.maxWeeklyMinutes)
    && integer(p.maxDays, 1, 6) && integer(p.maxConsecutiveDays, 1, 6) && integer(p.minRestMinutes, 0, 1440);
}
function validProblem(p: ShiftProblem): boolean {
  if (!p || !date(p.weekStart) || new Date(`${p.weekStart}T00:00:00Z`).getUTCDay() !== 1) return false;
  const lists = [p.employees, p.slots, p.availability, p.leave, p.existing, p.rules], bounds = [MAX_EMPLOYEES, MAX_SLOTS, 700, 1400, 2520, 7];
  if (lists.some((list, i) => !Array.isArray(list) || list.length > (bounds[i] ?? 0))) return false;
  if (lists.some((list) => list.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))) return false;
  const start = dayIndex(p.weekStart), inWeek = (value: string) => date(value) && dayIndex(value) >= start && dayIndex(value) < start + 7;
  if (!p.employees.every(validEmployee) || new Set(p.employees.map((e) => e.id)).size !== p.employees.length) return false;
  const ids = new Set(p.employees.map((e) => e.id));
  if (new Set(p.slots.map((s) => s.id)).size !== p.slots.length || !p.slots.every((s) => text(s.id) && inWeek(s.date) && validInterval(s) && integer(s.breakMinutes, 0, 1439) && integer(s.required, 1, 20) && typeof s.skill === 'string' && s.skill.length <= 80)) return false;
  if (new Set(p.availability.map((a) => keyOf(a.employeeId, a.date))).size !== p.availability.length || !p.availability.every((a) => ids.has(a.employeeId) && inWeek(a.date) && ['preferred', 'available', 'unavailable'].includes(a.preference) && (a.preference === 'unavailable' ? integer(a.startMinute, 0, 1440) && integer(a.endMinute, a.startMinute, 1440) : validInterval(a)))) return false;
  if (!p.leave.every((l) => ids.has(l.employeeId) && inWeek(l.date) && ['full', 'morning', 'afternoon'].includes(l.portion) && ['pending', 'approved'].includes(l.status))) return false;
  if (!p.existing.every((e) => ids.has(e.employeeId) && date(e.date) && dayIndex(e.date) >= start - 6 && dayIndex(e.date) <= start + 12 && validInterval(e) && integer(e.breakMinutes, 0, 1439))) return false;
  return p.rules.length === 7 && new Set(p.rules.map((r) => r.date)).size === 7 && p.rules.every((r) => inWeek(r.date) && integer(r.dailyLimitMinutes, 1, 480) && integer(r.weeklyLimitMinutes, 1, 2400) && integer(r.breakAfterMinutes, 0, 1440) && integer(r.breakMinutes, 0, 1440) && integer(r.longBreakAfterMinutes, r.breakAfterMinutes, 1440) && integer(r.longBreakMinutes, r.breakMinutes, 1440));
}
export function requiredBreak(rule: ShiftDayRule, minutes: number): number {
  return minutes > rule.longBreakAfterMinutes ? rule.longBreakMinutes : minutes > rule.breakAfterMinutes ? rule.breakMinutes : 0;
}
function staticIssues(ctx: Prepared, employee: ShiftEmployee, slot: ShiftSlot): ShiftIssue[] {
  const issues: ShiftIssue[] = [], add = (code: ShiftIssue['code']) => issues.push({ code, employeeId: employee.id, slotId: slot.id });
  if (!employee.active || slot.date < employee.hiredOn || (employee.terminatedOn !== null && slot.date > employee.terminatedOn)) add('inactive');
  if (!employee.profile) add('missing_profile');
  const availability = ctx.problem.availability.find((a) => a.employeeId === employee.id && a.date === slot.date);
  if (!availability) add('missing_availability');
  else if (availability.preference === 'unavailable' || availability.startMinute > slot.startMinute || availability.endMinute < slot.endMinute) add('unavailable');
  else if (availability.preference === 'preferred') ctx.preferred.add(keyOf(employee.id, slot.id));
  if (ctx.problem.leave.some((l) => l.employeeId === employee.id && l.date === slot.date)) add('leave');
  if (slot.skill && employee.profile && !employee.profile.skills.includes(slot.skill)) add('skill');
  const rule = ctx.rules.get(slot.date);
  if (rule && slot.breakMinutes < requiredBreak(rule, workMinutes(slot))) add('break');
  return issues;
}
export function prepare(problem: ShiftProblem): Prepared | null {
  if (!validProblem(problem)) return null;
  const ctx: Prepared = { problem, start: dayIndex(problem.weekStart), employees: new Map(problem.employees.map((e) => [e.id, e])), slots: new Map(problem.slots.map((s) => [s.id, s])), rules: new Map(problem.rules.map((r) => [r.date, r])), existing: new Map(), staticIssues: new Map(), preferred: new Set() };
  for (const row of problem.existing) { const rows = ctx.existing.get(row.employeeId) ?? []; rows.push({ ...row }); ctx.existing.set(row.employeeId, rows); }
  for (const employee of problem.employees) for (const slot of problem.slots) ctx.staticIssues.set(keyOf(employee.id, slot.id), staticIssues(ctx, employee, slot));
  return ctx;
}
export function validAssignments(assignments: ShiftAssignment[]): boolean {
  return Array.isArray(assignments) && assignments.length <= MAX_ASSIGNMENTS && assignments.every((a) => a && text(a.employeeId) && text(a.slotId) && typeof a.locked === 'boolean');
}
