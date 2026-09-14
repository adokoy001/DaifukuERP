import { repo, StateError, ValidationError, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { correctionInput, correctionReviewInput } from '../contract.ts';
import { WorkforceAttendance, WorkforceAttendanceCorrection } from '../entities/index.ts';
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
} from '../common.ts';
import { internalWrite } from '../internal.ts';
import { assertBreaks, jstDate, measureWork, type BreakInterval } from '../services/time.ts';
import { workflowAction } from './define.ts';
import { assertNoFullLeave, assertNoWorkOverlap } from '../attendance-integrity.ts';

async function request(ctx: Context, input: z.infer<typeof correctionInput>) {
  const initial = await repo(ctx, WorkforceAttendance).get(input.attendanceId);
  return employeeLock(ctx, initial.employeeId, async () => {
    requireSelf(ctx, initial);
    const prior = await replay(ctx, WorkforceAttendanceCorrection, input.idempotencyKey, input);
    if (prior) return command(prior);
    const row = await repo(ctx, WorkforceAttendance).get(initial.id);
    expectVersion(row.version, input.expectedVersion);
    const employee = await activeEmployee(ctx, row.employeeId, row.workDate);
    await assertPayrollOpen(ctx, row.employeeId, row.workDate);
    if (await repo(ctx, WorkforceAttendanceCorrection).count({ attendanceId: row.id, status: 'pending' }))
      throw new StateError('A correction is already pending', 'Wait for its review.');
    const start = new Date(input.clockIn);
    const end = new Date(input.clockOut);
    if (jstDate(start) !== row.workDate || end > ctx.now())
      throw new ValidationError('Correction must keep the work date and use past times', [
        { path: 'clockIn', message: 'Use the original work date and actual completed times.' },
      ]);
    const policy = await policyOn(ctx, row.workDate);
    measureWork(start, end, input.breaks, policy.nightStartsMinute, policy.nightEndsMinute);
    return command(
      await internalWrite(ctx, WorkforceAttendanceCorrection, (write) =>
        repo(write, WorkforceAttendanceCorrection).create({
          ...identity(employee),
          attendanceId: row.id,
          workDate: row.workDate,
          sourceVersion: row.version,
          clockIn: start,
          clockOut: end,
          breaks: input.breaks,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          requestSnapshot: input,
        }),
      ),
    );
  });
}
async function review(ctx: Context, input: z.infer<typeof correctionReviewInput>) {
  const initial = await repo(ctx, WorkforceAttendanceCorrection).get(input.correctionId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const correction = await repo(ctx, WorkforceAttendanceCorrection).lock(initial.id);
    requireOther(ctx, correction);
    expectVersion(correction.version, input.expectedVersion);
    await activeEmployee(ctx, correction.employeeId, correction.workDate);
    await assertPayrollOpen(ctx, correction.employeeId, correction.workDate);
    if (correction.status !== 'pending')
      throw new StateError('Correction was already reviewed', 'Reload its current state.');
    if (input.decision === 'approve') {
      const row = await repo(ctx, WorkforceAttendance).lock(correction.attendanceId);
      expectVersion(row.version, correction.sourceVersion);
      const policy = await policyOn(ctx, row.workDate);
      const measured = measureWork(
        correction.clockIn,
        correction.clockOut,
        correction.breaks as BreakInterval[],
        policy.nightStartsMinute,
        policy.nightEndsMinute,
      );
      assertBreaks(measured, policy);
      await assertNoWorkOverlap(ctx, row.employeeId, row.id, correction.clockIn, correction.clockOut);
      if (row.status === 'approved')
        await assertNoFullLeave(
          ctx,
          row.employeeId,
          correction.clockIn,
          correction.clockOut,
          correction.breaks as BreakInterval[],
        );
      await internalWrite(ctx, WorkforceAttendance, (write) =>
        repo(write, WorkforceAttendance).update(
          row.id,
          {
            clockIn: correction.clockIn,
            clockOut: correction.clockOut,
            breakStartedAt: null,
            breaks: correction.breaks,
            workedMs: measured.workedMs,
            nightMs: measured.nightMs,
            status: row.status === 'approved' ? 'approved' : 'closed',
            ...reviewed(ctx, input.reason),
          },
          { expectedVersion: row.version },
        ),
      );
    }
    return command(
      await internalWrite(ctx, WorkforceAttendanceCorrection, (write) =>
        repo(write, WorkforceAttendanceCorrection).update(
          correction.id,
          { status: input.decision === 'approve' ? 'approved' : 'rejected', ...reviewed(ctx, input.reason) },
          { expectedVersion: correction.version },
        ),
      ),
    );
  });
}
export const requestCorrectionAction = workflowAction(
  'request_correction',
  '理由付きの勤怠訂正を申請',
  correctionInput,
  [E, M, H, P],
  request,
);
export const reviewCorrectionAction = workflowAction(
  'review_correction',
  '勤怠訂正を承認・却下',
  correctionReviewInput,
  [M, H],
  review,
);
