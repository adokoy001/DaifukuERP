import { cancelDocument, repo, StateError, submitDocument, ValidationError, withLock, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { deductionKinds, payrollCalculateInput, payrollCancelInput, payrollConfirmInput } from '../contract.ts';
import { WorkforcePayroll, WorkforcePeriodLock } from '../entities/index.ts';
import { P } from '../entities/common.ts';
import { allRows, command, D, employeeLock, expectVersion, identity, requireOther, reviewed } from '../common.ts';
import { internalWrite } from '../internal.ts';
import { payrollSource } from '../payroll-source.ts';
import { jstDate } from '../services/time.ts';
import { workflowAction } from './define.ts';

async function calculate(ctx: Context, input: z.infer<typeof payrollCalculateInput>) {
  return withLock(ctx, 'workforce:policies', () => employeeLock(ctx, input.employeeId, async () => {
    const existing = await allRows(ctx, WorkforcePayroll, { employeeId: input.employeeId, period: input.period, docstatus: { $in: [0, 1] } });
    if (existing.length > 1 || existing.some((row) => row.docstatus === 1)) throw new StateError('Payroll is already finalized for this month', 'Cancel the confirmed payroll with its reason before recalculating.');
    const prior = existing[0]; expectVersion(prior?.version ?? 0, input.expectedVersion);
    const source = await payrollSource(ctx, input.employeeId, input.period);
    if (source.bounds.end >= jstDate(ctx.now())) throw new StateError('Payroll month is not complete', 'Calculate after the last calendar day of the month has ended.');
    if (source.result.workedMs > 2147483647) throw new StateError('Monthly attendance exceeds the supported calculation range', 'Review unusually long attendance with payroll headquarters.');
    const firstTerm = source.terms[0];
    if (!firstTerm) throw new StateError('Pay terms are missing', 'Confirm wage conditions first.');
    const values = { termsId: firstTerm.id, basePay: source.result.basePay, premiumPay: source.result.premiumPay, grossPay: source.result.grossPay, workedMs: source.result.workedMs, paidLeaveDays: source.result.paidLeaveDays, calculation: source.calculation, sourceFingerprint: source.fingerprint, deductions: [], allowances: [], deductionTotal: D(0), netPay: D(0), calculationConfirmed: false, reviewReason: null, reviewedAt: null, reviewedBy: null };
    return internalWrite(ctx, WorkforcePayroll, async (write) => command(prior
      ? await repo(write, WorkforcePayroll).update(prior.id, values, { expectedVersion: prior.version })
      : await repo(write, WorkforcePayroll).create({ ...identity(source.employee), period: input.period, periodStart: source.bounds.start, periodEnd: source.bounds.end, attendanceCompleteConfirmed: true, ...values })));
  }));
}
function wholeYen(amount: string): void {
  if (!D(amount).eq(D(amount).roundDown(0))) throw new ValidationError('External payroll amounts must be whole JPY', [{ path: 'amount', message: 'Enter a nonnegative whole-yen amount, including explicit zero.' }]);
}
async function confirm(ctx: Context, input: z.infer<typeof payrollConfirmInput>) {
  const initial = await repo(ctx, WorkforcePayroll).get(input.payrollId);
  return withLock(ctx, 'workforce:policies', () => employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforcePayroll).lock(initial.id); requireOther(ctx, row); expectVersion(row.version, input.expectedVersion);
    if (row.docstatus !== 0) throw new StateError('Only draft payroll can be confirmed', 'Reload the current payroll.');
    if (new Set(input.deductions.map((item) => item.kind)).size !== deductionKinds.length) throw new ValidationError('Every deduction must be confirmed exactly once', [{ path: 'deductions', message: 'Confirm all eight named deductions, including zero amounts with their basis.' }]);
    for (const item of [...input.deductions, ...input.allowances]) wholeYen(item.amount);
    const source = await payrollSource(ctx, row.employeeId, row.period);
    if (source.fingerprint !== row.sourceFingerprint) throw new StateError('Payroll source changed after calculation', 'Recalculate the draft and confirm the updated attendance, terms, and deductions.');
    if (await repo(ctx, WorkforcePayroll).count({ employeeId: row.employeeId, period: row.period, docstatus: 1 })) throw new StateError('Payroll month is already closed', 'Review the existing confirmed payroll.');
    const grossPay = row.basePay.plus(row.premiumPay).plus(input.allowances.reduce((sum, item) => sum.plus(item.amount), D(0)));
    const deductionTotal = input.deductions.reduce((sum, item) => sum.plus(item.amount), D(0)), netPay = grossPay.minus(deductionTotal);
    if (netPay.lt(0)) throw new ValidationError('Deductions exceed gross pay', [{ path: 'deductions', message: 'Review the explicit deductions and allowances; negative net pay is unsupported.' }]);
    const confirmed = await internalWrite(ctx, WorkforcePayroll, async (write) => {
      const updated = await repo(write, WorkforcePayroll).update(row.id, { grossPay, deductionTotal, netPay, deductions: input.deductions, allowances: input.allowances, calculationConfirmed: true, ...reviewed(ctx, input.reason) }, { expectedVersion: row.version });
      return submitDocument(write, WorkforcePayroll, row.id, { expectedVersion: updated.version });
    });
    await internalWrite(ctx, WorkforcePeriodLock, (write) => repo(write, WorkforcePeriodLock).create({ employeeId: row.employeeId, userId: row.userId, siteId: row.siteId, payrollId: row.id, periodStart: source.boundary, periodEnd: row.periodEnd }));
    return command(confirmed);
  }));
}
async function cancel(ctx: Context, input: z.infer<typeof payrollCancelInput>) {
  const initial = await repo(ctx, WorkforcePayroll).get(input.payrollId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforcePayroll).lock(initial.id); requireOther(ctx, row); expectVersion(row.version, input.expectedVersion);
    if (row.docstatus !== 1) throw new StateError('Only confirmed payroll can be cancelled', 'Reload the confirmed payroll.');
    const cancelled = await internalWrite(ctx, WorkforcePayroll, async (write) => {
      const updated = await repo(write, WorkforcePayroll).update(row.id, reviewed(ctx, input.reason), { expectedVersion: row.version });
      return cancelDocument(write, WorkforcePayroll, row.id, { expectedVersion: updated.version });
    });
    const locks = await allRows(ctx, WorkforcePeriodLock, { payrollId: row.id, active: true });
    for (const lock of locks) await internalWrite(ctx, WorkforcePeriodLock, (write) => repo(write, WorkforcePeriodLock).update(lock.id, { active: false }, { expectedVersion: lock.version }));
    return command(cancelled);
  });
}
export const calculatePayrollAction = workflowAction('calculate_payroll', '承認勤怠と確認済み賃金条件から給与を計算', payrollCalculateInput, [P], calculate, false);
export const confirmPayrollAction = workflowAction('confirm_payroll', '全控除・手当の根拠を確認して給与を確定', payrollConfirmInput, [P], confirm, false);
export const cancelPayrollAction = workflowAction('cancel_payroll', '理由を記録して確定給与を取り消す', payrollCancelInput, [P], cancel, false);
