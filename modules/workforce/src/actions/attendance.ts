import { repo, StateError, ValidationError, type Context, type Infer } from '@daifuku/kernel';
import type { z } from 'zod';
import { attendanceReviewInput, attendanceSubmitInput, punchInput } from '../contract.ts';
import { WorkforceAttendance, WorkforceAttendanceCorrection, WorkforcePunch } from '../entities/index.ts';
import { assertNoFullLeave, assertNoWorkOverlap } from '../attendance-integrity.ts';
import { E, H, M, P } from '../entities/common.ts';
import {
  activeEmployee,
  assertPayrollOpen,
  command,
  employeeLock,
  expectVersion,
  identity,
  policyOn,
  replay,
  requireOther,
  requireSelf,
  reviewed,
  selfEmployee,
} from '../common.ts';
import { internalWrite } from '../internal.ts';
import { assertBreaks, jstDate, measureWork, type BreakInterval } from '../services/time.ts';
import { workflowAction } from './define.ts';

async function punch(ctx: Context, input: z.infer<typeof punchInput>) {
  const self = await selfEmployee(ctx);
  return employeeLock(ctx, self.id, async () => {
    const employee = await activeEmployee(ctx, self.id);
    requireSelf(ctx, employee);
    const prior = await replay(ctx, WorkforcePunch, input.idempotencyKey, input);
    if (prior) return command(await repo(ctx, WorkforceAttendance).get(prior.attendanceId));
    const now = ctx.now();
    const today = jstDate(now);
    const open = (
      await repo(ctx, WorkforceAttendance).list({
        where: { employeeId: employee.id, status: { $in: ['working', 'break'] } },
        limit: 2,
      })
    ).items;
    if (open.length > 1)
      throw new StateError('Multiple open attendance records', 'HR must resolve the conflicting records.');
    let attendance;
    if (input.kind === 'clock_in') {
      expectVersion(0, input.expectedVersion);
      if (open.length || (await repo(ctx, WorkforceAttendance).count({ employeeId: employee.id, workDate: today })))
        throw new StateError(
          'Attendance already exists for this shift or date',
          'Open the existing attendance or request a correction.',
        );
      await assertPayrollOpen(ctx, employee.id, today);
      await policyOn(ctx, today);
      attendance = await internalWrite(ctx, WorkforceAttendance, (write) =>
        repo(write, WorkforceAttendance).create({ ...identity(employee), workDate: today, clockIn: now }),
      );
    } else {
      const current = open[0];
      if (!current) throw new StateError('No open shift', 'Clock in before taking a break or clocking out.');
      expectVersion(current.version, input.expectedVersion);
      await assertPayrollOpen(ctx, employee.id, current.workDate);
      attendance = await updatePunch(ctx, current, input.kind, now);
    }
    await internalWrite(ctx, WorkforcePunch, (write) =>
      repo(write, WorkforcePunch).create({
        ...identity(employee),
        attendanceId: attendance.id,
        kind: input.kind,
        at: now,
        idempotencyKey: input.idempotencyKey,
        requestSnapshot: input,
      }),
    );
    return command(attendance);
  });
}
async function updatePunch(
  ctx: Context,
  row: Infer<typeof WorkforceAttendance>,
  kind: 'break_start' | 'break_end' | 'clock_out',
  now: Date,
) {
  if (now.getTime() <= row.clockIn.getTime())
    throw new ValidationError('Punch time must advance', [{ path: 'at', message: 'A later server time is required.' }]);
  const breaks = row.breaks as BreakInterval[];
  if (kind === 'break_start') {
    if (row.status !== 'working' || row.breakStartedAt)
      throw new StateError('A break is already open', 'End the current break first.');
    const last = breaks[breaks.length - 1];
    if (last && now.getTime() <= new Date(last.end).getTime())
      throw new StateError('Punch time must advance', 'Try again after the previous punch time.');
    return internalWrite(ctx, WorkforceAttendance, (write) =>
      repo(write, WorkforceAttendance).update(
        row.id,
        { status: 'break', breakStartedAt: now },
        { expectedVersion: row.version },
      ),
    );
  }
  if (kind === 'break_end') {
    if (row.status !== 'break' || !row.breakStartedAt || now.getTime() <= row.breakStartedAt.getTime())
      throw new StateError('No valid open break', 'Start a break before ending it.');
    if (breaks.length >= 20)
      throw new StateError('Too many break intervals', 'Ask the manager to review the attendance.');
    return internalWrite(ctx, WorkforceAttendance, (write) =>
      repo(write, WorkforceAttendance).update(
        row.id,
        {
          status: 'working',
          breakStartedAt: null,
          breaks: [...breaks, { start: row.breakStartedAt?.toISOString(), end: now.toISOString() }],
        },
        { expectedVersion: row.version },
      ),
    );
  }
  if (row.status !== 'working' || row.breakStartedAt)
    throw new StateError('End the break before clocking out', 'Record the actual break end first.');
  const policy = await policyOn(ctx, row.workDate);
  const measured = measureWork(row.clockIn, now, breaks, policy.nightStartsMinute, policy.nightEndsMinute);
  return internalWrite(ctx, WorkforceAttendance, (write) =>
    repo(write, WorkforceAttendance).update(
      row.id,
      { status: 'closed', clockOut: now, workedMs: measured.workedMs, nightMs: measured.nightMs },
      { expectedVersion: row.version },
    ),
  );
}

