import { runAction } from '@daifuku/kernel';
import type { MyShifts, ShiftBoard } from '../src/shift-contract.ts';
import type { ShiftProfile } from '../src/scheduling/index.ts';
import { addDays } from '../src/services/time.ts';
import { call, type Fixture } from './helpers.ts';
export const profile: ShiftProfile = {
  skills: ['service'],
  employmentType: 'part_time',
  targetMinutes: 1200,
  maxWeeklyMinutes: 2400,
  maxDailyMinutes: 480,
  maxDays: 6,
  maxConsecutiveDays: 6,
  minRestMinutes: 660,
};
export const availability = (weekStart: string) =>
  Array.from({ length: 7 }, (_, i) => ({
    date: addDays(weekStart, i),
    preference: 'preferred',
    startMinute: 0,
    endMinute: 1440,
  }));
export const slot = (date: string, id = 'morning', required = 1) => ({
  id,
  date,
  label: '午前勤務',
  startMinute: 540,
  endMinute: 780,
  breakMinutes: 0,
  required,
  skill: 'service',
});
export const assignment = (employeeId: string, slotId = 'morning') => ({ employeeId, slotId, locked: false });
export const board = (f: Fixture, weekStart: string) =>
  f.db.run(f.manager.params, (ctx) =>
    runAction(ctx, 'workforce.shift_board', { siteId: f.siteId, weekStart }),
  ) as Promise<ShiftBoard>;
export const mine = (f: Fixture, weekStart: string, person = f.alice) =>
  f.db.run(person.params, (ctx) => runAction(ctx, 'workforce.my_shifts', { weekStart })) as Promise<MyShifts>;
export async function conditions(f: Fixture) {
  for (const employeeId of [f.employee.id, f.otherEmployee.id])
    await call(f.db, f.manager.params, 'save_shift_profile', { employeeId, expectedVersion: 0, profile });
}
export async function ready(f: Fixture, weekStart: string) {
  for (const person of [f.alice, f.bob])
    await call(f.db, person.params, 'save_shift_availability', {
      weekStart,
      expectedVersion: 0,
      days: availability(weekStart),
    });
  return board(f, weekStart);
}
export async function draft(f: Fixture, weekStart: string, required = 1) {
  const source = await ready(f, weekStart);
  const row = await call(f.db, f.manager.params, 'save_shift_plan', {
    siteId: f.siteId,
    weekStart,
    expectedVersion: 0,
    sourceRevision: source.sourceRevision,
    slots: [slot(weekStart, 'morning', required)],
    assignments: [assignment(f.employee.id)],
  });
  return { ...row, sourceRevision: source.sourceRevision };
}
export const publish = (
  f: Fixture,
  row: { id: string; version: number; sourceRevision: string },
  acknowledgeShortage = false,
) =>
  call(f.db, f.manager.params, 'publish_shift_plan', {
    planId: row.id,
    expectedVersion: row.version,
    sourceRevision: row.sourceRevision,
    acknowledgeShortage,
    reason: '管理者による勤務枠と本人希望の確認',
  });

export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value is missing');
  return value;
}
