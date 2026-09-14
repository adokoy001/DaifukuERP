import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { defineWriteCapability, withWriteCapability, repo, runAction, StateError, type Context } from '@daifuku/kernel';
import { WorkforcePayroll, WorkforceYearEndAdjustment, WorkforcePayPolicy, WorkforcePayTerms } from '../src/index.ts';
import { fixture, call, at, type Fixture, type Command } from './helpers.ts';
import { condition, declaration } from './fiscal-fixtures.ts';

let f: Fixture;
let monthly: Command;
let annual: Command;
const late = '2027-01-15T09:00:00+09:00';
// Trusted fixture writes simulate inconsistent persisted drafts without weakening production workflow guards.
const payCapability = defineWriteCapability({
  name: 'test.inconsistent-payroll-draft',
  entity: WorkforcePayroll.name,
  fields: ['grossPay', 'deductionTotal', 'netPay', 'calculation'],
  operations: ['update', 'workflow'],
});
const annualCapability = defineWriteCapability({
  name: 'test.inconsistent-year-end-draft',
  entity: WorkforceYearEndAdjustment.name,
  fields: ['taxablePay', 'annualTax', 'withheldTax', 'refund', 'additionalTax', 'calculation'],
  operations: ['update', 'workflow'],
});
async function terms(employeeId: string) {
  await f.db.run(f.payroll.params, async (ctx) => {
    const policy = (await repo(ctx, WorkforcePayPolicy).list()).items[0];
    if (!policy) throw new Error('Missing fixture policy');
    await repo(ctx, WorkforcePayTerms).create({
      employeeId,
      policyId: policy.id,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      payType: 'monthly',
      hourlyRate: '0',
      monthlySalary: '300000',
      monthlyBaseMinutes: 9600,
      paidLeaveDayMinutes: 480,
      confirmed: true,
      basis: 'Synthetic monthly contract',
    });
  });
}
function calculate(employeeId: string, period: string, paymentDate: string) {
  return {
    employeeId,
    period,
    paymentDate,
    insurancePeriod: period,
    expectedVersion: 0,
    attendanceCompleteConfirmed: true,
    taxableAllowances: [],
    nonTaxableAllowances: [],
    otherDeduction: { amount: '0', basis: 'Synthetic no other deductions' },
  };
}
async function confirmPay(ctx: Context, id: string) {
  const row = await repo(ctx, WorkforcePayroll).get(id);
  return runAction(ctx, 'workforce.confirm_payroll', {
    payrollId: row.id,
    expectedVersion: row.version,
    deductions: row.deductions,
    allowances: row.allowances,
    calculationConfirmed: true,
    reason: 'Synthetic independent confirmation',
  });
}
async function confirmAnnual(ctx: Context, id: string) {
  const row = await repo(ctx, WorkforceYearEndAdjustment).get(id);
  return runAction(ctx, 'workforce.confirm_year_end_adjustment', {
    adjustmentId: row.id,
    expectedVersion: row.version,
    calculationConfirmed: true,
    reason: 'Synthetic independent confirmation',
  });
}
beforeAll(async () => {
  f = await fixture();
  await call(f.db, f.payroll.params, 'initialize_payroll_rules', {});
  for (const employeeId of [f.employee.id, f.otherEmployee.id]) {
    await terms(employeeId);
    await call(f.db, f.payroll.params, 'save_payroll_condition', { ...condition(), employeeId, expectedVersion: 0 });
  }
  monthly = await call(
    f.db,
    f.payroll.params,
    'calculate_statutory_payroll',
    calculate(f.employee.id, '2026-08', '2026-09-10'),
  );
  const last = await call(
    f.db,
    f.payroll.params,
    'calculate_statutory_payroll',
    calculate(f.otherEmployee.id, '2026-11', '2026-12-10'),
    late,
  );
  await f.db.run({ ...f.payroll.params, ...at(late) }, (ctx) => confirmPay(ctx, last.id));
  const declared = await call(f.db, f.bob.params, 'submit_year_end_declaration', {
    ...declaration({
      previousEmployers: [
        {
          name: 'Synthetic previous employer',
          taxablePay: '3300000',
          socialPremium: '553500',
          incomeTax: '83750',
          evidence: 'Synthetic prior payslip',
        },
      ],
      unpaidMonths: Array.from({ length: 11 }, (_, i) => ({
        period: `2026-${String(i + 1).padStart(2, '0')}`,
        reason: 'No payment by this employer in the synthetic period',
      })),
    }),
    expectedVersion: 0,
  });
  await call(f.db, f.payroll.params, 'review_year_end_declaration', {
    declarationId: declared.id,
    expectedVersion: declared.version,
    decision: 'accept',
    reason: 'Synthetic evidence accepted',
  });
  annual = await call(
    f.db,
    f.payroll.params,
    'calculate_year_end_adjustment',
    {
      employeeId: f.otherEmployee.id,
      taxYear: 2026,
      adjustedOn: '2026-12-31',
      expectedVersion: 0,
      annualPayrollCompleteConfirmed: true,
    },
    late,
  );
});
afterAll(async () => {
  await f?.db.close();
});

