import { repo, StateError, ValidationError, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { saveShiftAvailabilityInput, saveShiftProfileInput } from '../shift-contract.ts';
import { WorkforceEmployee, WorkforceShiftAvailability, WorkforceShiftProfile, WorkforceSite } from '../entities/index.ts';
import { E, H, M, P } from '../entities/common.ts';
import { activeEmployee, command, employeeLock, expectVersion, identity, requireSelf, selfEmployee } from '../common.ts';
import { internalWrite } from '../internal.ts';
import { addDays } from '../services/time.ts';
import { workflowAction } from './define.ts';
async function profile(ctx: Context, input: z.infer<typeof saveShiftProfileInput>) {
  return employeeLock(ctx, input.employeeId, async () => {
    const employee = await repo(ctx, WorkforceEmployee).get(input.employeeId);
    if (!(await repo(ctx, WorkforceSite).get(employee.siteId)).active) throw new StateError('Work site is inactive', 'Choose an active site.');
    const current = (await repo(ctx, WorkforceShiftProfile).list({ where: { employeeId: employee.id }, limit: 1 })).items[0];
    expectVersion(current?.version ?? 0, input.expectedVersion);
    if (new Set(input.profile.skills).size !== input.profile.skills.length) throw new ValidationError('Skills must be unique', [{ path: 'profile.skills', message: 'Remove duplicate skills.' }]);
    return command(await internalWrite(ctx, WorkforceShiftProfile, (write) => current
      ? repo(write, WorkforceShiftProfile).update(current.id, { profile: input.profile }, { expectedVersion: current.version })
      : repo(write, WorkforceShiftProfile).create({ employeeId: employee.id, userId: employee.userId, profile: input.profile })));
  });
}
async function availability(ctx: Context, input: z.infer<typeof saveShiftAvailabilityInput>) {
  const initial = await selfEmployee(ctx);
  return employeeLock(ctx, initial.id, async () => {
    const currentEmployee = await repo(ctx, WorkforceEmployee).get(initial.id);
    const date = currentEmployee.hiredOn > input.weekStart ? currentEmployee.hiredOn : input.weekStart;
    if (date > addDays(input.weekStart, 6)) throw new StateError('勤務希望の週は雇用期間外です', '在籍する週を選択してください。');
    const employee = await activeEmployee(ctx, initial.id, date); requireSelf(ctx, employee);
    const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
    if (days.some((day, index) => day.date !== addDays(input.weekStart, index) || day.endMinute < day.startMinute || (day.preference !== 'unavailable' && day.endMinute <= day.startMinute))) throw new ValidationError('Enter exactly seven valid availability days', [{ path: 'days', message: 'Use each date of the selected week once and a positive daytime interval for available days.' }]);
    const current = (await repo(ctx, WorkforceShiftAvailability).list({ where: { employeeId: employee.id, weekStart: input.weekStart }, limit: 1 })).items[0];
    expectVersion(current?.version ?? 0, input.expectedVersion);
    return command(await internalWrite(ctx, WorkforceShiftAvailability, (write) => current
      ? repo(write, WorkforceShiftAvailability).update(current.id, { days }, { expectedVersion: current.version })
      : repo(write, WorkforceShiftAvailability).create({ ...identity(employee), weekStart: input.weekStart, days })));
  });
}
export const saveShiftProfileAction = workflowAction('save_shift_profile', '社員の勤務条件とスキルを保存', saveShiftProfileInput, [M, H], profile);
export const saveShiftAvailabilityAction = workflowAction('save_shift_availability', '自分の週間勤務希望を保存', saveShiftAvailabilityInput, [E, M, H, P], availability);
