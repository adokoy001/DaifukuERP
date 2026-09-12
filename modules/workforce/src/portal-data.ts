import { can, type Context, type Domain, type EntityDef } from '@daifuku/kernel';
import { allRows } from './common.ts';
import * as E from './entities/index.ts';
import { minutesDisplay, periodBounds } from './services/time.ts';
import type { ManagementPortal } from './contract.ts';

export async function portalData(ctx: Context, period: string, employeeId?: string) {
  const bounds = periodBounds(period), scope = employeeId ? { employeeId } : {};
  const within = (field: string): Domain => ({ ...scope, $and: [{ [field]: { $gte: bounds.start } }, { [field]: { $lte: bounds.end } }] });
  const readable = <T extends EntityDef>(entity: T, where: Domain) => can(ctx, entity, 'read') ? allRows(ctx, entity, where) : Promise.resolve([]);
  const employees = await readable(E.WorkforceEmployee, employeeId ? { id: employeeId } : {});
  const name = (row: { employeeId: string }) => employees.find((employee) => employee.id === row.employeeId)?.name ?? '異動前の従業員';
  const attendance = await readable(E.WorkforceAttendance, within('workDate'));
  const corrections = await readable(E.WorkforceAttendanceCorrection, within('workDate'));
  const leaves = await readable(E.WorkforceLeaveRequest, within('leaveDate'));
  const expenses = await readable(E.WorkforceExpense, within('expenseDate'));
  const payrolls = await readable(E.WorkforcePayroll, { ...scope, period });
  return {
    employees: employees.map(({ id, userId, siteId, code, name, active, version }) => ({ id, userId, siteId, code, name, active, version })),
    attendances: attendance.map((row) => ({ ...row, employeeName: name(row), clockIn: row.clockIn.toISOString(), clockOut: row.clockOut?.toISOString() ?? null, breakStartedAt: row.breakStartedAt?.toISOString() ?? null, workedMinutes: minutesDisplay(row.workedMs), nightMinutes: minutesDisplay(row.nightMs) })),
    corrections: corrections.map((row) => ({ ...row, employeeName: name(row), clockIn: row.clockIn.toISOString(), clockOut: row.clockOut.toISOString() })),
    leaveRequests: leaves.map((row) => ({ ...row, employeeName: name(row), days: row.days.toString() })),
    expenses: expenses.map((row) => ({ ...row, employeeName: name(row), amount: row.amount.toString() })),
    payrolls: payrolls.map((row) => ({ ...row, employeeName: name(row), status: row.docstatus === 1 ? 'confirmed' : row.docstatus === 2 ? 'cancelled' : 'draft', basePay: row.basePay.toString(), premiumPay: row.premiumPay.toString(), grossPay: row.grossPay.toString(), deductionTotal: row.deductionTotal.toString(), netPay: row.netPay.toString(), paidLeaveDays: row.paidLeaveDays.toString(), workedMinutes: minutesDisplay(row.workedMs) })) as ManagementPortal['payrolls'],
  };
}
