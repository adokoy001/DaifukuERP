import { newId, PermissionDenied, repo, runAction, ValidationError } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deductionKinds } from '../src/contract.ts';
import { WorkforceAttendance, WorkforcePayPolicy, WorkforcePayTerms, WorkforcePayroll } from '../src/index.ts';
import { call, fixture, type Fixture } from './helpers.ts';
let f: Fixture;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.db.close(); });
describe('workforce role composition and mutable masters', () => {
  it('permits manager, HR and payroll self-service but forbids their self-approval', async () => {
    for (const [index, person] of [f.manager, f.hr, f.payroll].entries()) {
      const employee = await call(f.db, f.hr.params, 'register_employee', { userId: person.id, siteId: f.siteId, code: `SELF-${index}`, name: `Self ${index}`, hiredOn: '2026-01-01' });
      const punch = await call(f.db, person.params, 'punch', { kind: 'clock_in', expectedVersion: 0, idempotencyKey: newId() }, '2026-08-10T09:00:00+09:00');
      const closed = await call(f.db, person.params, 'punch', { kind: 'clock_out', expectedVersion: punch.version, idempotencyKey: newId() }, '2026-08-10T10:00:00+09:00');
      const submitted = await call(f.db, person.params, 'submit_attendance', { attendanceId: punch.id, expectedVersion: closed.version });
      await expect(call(f.db, person.params, 'review_attendance', { attendanceId: punch.id, expectedVersion: submitted.version, decision: 'approve', dayKind: 'workday', reason: '自分で確認' })).rejects.toBeInstanceOf(PermissionDenied);
      await call(f.db, {}, 'review_attendance', { attendanceId: punch.id, expectedVersion: submitted.version, decision: 'approve', dayKind: 'workday', reason: '別人による確認' });
      await f.db.run(f.payroll.params, async (ctx) => {
        const policy = (await repo(ctx, WorkforcePayPolicy).list()).items[0];
        if (!policy) throw new Error('Missing policy');
        await repo(ctx, WorkforcePayTerms).create({ employeeId: employee.id, policyId: policy.id, validFrom: '2026-01-01', validTo: '2026-12-31', payType: 'hourly', hourlyRate: '1200', monthlySalary: '0', monthlyBaseMinutes: 9600, paidLeaveDayMinutes: 480, confirmed: true, basis: '確認済み' });
      });
      const payroll = await call(f.db, f.payroll.params, 'calculate_payroll', { employeeId: employee.id, period: '2026-08', attendanceCompleteConfirmed: true });
      const input = { payrollId: payroll.id, expectedVersion: payroll.version, deductions: deductionKinds.map((kind) => ({ kind, amount: '0', basis: '外部確認済みのゼロ', confirmed: true })), allowances: [], calculationConfirmed: true, reason: '独立確認' };
      await expect(call(f.db, person.params, 'confirm_payroll', input)).rejects.toBeInstanceOf(PermissionDenied);
      await call(f.db, {}, 'confirm_payroll', input);
      const portal = await f.db.run(person.params, (ctx) => runAction(ctx, 'workforce.my_portal', { period: '2026-08' })) as { payrolls: { employeeId: string }[] };
      expect(portal.payrolls.map((row) => row.employeeId)).toEqual([employee.id]);
      const expense = await call(f.db, person.params, 'save_expense', { idempotencyKey: newId(), expectedVersion: 0, expenseDate: '2026-09-01', category: '交通費', description: '本人利用', amount: '100', evidence: '領収書保管' });
      expect(expense.status).toBe('draft');
    }
    expect(await f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforcePayroll).count())).toBe(1);
    expect(await f.db.run({ ...f.manager.params, roles: ['workforce_manager', 'workforce_employee'] }, (ctx) => repo(ctx, WorkforcePayroll).count())).toBe(1);
    expect(await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayroll).count())).toBe(1);
  });
  it('rejects weakened policies and serializes overlapping terms', async () => {
    const policy = await f.db.run({}, async (ctx) => (await repo(ctx, WorkforcePayPolicy).list()).items[0]);
    if (!policy) throw new Error('Missing policy');
    await expect(f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayPolicy).update(policy.id, { overtimePremiumRate: '0' }))).rejects.toBeInstanceOf(ValidationError);
    const data = { employeeId: f.employee.id, policyId: policy.id, validFrom: '2026-01-01', validTo: '2026-12-31', payType: 'hourly' as const, hourlyRate: '1200', monthlySalary: '0', monthlyBaseMinutes: 9600, paidLeaveDayMinutes: 480, confirmed: true, basis: '契約書' };
    const result = await Promise.allSettled([f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayTerms).create(data)), f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayTerms).create(data))]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const initialized = await call(f.db, f.payroll.params, 'initialize_policy', {});
    expect(initialized.id).toBe(policy.id);
    await expect(call(f.db, f.manager.params, 'initialize_policy', {})).rejects.toBeInstanceOf(PermissionDenied);
  });
  it('does not permit a caller to manufacture payroll evidence through generic records', async () => {
    await expect(f.db.run({}, (ctx) => repo(ctx, WorkforceAttendance).create({ employeeId: f.employee.id, userId: f.alice.id, siteId: f.siteId, workDate: '2026-08-20', clockIn: new Date('2026-08-20T09:00:00+09:00') }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(call(f.db, f.payroll.params, 'calculate_payroll', { employeeId: f.employee.id, period: '2026-08', attendanceCompleteConfirmed: false })).rejects.toBeInstanceOf(ValidationError);
    await expect(f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforcePayTerms).list())).rejects.toBeInstanceOf(PermissionDenied);
  });
});
