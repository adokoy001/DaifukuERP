import type { ShiftAssignment, ShiftEmployee, ShiftProblem, ShiftSlot } from '../src/scheduling/index.ts';
export const WEEK = '2026-09-14';
export const dateAt = (offset: number) => new Date(Date.UTC(2026, 8, 14 + offset)).toISOString().slice(0, 10);
export function employee(id = 'one'): ShiftEmployee {
  return { id, code: id, name: id, active: true, hiredOn: '2026-01-01', terminatedOn: null, profile: { employmentType: 'full_time', skills: ['service'], targetMinutes: 1200, maxWeeklyMinutes: 2400, maxDailyMinutes: 480, maxDays: 6, maxConsecutiveDays: 6, minRestMinutes: 660 } };
}
export function slot(id = 'morning', offset = 0): ShiftSlot {
  return { id, date: dateAt(offset), label: id, startMinute: 540, endMinute: 780, breakMinutes: 0, required: 1, skill: 'service' };
}
export function problem(employees = [employee()], slots = [slot()]): ShiftProblem {
  return { weekStart: WEEK, employees, slots, availability: employees.flatMap((e) => Array.from({ length: 7 }, (_, day) => ({ employeeId: e.id, date: dateAt(day), preference: 'preferred' as const, startMinute: 0, endMinute: 1440 }))), leave: [], existing: [], rules: Array.from({ length: 7 }, (_, day) => ({ date: dateAt(day), dailyLimitMinutes: 480, weeklyLimitMinutes: 2400, breakAfterMinutes: 360, breakMinutes: 45, longBreakAfterMinutes: 480, longBreakMinutes: 60 })) };
}
export const assignment = (slotId = 'morning', employeeId = 'one', locked = false): ShiftAssignment => ({ slotId, employeeId, locked });
export function benchmarkProblem(): ShiftProblem {
  const people = Array.from({ length: 100 }, (_, index) => employee(`employee-${index.toString().padStart(3, '0')}`));
  const slots = Array.from({ length: 42 }, (_, index) => ({ ...slot(`slot-${index}`, Math.floor(index / 6)), endMinute: 1080, breakMinutes: 60, required: 20 }));
  return problem(people, slots);
}
