import { Decimal, repo, StateError, ValidationError, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { leaveCancelInput, leaveGrantInput, leaveRequestInput, leaveReviewInput } from '../contract.ts';
import { WorkforceAttendance, WorkforceLeaveGrant, WorkforceLeaveRequest, WorkforceLeaveUsage } from '../entities/index.ts';
import { E, H, M, P } from '../entities/common.ts';
import { activeEmployee, allRows, assertPayrollOpen, command, D, employeeLock, expectVersion, identity, replay, requireOther, requireSelf, reviewed, selfEmployee, userId } from '../common.ts';
import { internalWrite } from '../internal.ts';
import { availableGrants, leaveBalance, leaveDays, usedForRequest } from '../leave-balance.ts';
import { workflowAction } from './define.ts';

async function grant(ctx: Context, input: z.infer<typeof leaveGrantInput>) {
  return employeeLock(ctx, input.employeeId, async () => {
    const employee = await activeEmployee(ctx, input.employeeId, input.validFrom);
    if (input.expiresOn < input.validFrom || D(input.days).lte(0)) throw new ValidationError('Invalid leave grant interval or days', [{ path: 'days', message: 'Use positive whole or half days with a valid expiry.' }]);
    const row = await internalWrite(ctx, WorkforceLeaveGrant, (write) => repo(write, WorkforceLeaveGrant).create({ ...identity(employee), ...input, grantedBy: userId(ctx) }));
    return { ...command(row), status: 'granted' };
  });
}
async function request(ctx: Context, input: z.infer<typeof leaveRequestInput>) {
  const self = await selfEmployee(ctx);
  return employeeLock(ctx, self.id, async () => {
    const employee = await activeEmployee(ctx, self.id, input.leaveDate); requireSelf(ctx, employee);
    const prior = await replay(ctx, WorkforceLeaveRequest, input.idempotencyKey, input); if (prior) return command(prior);
    await assertPayrollOpen(ctx, employee.id, input.leaveDate);
    const existing = await allRows(ctx, WorkforceLeaveRequest, { employeeId: employee.id, leaveDate: input.leaveDate, status: { $in: ['pending', 'approved'] } });
    if (existing.some((row) => row.portion === 'full' || input.portion === 'full' || row.portion === input.portion)) throw new StateError('Paid leave requests overlap', 'Withdraw or finish the existing request before applying again.');
    const days = leaveDays(input.portion);
    if ((await leaveBalance(ctx, employee.id, input.leaveDate)).lt(days)) throw new StateError('Insufficient paid leave for the requested date', 'Check grant eligibility and expiry with HR. Pending requests are checked again on approval.');
    return command(await internalWrite(ctx, WorkforceLeaveRequest, (write) => repo(write, WorkforceLeaveRequest).create({ ...identity(employee), leaveDate: input.leaveDate, portion: input.portion, days, reason: input.reason, idempotencyKey: input.idempotencyKey, requestSnapshot: input })));
  });
}
async function approveUsage(ctx: Context, row: Awaited<ReturnType<typeof loadRequest>>, halfDayAgreement: boolean) {
  if (row.portion !== 'full' && !halfDayAgreement) throw new ValidationError('Half-day leave requires employee request and employer agreement', [{ path: 'halfDayAgreement', message: 'Explicit agreement is required; hourly leave is unsupported.' }]);
  const approved = await allRows(ctx, WorkforceLeaveRequest, { employeeId: row.employeeId, leaveDate: row.leaveDate, status: 'approved' });
  const total = Decimal.sum(approved.map((other) => other.days)).plus(row.days);
  if (total.gt(1) || approved.some((other) => other.portion === row.portion || other.portion === 'full')) throw new StateError('Approved leave would overlap', 'Review existing approvals.');
  if (total.eq(1) && await repo(ctx, WorkforceAttendance).count({ employeeId: row.employeeId, workDate: row.leaveDate })) throw new StateError('Full-day leave conflicts with recorded attendance', 'Resolve the recorded attendance before approving a full day off.');
  const grants = await availableGrants(ctx, row.employeeId, row.leaveDate);
  if (Decimal.sum(grants.map((item) => item.available)).lt(row.days)) throw new StateError('Paid leave was consumed by another approval', 'Reload the remaining balance; no days were consumed for this request.');
  let remaining = row.days;
  for (const { grant, available } of grants) {
    if (remaining.isZero()) break;
    if (available.lte(0)) continue;
    const days = available.lt(remaining) ? available : remaining;
    await internalWrite(ctx, WorkforceLeaveUsage, (write) => repo(write, WorkforceLeaveUsage).create({ employeeId: row.employeeId, userId: row.userId, siteId: row.siteId, requestId: row.id, grantId: grant.id, days, kind: 'consume', at: ctx.now() }));
    remaining = remaining.minus(days);
  }
}
async function loadRequest(ctx: Context, id: string) { return repo(ctx, WorkforceLeaveRequest).get(id); }
async function review(ctx: Context, input: z.infer<typeof leaveReviewInput>) {
  const initial = await loadRequest(ctx, input.requestId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceLeaveRequest).lock(initial.id); requireOther(ctx, row); expectVersion(row.version, input.expectedVersion);
    await activeEmployee(ctx, row.employeeId, row.leaveDate); await assertPayrollOpen(ctx, row.employeeId, row.leaveDate);
    if (row.status !== 'pending') throw new StateError('Leave request was already reviewed', 'Reload its current status.');
    if (input.decision === 'approve') await approveUsage(ctx, row, input.halfDayAgreement);
    return command(await internalWrite(ctx, WorkforceLeaveRequest, (write) => repo(write, WorkforceLeaveRequest).update(row.id, { status: input.decision === 'approve' ? 'approved' : 'rejected', ...reviewed(ctx, input.reason) }, { expectedVersion: row.version })));
  });
}
async function cancel(ctx: Context, input: z.infer<typeof leaveCancelInput>) {
  const initial = await loadRequest(ctx, input.requestId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceLeaveRequest).lock(initial.id); requireSelf(ctx, row); expectVersion(row.version, input.expectedVersion);
    await assertPayrollOpen(ctx, row.employeeId, row.leaveDate);
    if (!['pending', 'approved'].includes(row.status)) throw new StateError('Leave request cannot be withdrawn in this state', 'Reload its current state.');
    for (const used of await usedForRequest(ctx, row.id)) await internalWrite(ctx, WorkforceLeaveUsage, (write) => repo(write, WorkforceLeaveUsage).create({ employeeId: row.employeeId, userId: row.userId, siteId: row.siteId, requestId: row.id, grantId: used.grantId, days: used.days.neg(), kind: 'release', at: ctx.now() }));
    return command(await internalWrite(ctx, WorkforceLeaveRequest, (write) => repo(write, WorkforceLeaveRequest).update(row.id, { status: 'cancelled', reviewReason: input.reason }, { expectedVersion: row.version })));
  });
}
export const grantLeaveAction = workflowAction('grant_leave', '資格確認済みの有給を付与', leaveGrantInput, [H], grant, false);
export const requestLeaveAction = workflowAction('request_leave', '本人の有給休暇を申請', leaveRequestInput, [E, M, H, P], request);
export const reviewLeaveAction = workflowAction('review_leave', '有給休暇を承認・却下', leaveReviewInput, [M, H], review);
export const cancelLeaveAction = workflowAction('cancel_leave', '本人の有給申請を取り下げ', leaveCancelInput, [E, M, H, P], cancel);