describe('stored statutory results are revalidated before publication', () => {
  it.each(['grossPay', 'deductionTotal', 'netPay'] as const)(
    'rejects a changed monthly %s even with original evidence and the current row version',
    async (field) => {
      const original = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(monthly.id));
      await expect(
        f.db.run({ ...f.payroll.params, ...at(late) }, async (ctx) => {
          await withWriteCapability(ctx, payCapability, (write) =>
            repo(write, WorkforcePayroll).update(
              original.id,
              { [field]: original[field].plus('1') },
              { expectedVersion: original.version },
            ),
          );
          const changed = await repo(ctx, WorkforcePayroll).get(original.id);
          expect(changed.version).toBe(original.version + 1);
          expect(changed.sourceFingerprint).toBe(original.sourceFingerprint);
          expect(changed.calculation).toEqual(original.calculation);
          await expect(confirmPay(ctx, original.id)).rejects.toMatchObject({
            name: 'StateError',
            message: expect.stringContaining('自動計算'),
          });
          throw new Error('rollback synthetic monthly corruption');
        }),
      ).rejects.toThrow('rollback synthetic monthly corruption');
      expect(await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(original.id))).toEqual(original);
    },
  );
  it.each(['taxablePay', 'annualTax', 'withheldTax', 'refund', 'additionalTax'] as const)(
    'rejects a changed annual %s while its source fingerprint remains intact',
    async (field) => {
      const original = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforceYearEndAdjustment).get(annual.id));
      await expect(
        f.db.run({ ...f.payroll.params, ...at(late) }, async (ctx) => {
          await withWriteCapability(ctx, annualCapability, (write) =>
            repo(write, WorkforceYearEndAdjustment).update(
              original.id,
              { [field]: original[field].plus('1') },
              { expectedVersion: original.version },
            ),
          );
          const changed = await repo(ctx, WorkforceYearEndAdjustment).get(original.id);
          expect(changed.sourceFingerprint).toBe(original.sourceFingerprint);
          expect(changed.calculation).toEqual(original.calculation);
          await expect(confirmAnnual(ctx, original.id)).rejects.toMatchObject({
            name: 'StateError',
            message: expect.stringContaining('保存された算定結果'),
          });
          throw new Error('rollback synthetic annual corruption');
        }),
      ).rejects.toThrow('rollback synthetic annual corruption');
      expect(await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforceYearEndAdjustment).get(original.id))).toEqual(
        original,
      );
    },
  );
  it.each(['salaryIncome', 'deductions', 'method'] as const)(
    'rejects changed annual calculation.%s independently of unchanged amount columns',
    async (field) => {
      const original = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforceYearEndAdjustment).get(annual.id));
      const calculation = structuredClone(original.calculation) as Record<string, unknown>;
      if (field === 'deductions')
        calculation.deductions = { ...(calculation.deductions as Record<string, unknown>), total: '0' };
      else calculation[field] = field === 'method' ? 'unverified algorithm label' : '0';
      await expect(
        f.db.run({ ...f.payroll.params, ...at(late) }, async (ctx) => {
          await withWriteCapability(ctx, annualCapability, (write) =>
            repo(write, WorkforceYearEndAdjustment).update(
              original.id,
              { calculation },
              { expectedVersion: original.version },
            ),
          );
          const changed = await repo(ctx, WorkforceYearEndAdjustment).get(original.id);
          expect(changed.sourceFingerprint).toBe(original.sourceFingerprint);
          expect(changed.annualTax).toEqual(original.annualTax);
          expect(changed.refund).toEqual(original.refund);
          await expect(confirmAnnual(ctx, original.id)).rejects.toMatchObject({
            name: 'StateError',
            message: expect.stringContaining('保存された算定結果'),
          });
          throw new Error('rollback synthetic annual calculation corruption');
        }),
      ).rejects.toThrow('rollback synthetic annual calculation corruption');
    },
  );
  it('still confirms unchanged monthly and annual drafts after the rejected mutations', async () => {
    const monthlyResult = (await f.db.run({ ...f.payroll.params, ...at(late) }, (ctx) =>
      confirmPay(ctx, monthly.id),
    )) as Command;
    const annualResult = (await f.db.run({ ...f.payroll.params, ...at(late) }, (ctx) =>
      confirmAnnual(ctx, annual.id),
    )) as Command;
    expect(monthlyResult.status).toBe('confirmed');
    expect(annualResult.status).toBe('confirmed');
    await expect(
      f.db.run({ ...f.payroll.params, ...at(late) }, (ctx) => confirmAnnual(ctx, annual.id)),
    ).rejects.toBeInstanceOf(StateError);
  });
});
