// Shared browser/backend wire contract. All dates/times and amounts are strings on the wire.
import { z } from 'zod';

export const WORKFORCE_ROLES = [
  'workforce_employee',
  'workforce_manager',
  'workforce_hr',
  'workforce_payroll',
] as const;
export const attendanceStatuses = ['working', 'break', 'closed', 'submitted', 'approved', 'returned'] as const;
export const requestStatuses = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const expenseStatuses = ['draft', 'submitted', 'approved', 'returned', 'settled', 'cancelled'] as const;
export const deductionKinds = [
  'income_tax',
  'resident_tax',
  'health_insurance',
  'nursing_insurance',
  'pension',
  'employment_insurance',
  'child_support',
  'other',
] as const;
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const version = z.number().int().min(1);
const reason = z.string().trim().min(1).max(1000);
const money = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const id = z.uuid();
export const commandResult = z.object({ id, version, status: z.string() });
export const punchInput = z
  .object({
    kind: z.enum(['clock_in', 'break_start', 'break_end', 'clock_out']),
    expectedVersion: z.number().int().min(0),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const attendanceSubmitInput = z.object({ attendanceId: id, expectedVersion: version }).strict();
export const attendanceReviewInput = z
  .object({
    attendanceId: id,
    expectedVersion: version,
    decision: z.enum(['approve', 'return']),
    dayKind: z.enum(['workday', 'statutory_holiday']),
    reason,
  })
  .strict();
export const breakSchema = z.object({ start: timestamp, end: timestamp }).strict();
export const correctionInput = z
  .object({
    attendanceId: id,
    expectedVersion: version,
    idempotencyKey: id,
    clockIn: timestamp,
    clockOut: timestamp,
    breaks: z.array(breakSchema).max(20),
    reason,
  })
  .strict();
export const correctionReviewInput = z
  .object({ correctionId: id, expectedVersion: version, decision: z.enum(['approve', 'reject']), reason })
  .strict();
export const employeeInput = z
  .object({
    userId: id,
    siteId: id,
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(100),
    hiredOn: date,
  })
  .strict();
export const leaveGrantInput = z
  .object({
    employeeId: id,
    validFrom: date,
    expiresOn: date,
    days: z.string().regex(/^\d+(?:\.5)?$/),
    eligibilityConfirmed: z.literal(true),
    basis: reason,
  })
  .strict();
export const leaveRequestInput = z
  .object({ idempotencyKey: id, leaveDate: date, portion: z.enum(['full', 'morning', 'afternoon']), reason })
  .strict();
export const leaveReviewInput = z
  .object({
    requestId: id,
    expectedVersion: version,
    decision: z.enum(['approve', 'reject']),
    reason,
    halfDayAgreement: z.boolean().default(false),
  })
  .strict();
export const leaveCancelInput = z.object({ requestId: id, expectedVersion: version, reason }).strict();
export const expenseSaveInput = z
  .object({
    expenseId: id.optional(),
    expectedVersion: z.number().int().min(0),
    idempotencyKey: id,
    expenseDate: date,
    category: z.string().trim().min(1).max(80),
    description: reason,
    amount: money,
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict();
export const expenseSubmitInput = z.object({ expenseId: id, expectedVersion: version }).strict();
export const expenseReviewInput = z
  .object({ expenseId: id, expectedVersion: version, decision: z.enum(['approve', 'return']), reason })
  .strict();
export const expenseSettleInput = z
  .object({ expenseId: id, expectedVersion: version, paidOn: date, reference: reason })
  .strict();
export const expenseCancelInput = z.object({ expenseId: id, expectedVersion: version, reason }).strict();
export const payrollCalculateInput = z
  .object({
    employeeId: id,
    period: month,
    expectedVersion: z.number().int().min(0).default(0),
    attendanceCompleteConfirmed: z.literal(true),
  })
  .strict();
export const deductionSchema = z
  .object({ kind: z.enum(deductionKinds), amount: money, basis: reason, confirmed: z.literal(true) })
  .strict();
export const allowanceSchema = z
  .object({ name: z.string().trim().min(1).max(100), amount: money, basis: reason })
  .strict();
export const payrollConfirmInput = z
  .object({
    payrollId: id,
    expectedVersion: version,
    deductions: z.array(deductionSchema).length(8),
    allowances: z.array(allowanceSchema).max(30),
    calculationConfirmed: z.literal(true),
    reason,
  })
  .strict();
export const payrollCancelInput = z.object({ payrollId: id, expectedVersion: version, reason }).strict();

export const employeeSummary = z.object({
  id,
  userId: id,
  siteId: id,
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  hiredOn: date,
  terminatedOn: date.nullable(),
  version,
});
export const attendanceSummary = z.object({
  id,
  employeeId: id,
  employeeName: z.string(),
  workDate: date,
  status: z.enum(attendanceStatuses),
  clockIn: timestamp,
  clockOut: timestamp.nullable(),
  breakStartedAt: timestamp.nullable(),
  breaks: z.array(breakSchema),
  workedMinutes: z.number(),
  nightMinutes: z.number(),
  dayKind: z.enum(['workday', 'statutory_holiday']),
  version,
});
export const correctionSummary = z.object({
  id,
  attendanceId: id,
  employeeId: id,
  employeeName: z.string(),
  workDate: date,
  status: z.enum(requestStatuses),
  clockIn: timestamp,
  clockOut: timestamp,
  breaks: z.array(breakSchema),
  reason: z.string(),
  reviewReason: z.string().nullable(),
  version,
});
export const leaveSummary = z.object({
  id,
  employeeId: id,
  employeeName: z.string(),
  leaveDate: date,
  portion: z.enum(['full', 'morning', 'afternoon']),
  days: z.string(),
  status: z.enum(requestStatuses),
  reason: z.string(),
  reviewReason: z.string().nullable(),
  version,
});
export const expenseSummary = z.object({
  id,
  employeeId: id,
  employeeName: z.string(),
  expenseDate: date,
  category: z.string(),
  description: z.string(),
  amount: z.string(),
  evidence: z.string(),
  status: z.enum(expenseStatuses),
  reviewReason: z.string().nullable(),
  paidOn: date.nullable(),
  paymentReference: z.string().nullable(),
  version,
});
export const payrollSummary = z.object({
  id,
  employeeId: id,
  employeeName: z.string(),
  period: month,
  status: z.enum(['draft', 'confirmed', 'cancelled']),
  number: z.string().nullable(),
  basePay: z.string(),
  premiumPay: z.string(),
  grossPay: z.string(),
  deductionTotal: z.string(),
  netPay: z.string(),
  workedMinutes: z.number(),
  paidLeaveDays: z.string(),
  deductions: z.array(deductionSchema),
  allowances: z.array(allowanceSchema),
  calculation: z.record(z.string(), z.unknown()),
  version,
});
export const myPortalInput = z.object({ period: month.optional() }).strict();
export const myPortalOutput = z.object({
  today: date,
  period: month,
  employee: employeeSummary.nullable(),
  attendance: attendanceSummary.nullable(),
  attendances: z.array(attendanceSummary),
  corrections: z.array(correctionSummary),
  leaveBalance: z.string(),
  leaveRequests: z.array(leaveSummary),
  expenses: z.array(expenseSummary),
  payrolls: z.array(payrollSummary),
});
export const managementPortalInput = z.object({ period: month.optional() }).strict();
export const managementPortalOutput = z.object({
  period: month,
  sites: z.array(z.object({ id, code: z.string(), name: z.string() })),
  users: z.array(z.object({ id, name: z.string(), email: z.string() })),
  employees: z.array(employeeSummary),
  attendances: z.array(attendanceSummary),
  corrections: z.array(correctionSummary),
  leaveRequests: z.array(leaveSummary),
  expenses: z.array(expenseSummary),
  payrolls: z.array(payrollSummary),
});
export type MyPortal = z.infer<typeof myPortalOutput>;
export type ManagementPortal = z.infer<typeof managementPortalOutput>;
export type EmployeeSummary = z.infer<typeof employeeSummary>;
export type AttendanceSummary = z.infer<typeof attendanceSummary>;
export type PayrollSummary = z.infer<typeof payrollSummary>;