async function submit(ctx: Context, input: z.infer<typeof attendanceSubmitInput>) {
  const initial = await repo(ctx, WorkforceAttendance).get(input.attendanceId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceAttendance).lock(initial.id);
    requireSelf(ctx, row);
    expectVersion(row.version, input.expectedVersion);
    await activeEmployee(ctx, row.employeeId, row.workDate);
    await assertPayrollOpen(ctx, row.employeeId, row.workDate);
    if (!['closed', 'returned'].includes(row.status) || !row.clockOut)
      throw new StateError(
        'Attendance is not ready for submission',
        'Clock out or complete the returned correction first.',
      );
    return command(
      await internalWrite(ctx, WorkforceAttendance, (write) =>
        repo(write, WorkforceAttendance).update(
          row.id,
          { status: 'submitted', reviewReason: null },
          { expectedVersion: row.version },
        ),
      ),
    );
  });
}
async function review(ctx: Context, input: z.infer<typeof attendanceReviewInput>) {
  const initial = await repo(ctx, WorkforceAttendance).get(input.attendanceId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceAttendance).lock(initial.id);
    requireOther(ctx, row);
    expectVersion(row.version, input.expectedVersion);
    await activeEmployee(ctx, row.employeeId, row.workDate);
    await assertPayrollOpen(ctx, row.employeeId, row.workDate);
    if (row.status !== 'submitted' || !row.clockOut)
      throw new StateError(
        'Only submitted attendance can be reviewed',
        'Ask the employee to submit the completed day.',
      );
    if (input.decision === 'approve') {
      if (await repo(ctx, WorkforceAttendanceCorrection).count({ attendanceId: row.id, status: 'pending' }))
        throw new StateError('A correction is pending', 'Review the correction before approving attendance.');
      await assertNoFullLeave(ctx, row.employeeId, row.clockIn, row.clockOut, row.breaks as BreakInterval[]);
      await assertNoWorkOverlap(ctx, row.employeeId, row.id, row.clockIn, row.clockOut);
      const policy = await policyOn(ctx, row.workDate);
      assertBreaks(
        measureWork(
          row.clockIn,
          row.clockOut,
          row.breaks as BreakInterval[],
          policy.nightStartsMinute,
          policy.nightEndsMinute,
        ),
        policy,
      );
    }
    return command(
      await internalWrite(ctx, WorkforceAttendance, (write) =>
        repo(write, WorkforceAttendance).update(
          row.id,
          {
            status: input.decision === 'approve' ? 'approved' : 'returned',
            dayKind: input.dayKind,
            ...reviewed(ctx, input.reason),
          },
          { expectedVersion: row.version },
        ),
      ),
    );
  });
}
export const punchAction = workflowAction('punch', '本人の出退勤・休憩を打刻', punchInput, [E, M, H, P], punch);
export const submitAttendanceAction = workflowAction(
  'submit_attendance',
  '本人の日次勤怠を提出',
  attendanceSubmitInput,
  [E, M, H, P],
  submit,
);
export const reviewAttendanceAction = workflowAction(
  'review_attendance',
  '提出勤怠を承認・差戻し',
  attendanceReviewInput,
  [M, H],
  review,
);
