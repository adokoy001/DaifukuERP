import { getCompany, repo, StateError, type Context, type Infer } from '@daifuku/kernel';
import { WorkforceAttendance, WorkforceAttendanceCorrection, WorkforceEmployee, WorkforceLeaveRequest, WorkforcePayPolicy, WorkforcePayTerms } from './entities/index.ts';
import { allRows, D } from './common.ts';
import { calculatePay, type PayDay } from './services/pay-calculation.ts';
import { stableJson } from './services/json.ts';
import { assertBreaks, assertPayrollCalendarDay, measureWork, periodBounds, weekStart, type BreakInterval } from './services/time.ts';

export async function payrollSource(ctx: Context, employeeId: string, period: string) {
  if ((await getCompany(ctx)).currency !== 'JPY') throw new StateError('Workforce payroll supports JPY only', 'Use a separately verified payroll calculation for other currencies.');
  const employee = await repo(ctx, WorkforceEmployee).get(employeeId), bounds = periodBounds(period);
  const employmentStart = employee.hiredOn > bounds.start ? employee.hiredOn : bounds.start;
  const employmentEnd = employee.terminatedOn && employee.terminatedOn < bounds.end ? employee.terminatedOn : bounds.end;
  if (employmentStart > employmentEnd) throw new StateError('Employee was not employed in this payroll month', 'Choose an employment period.');
  const terms = await allRows(ctx, WorkforcePayTerms, { employeeId, validFrom: { $lte: employmentEnd }, validTo: { $gte: employmentStart } }, [{ field: 'validFrom' }, { field: 'id' }]);
  if (!terms.length || terms.some((term) => !term.confirmed)) throw new StateError('Confirmed wage conditions are missing', 'Payroll headquarters must explicitly confirm effective pay terms.');
  const policies = await allRows(ctx, WorkforcePayPolicy, {}, [{ field: 'validFrom' }]);
  const firstPolicy = policyFor(policies, employmentStart), boundary = weekStart(employmentStart, firstPolicy.weekStartsOn);
  const attendance = await allRows(ctx, WorkforceAttendance, { employeeId, $and: [{ workDate: { $gte: boundary } }, { workDate: { $lte: bounds.end } }] }, [{ field: 'workDate' }]);
  const leaves = await allRows(ctx, WorkforceLeaveRequest, { employeeId, $and: [{ leaveDate: { $gte: employmentStart } }, { leaveDate: { $lte: employmentEnd } }] });
  const corrections = await allRows(ctx, WorkforceAttendanceCorrection, { employeeId, $and: [{ workDate: { $gte: boundary } }, { workDate: { $lte: bounds.end } }], status: 'pending' });
  if (attendance.some((row) => row.status !== 'approved' || !row.clockOut) || leaves.some((row) => row.status === 'pending') || corrections.length) throw new StateError('Unapproved attendance, leave, or corrections remain', 'Complete reviews for the month and its boundary week before payroll calculation.');
  const days: PayDay[] = attendance.map((row) => measuredDay(row, policies));
  const approvedLeaves = leaves.filter((row) => row.status === 'approved');
  for (const row of approvedLeaves) {
    const total = approvedLeaves.filter((other) => other.leaveDate === row.leaveDate).reduce((sum, other) => sum.plus(other.days), D(0));
    if (total.gt(1) || (total.eq(1) && days.some((day) => day.date === row.leaveDate && day.workedMs > 0))) throw new StateError('Paid leave overlaps actual work', 'Resolve the leave and attendance before calculating payroll.');
  }
  for (const term of terms) if (!policies.some((policy) => policy.id === term.policyId && policy.validFrom <= term.validFrom && policy.validTo >= term.validTo)) throw new StateError('Wage terms are not covered by their selected policy', 'Choose an effective policy covering the full term interval.');
  const result = calculatePay({ period, employmentStart, employmentEnd, terms, days, leaves: approvedLeaves.map((row) => ({ date: row.leaveDate, days: row.days })) });
  const evidence = { employee, terms, policies: policies.filter((policy) => policy.validFrom <= bounds.end && policy.validTo >= boundary), attendance, leaveRequests: approvedLeaves };
  return { employee, bounds, boundary, terms, result, fingerprint: stableJson(evidence), calculation: { version: 1, period, employmentStart, employmentEnd, dependencyStart: boundary, ...result, ...evidence } };
}
function policyFor(policies: Infer<typeof WorkforcePayPolicy>[], date: string) {
  const selected = policies.filter((policy) => policy.validFrom <= date && policy.validTo >= date);
  if (selected.length !== 1) throw new StateError('A unique working-time policy is missing', `Configure one valid ordinary policy for ${date}.`);
  return selected[0] as Infer<typeof WorkforcePayPolicy>;
}
function measuredDay(row: Infer<typeof WorkforceAttendance>, policies: Infer<typeof WorkforcePayPolicy>[]): PayDay {
  const policy = policyFor(policies, row.workDate);
  if (!row.clockOut) throw new StateError('Attendance is not complete', 'Record the actual clock-out time.');
  assertPayrollCalendarDay(row.clockIn, row.clockOut);
  const measured = measureWork(row.clockIn, row.clockOut, row.breaks as BreakInterval[], policy.nightStartsMinute, policy.nightEndsMinute);
  assertBreaks(measured, policy);
  return { date: row.workDate, workedMs: measured.workedMs, nightMs: measured.nightMs, dayKind: row.dayKind, policy };
}
