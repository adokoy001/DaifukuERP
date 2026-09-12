import { registry, repo, StateError, ValidationError, withLock, type Context, type HookArgs, type Infer } from '@daifuku/kernel';
import { WorkforceAttendance, WorkforceAttendanceCorrection, WorkforceEmployee, WorkforceExpense, WorkforceLeaveGrant, WorkforceLeaveRequest, WorkforcePayPolicy, WorkforcePayTerms, WorkforcePeriodLock, WorkforceSite } from './entities/index.ts';
import { allRows, D, employeeLock } from './common.ts';
import { stableJson } from './services/json.ts';

function invalid(path: string, message: string): never { throw new ValidationError(message, [{ path, message }]); }
function validInterval(row: { validFrom: string; validTo: string }): void { if (row.validTo < row.validFrom) invalid('validTo', 'Effective end must not precede its start.'); }
function frozenCoverageChanged(previous: { validFrom: string; validTo: string }, row: { validFrom: string; validTo: string }, start: string, end: string): boolean {
  const clip = (value: typeof row) => [value.validFrom > start ? value.validFrom : start, value.validTo < end ? value.validTo : end];
  return stableJson(clip(previous)) !== stableJson(clip(row));
}
function sourceChanged(previous: Record<string, unknown> | undefined, row: Record<string, unknown>, names: readonly string[]): boolean {
  return names.some((name) => stableJson(previous?.[name]) !== stableJson(row[name]));
}
async function policy(ctx: Context, args: HookArgs): Promise<void> {
  await withLock(ctx, 'workforce:policies', async () => {
    const row = args.row as unknown as Infer<typeof WorkforcePayPolicy>; validInterval(row);
    if (row.dailyLimitMinutes > 480 || row.weeklyLimitMinutes > 2400 || row.breakAfterMinutes > 360 || row.breakMinutes < 45 || row.longBreakAfterMinutes > 480 || row.longBreakMinutes < 60 || row.breakAfterMinutes > row.longBreakAfterMinutes || row.breakMinutes > row.longBreakMinutes) invalid('dailyLimitMinutes', 'Ordinary work and break limits must meet or exceed the Japanese minimum protection.');
    if (row.nightStartsMinute !== 1320 || row.nightEndsMinute !== 300 || row.monthlyOvertimeThresholdMinutes > 3600 || D(row.overtimePremiumRate).lt('0.25') || D(row.highOvertimePremiumRate).lt('0.50') || D(row.holidayPremiumRate).lt('0.35') || D(row.nightPremiumRate).lt('0.25') || D(row.highOvertimePremiumRate).lt(row.overtimePremiumRate)) invalid('overtimePremiumRate', 'Use verified ordinary premiums and the 22:00–05:00 night window.');
    if (await repo(ctx, WorkforcePayPolicy).count({ id: { $ne: row.id }, validFrom: { $lte: row.validTo }, validTo: { $gte: row.validFrom } })) invalid('validFrom', 'Working-time policy intervals cannot overlap.');
    if (args.previous) {
      const previous = args.previous as unknown as Infer<typeof WorkforcePayPolicy>;
      const start = row.validFrom < previous.validFrom ? row.validFrom : previous.validFrom, end = row.validTo > previous.validTo ? row.validTo : previous.validTo;
      const locks = await allRows(ctx, WorkforcePeriodLock, { active: true, periodStart: { $lte: end }, periodEnd: { $gte: start } });
      const changed = sourceChanged(args.previous, args.row, WorkforcePayPolicy.fieldNames.filter((name) => !['validFrom', 'validTo', 'name', 'code', 'basis'].includes(name)));
      if (locks.some((lock) => changed || frozenCoverageChanged(previous, row, lock.periodStart, lock.periodEnd))) throw new StateError('Policy is used by a confirmed payroll period', 'Preserve its confirmed source values and coverage; add a prospective policy after the frozen period.');
    }
  });
}
async function terms(ctx: Context, args: HookArgs): Promise<void> {
  const row = args.row as unknown as Infer<typeof WorkforcePayTerms>;
  await employeeLock(ctx, row.employeeId, async () => {
    validInterval(row);
    if ((row.payType === 'hourly' && (D(row.hourlyRate).lte(0) || !D(row.monthlySalary).eq(0))) || (row.payType === 'monthly' && (D(row.monthlySalary).lte(0) || !D(row.hourlyRate).eq(0)))) invalid('payType', 'Set a positive amount for the selected pay type and zero for the other.');
    const selected = await repo(ctx, WorkforcePayPolicy).get(row.policyId);
    if (selected.validFrom > row.validFrom || selected.validTo < row.validTo) invalid('policyId', 'The selected policy must cover the complete pay term interval.');
    if (await repo(ctx, WorkforcePayTerms).count({ employeeId: row.employeeId, id: { $ne: row.id }, validFrom: { $lte: row.validTo }, validTo: { $gte: row.validFrom } })) invalid('validFrom', 'Pay term intervals cannot overlap for the employee.');
    const previous = args.previous as unknown as Infer<typeof WorkforcePayTerms> | undefined;
    const start = previous && previous.validFrom < row.validFrom ? previous.validFrom : row.validFrom, end = previous && previous.validTo > row.validTo ? previous.validTo : row.validTo;
    const locks = await allRows(ctx, WorkforcePeriodLock, { employeeId: row.employeeId, active: true, periodStart: { $lte: end }, periodEnd: { $gte: start } });
    if (locks.some((lock) => !previous || sourceChanged(args.previous, args.row, WorkforcePayTerms.fieldNames.filter((name) => !['validFrom', 'validTo', 'basis'].includes(name))) || frozenCoverageChanged(previous, row, lock.periodStart, lock.periodEnd))) throw new StateError('Pay terms intersect a confirmed payroll period', 'Preserve confirmed source values and coverage; add a prospective pay condition after the frozen period.');
  });
}
async function employee(ctx: Context, args: HookArgs): Promise<void> {
  const row = args.row as unknown as Infer<typeof WorkforceEmployee>;
  await employeeLock(ctx, row.id, async () => {
    if (row.terminatedOn && row.terminatedOn < row.hiredOn) invalid('terminatedOn', 'Termination must not precede hire.');
    if (!(await repo(ctx, WorkforceSite).get(row.siteId)).active) invalid('siteId', 'Choose an active work site.');
    const previous = args.previous as unknown as Infer<typeof WorkforceEmployee> | undefined;
    if (!previous) return;
    if (previous.hiredOn !== row.hiredOn || previous.terminatedOn !== row.terminatedOn) {
      const locks = await allRows(ctx, WorkforcePeriodLock, { employeeId: row.id, active: true });
      if (locks.some((lock) => frozenCoverageChanged({ validFrom: previous.hiredOn, validTo: previous.terminatedOn ?? '9999-12-31' }, { validFrom: row.hiredOn, validTo: row.terminatedOn ?? '9999-12-31' }, lock.periodStart, lock.periodEnd))) throw new StateError('Employment dates are used by confirmed payroll', 'Preserve historical employment coverage; future termination dates may be recorded without cancelling historical payroll.');
      const attendance = await allRows(ctx, WorkforceAttendance, { employeeId: row.id });
      if (attendance.some((day) => day.workDate < row.hiredOn || (row.terminatedOn && day.workDate > row.terminatedOn))) invalid('hiredOn', 'Employment dates cannot exclude existing attendance.');
      const leave = await allRows(ctx, WorkforceLeaveRequest, { employeeId: row.id, status: { $in: ['pending', 'approved'] } });
      if (leave.some((day) => day.leaveDate < row.hiredOn || (row.terminatedOn && day.leaveDate > row.terminatedOn))) invalid('hiredOn', 'Employment dates cannot exclude pending or approved paid leave.');
    }
    if (previous.siteId !== row.siteId) await assertTransferPreservesHistory(ctx, row.id, row.siteId);
    if (previous.siteId !== row.siteId || (previous.active && !row.active)) await assertNoPending(ctx, row.id);
  });
}
/** Historical rows keep their original site. Reject a move until those balances and payslips can retain access. */
async function assertTransferPreservesHistory(ctx: Context, employeeId: string, siteId: string): Promise<void> {
  const scope = { employeeId, siteId: { $ne: siteId } };
  const grants = await repo(ctx, WorkforceLeaveGrant).count(scope);
  // HR may inspect this minimal projection without gaining access to any payroll amount.
  const published = await repo(ctx, WorkforcePeriodLock).count({ ...scope, active: true });
  if (grants || published) throw new StateError('有給台帳・確定給与明細を保全するため、この拠点変更はできません', '別拠点へ移すと本人や新拠点から既存履歴を参照できなくなります。履歴を維持する異動機能に対応するまでは現在の所属を保持してください。');
}
async function assertNoPending(ctx: Context, employeeId: string): Promise<void> {
  const pending = await repo(ctx, WorkforceAttendance).count({ employeeId, status: { $ne: 'approved' } })
    + await repo(ctx, WorkforceAttendanceCorrection).count({ employeeId, status: 'pending' })
    + await repo(ctx, WorkforceLeaveRequest).count({ employeeId, status: 'pending' })
    + await repo(ctx, WorkforceExpense).count({ employeeId, status: { $in: ['draft', 'returned', 'submitted', 'approved'] } });
  if (pending) throw new StateError('Employee has unfinished workforce records', 'Complete or cancel outstanding attendance, leave and expense workflows before transfer or deactivation.');
}
export function registerMasterGuards(): void {
  for (const phase of ['before_create', 'before_update'] as const) {
    registry.registerHook(WorkforcePayPolicy.name, phase, policy);
    registry.registerHook(WorkforcePayTerms.name, phase, terms);
    registry.registerHook(WorkforceEmployee.name, phase, employee);
  }
}
