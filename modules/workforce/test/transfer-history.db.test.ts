import { companyMemberships, repo } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deductionKinds } from '../src/contract.ts';
import {
  WorkforceEmployee,
  WorkforceLeaveGrant,
  WorkforcePayPolicy,
  WorkforcePayTerms,
  WorkforcePayroll,
  WorkforcePeriodLock,
} from '../src/index.ts';
import { leaveBalance } from '../src/leave-balance.ts';
import { call, fixture, type Fixture } from './helpers.ts';
let f: Fixture;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.db.close();
});
const employee = (id: string) => f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforceEmployee).get(id));
const membershipSnapshot = () =>
  f.db.owner.drizzle
    .select({ userId: companyMemberships.userId, siteIds: companyMemberships.siteIds })
    .from(companyMemberships);
async function payslip() {
  await f.db.run(f.payroll.params, async (ctx) => {
    const policy = (await repo(ctx, WorkforcePayPolicy).list()).items[0];
    if (!policy) throw new Error('Missing policy');
    await repo(ctx, WorkforcePayTerms).create({
      employeeId: f.otherEmployee.id,
      policyId: policy.id,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      payType: 'monthly',
      hourlyRate: '0',
      monthlySalary: '240000',
      monthlyBaseMinutes: 9600,
      paidLeaveDayMinutes: 480,
      confirmed: true,
      basis: '確認済みの契約',
    });
  });
  const row = await call(f.db, f.payroll.params, 'calculate_payroll', {
    employeeId: f.otherEmployee.id,
    period: '2026-08',
    attendanceCompleteConfirmed: true,
  });
  return call(f.db, f.payroll.params, 'confirm_payroll', {
    payrollId: row.id,
    expectedVersion: row.version,
    deductions: deductionKinds.map((kind) => ({ kind, amount: '0', basis: '外部算定済みゼロ', confirmed: true })),
    allowances: [],
    calculationConfirmed: true,
    reason: '全項目確認',
  });
}
describe('employee transfer preserves scoped leave and published payslip history', () => {
  it('rejects moving an employee with leave grants and preserves the assignment, membership and balance', async () => {
    const grant = await call(f.db, f.hr.params, 'grant_leave', {
      employeeId: f.employee.id,
      validFrom: '2026-09-01',
      expiresOn: '2026-12-31',
      days: '2',
      eligibilityConfirmed: true,
      basis: '資格確認済み',
    });
    const before = await employee(f.employee.id);
    const members = await membershipSnapshot();
    // Removing the original site from a membership would hide the remaining balance under the current scope model.
    expect(
      await f.db.run({ ...f.alice.params, siteIds: [f.otherSiteId] }, async (ctx) =>
        (await leaveBalance(ctx, f.employee.id, '2026-09-12')).toString(),
      ),
    ).toBe('0');
    await expect(
      f.db.run(f.hr.params, (ctx) =>
        repo(ctx, WorkforceEmployee).update(before.id, { siteId: f.otherSiteId }, { expectedVersion: before.version }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await employee(before.id)).toEqual(before);
    expect(await membershipSnapshot()).toEqual(members);
    expect(
      await f.db.run(f.alice.params, async (ctx) => (await leaveBalance(ctx, before.id, '2026-09-12')).toString()),
    ).toBe('2');
    expect((await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforceLeaveGrant).get(grant.id))).siteId).toBe(
      f.siteId,
    );
  });
  it('uses the minimal closed-period projection to protect payslips without exposing wages to HR', async () => {
    const payroll = await payslip();
    const before = await employee(f.otherEmployee.id);
    const members = await membershipSnapshot();
    expect(await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayroll).count())).toBe(0);
    expect(
      await f.db.run(f.hr.params, (ctx) =>
        repo(ctx, WorkforcePeriodLock).count({ employeeId: before.id, active: true }),
      ),
    ).toBe(1);
    await expect(
      f.db.run(f.hr.params, (ctx) =>
        repo(ctx, WorkforceEmployee).update(before.id, { siteId: f.otherSiteId }, { expectedVersion: before.version }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await employee(before.id)).toEqual(before);
    expect(await membershipSnapshot()).toEqual(members);
    const published = await f.db.run(f.bob.params, (ctx) => repo(ctx, WorkforcePayroll).get(payroll.id));
    expect(published.docstatus).toBe(1);
    expect(published.netPay.toString()).toBe('240000');
  });
  it('permits no-history transfer and does not block unrelated employee edits with historical grants', async () => {
    const person = await f.person('new-starter', 'workforce_employee');
    const row = await call(f.db, f.hr.params, 'register_employee', {
      userId: person.id,
      siteId: f.siteId,
      code: 'NEW',
      name: '新規従業員',
      hiredOn: '2026-01-01',
    });
    const moved = await f.db.run(f.hr.params, (ctx) =>
      repo(ctx, WorkforceEmployee).update(row.id, { siteId: f.otherSiteId }, { expectedVersion: row.version }),
    );
    expect(moved.siteId).toBe(f.otherSiteId);
    const current = await employee(f.employee.id);
    expect(
      (
        await f.db.run(f.hr.params, (ctx) =>
          repo(ctx, WorkforceEmployee).update(
            current.id,
            { name: '氏名更新', terminatedOn: '2026-12-31' },
            { expectedVersion: current.version },
          ),
        )
      ).name,
    ).toBe('氏名更新');
  });
});
