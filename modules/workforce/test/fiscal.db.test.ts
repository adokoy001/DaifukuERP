import { PermissionDenied, repo, runAction, StateError } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WorkforcePayPolicy,
  WorkforcePayTerms,
  WorkforcePayroll,
  WorkforcePayrollCondition,
  WorkforcePayrollTaxEvidence,
  WorkforceYearEndAdjustment,
  WorkforceYearEndDeclaration,
} from '../src/index.ts';
import { at, call, fixture, type Command, type Fixture } from './helpers.ts';
import { condition, declaration } from './fiscal-fixtures.ts';
import type { FiscalBoard, MyFiscal } from '../src/fiscal-contract.ts';
let f: Fixture, conditionRow: Command, august: Command, november: Command, annual: Command, declarationRow: Command;
const late = '2027-01-15T09:00:00+09:00',
  december = '2026-12-15T09:00:00+09:00';
beforeAll(async () => {
  f = await fixture();
  await call(f.db, f.payroll.params, 'initialize_payroll_rules', {});
});
afterAll(async () => {
  await f?.db.close();
});
async function terms(employeeId: string) {
  return f.db.run(f.payroll.params, async (ctx) => {
    const policy = (await repo(ctx, WorkforcePayPolicy).list()).items[0];
    if (!policy) throw new Error('Missing policy');
    return repo(ctx, WorkforcePayTerms).create({
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
      basis: '月給の雇用契約',
    });
  });
}
function calculation(employeeId: string, period = '2026-08', expectedVersion = 0) {
  return {
    employeeId,
    period,
    expectedVersion,
    attendanceCompleteConfirmed: true,
    paymentDate: period === '2026-08' ? '2026-09-10' : '2026-12-10',
    insurancePeriod: period,
    taxableAllowances: [],
    nonTaxableAllowances: [],
    otherDeduction: { amount: '0', basis: '他控除なしを確認' },
  };
}
async function confirmation(row: Command) {
  const pay = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(row.id));
  return {
    payrollId: row.id,
    expectedVersion: row.version,
    deductions: pay.deductions,
    allowances: pay.allowances,
    calculationConfirmed: true,
    reason: '算定条件と控除・証跡を確認',
  };
}
const annualFacts = () =>
  declaration({
    previousEmployers: [
      {
        name: '前職',
        taxablePay: '3300000',
        socialPremium: '553500',
        incomeTax: '83750',
        evidence: '前職源泉徴収票を確認',
      },
    ],
    unpaidMonths: Array.from({ length: 11 }, (_, index) => ({
      period: `2026-${String(index + 1).padStart(2, '0')}`,
      reason: '当社ではこの月に給与の支払なし',
    })),
  });
describe('statutory payroll and year-end integrity', () => {
  it('requires payroll-headquarters authority and rejects generic writes', async () => {
    await expect(call(f.db, f.manager.params, 'initialize_payroll_rules', {})).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      call(f.db, f.hr.params, 'save_payroll_condition', {
        ...condition(),
        employeeId: f.employee.id,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      f.db.run(f.payroll.params, (ctx) =>
        repo(ctx, WorkforcePayrollCondition).create({
          employeeId: f.employee.id,
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          condition: condition(),
        }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await terms(f.employee.id);
    await terms(f.otherEmployee.id);
    conditionRow = await call(f.db, f.payroll.params, 'save_payroll_condition', {
      ...condition(),
      employeeId: f.employee.id,
      expectedVersion: 0,
    });
    await call(f.db, f.payroll.params, 'save_payroll_condition', {
      ...condition(),
      employeeId: f.otherEmployee.id,
      expectedVersion: 0,
    });
    await expect(
      call(f.db, f.payroll.params, 'save_payroll_condition', {
        ...condition(),
        employeeId: f.employee.id,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(StateError);
  });
  it('calculates actual monthly withholding and freezes the independently sourced amounts', async () => {
    august = await call(f.db, f.payroll.params, 'calculate_statutory_payroll', calculation(f.employee.id));
    const row = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(august.id));
    expect(row.basePay.toString()).toBe('300000');
    expect(row.deductionTotal.toString()).toBe('67750');
    expect(row.netPay.toString()).toBe('232250');
    const input = await confirmation(august),
      altered = (input.deductions as { kind: string; amount: string }[]).map((item) =>
        item.kind === 'income_tax' ? { ...item, amount: '0' } : item,
      );
    await expect(
      call(f.db, f.payroll.params, 'confirm_payroll', { ...input, deductions: altered }),
    ).rejects.toBeInstanceOf(StateError);
    conditionRow = await call(f.db, f.payroll.params, 'save_payroll_condition', {
      ...condition({ residentTaxAmount: '14000' }),
      conditionId: conditionRow.id,
      employeeId: f.employee.id,
      expectedVersion: conditionRow.version,
    });
    await expect(call(f.db, f.payroll.params, 'confirm_payroll', input)).rejects.toBeInstanceOf(StateError);
    august = await call(
      f.db,
      f.payroll.params,
      'calculate_statutory_payroll',
      calculation(f.employee.id, '2026-08', august.version),
    );
    const confirm = await confirmation(august),
      results = await Promise.allSettled([
        call(f.db, f.payroll.params, 'confirm_payroll', confirm),
        call(f.db, f.payroll.params, 'confirm_payroll', confirm),
      ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    august = (results.find((row) => row.status === 'fulfilled') as PromiseFulfilledResult<Command>).value;
    const evidence = await f.db.run(f.payroll.params, (ctx) =>
      repo(ctx, WorkforcePayrollTaxEvidence).list({ where: { payrollId: august.id } }),
    );
    expect(evidence.items).toHaveLength(1);
    expect(evidence.items[0]?.incomeTax.toString()).toBe('6250');
    expect(evidence.items[0]?.socialPremium.toString()).toBe('46500');
    await expect(
      call(f.db, f.payroll.params, 'save_payroll_condition', {
        ...condition(),
        conditionId: conditionRow.id,
        employeeId: f.employee.id,
        expectedVersion: conditionRow.version,
      }),
    ).rejects.toBeInstanceOf(StateError);
  });
  it('splits a future condition atomically without rewriting payroll evidence', async () => {
    await expect(
      call(f.db, f.payroll.params, 'supersede_payroll_condition', {
        ...condition({ validFrom: '2026-09-01' }),
        conditionId: conditionRow.id,
        employeeId: f.employee.id,
        expectedVersion: conditionRow.version,
      }),
    ).rejects.toBeInstanceOf(StateError);
    const before = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(august.id));
    const future = await call(f.db, f.payroll.params, 'supersede_payroll_condition', {
      ...condition({ validFrom: '2026-10-01', residentTaxAmount: '13000' }),
      conditionId: conditionRow.id,
      employeeId: f.employee.id,
      expectedVersion: conditionRow.version,
    });
    expect(future.id).not.toBe(conditionRow.id);
    const old = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayrollCondition).get(conditionRow.id));
    expect(old.validTo).toBe('2026-09-30');
    const after = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(august.id));
    expect(after.calculation).toEqual(before.calculation);
  });
  it('keeps conditions and other employee tax declarations out of site and self access', async () => {
    await expect(
      f.db.run(f.manager.params, (ctx) => runAction(ctx, 'workforce.fiscal_board', { taxYear: 2026 })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforcePayrollCondition).count()),
    ).rejects.toBeInstanceOf(PermissionDenied);
    november = await call(
      f.db,
      f.payroll.params,
      'calculate_statutory_payroll',
      calculation(f.otherEmployee.id, '2026-11'),
      december,
    );
    november = await call(f.db, f.payroll.params, 'confirm_payroll', await confirmation(november), december);
    declarationRow = await call(f.db, f.bob.params, 'submit_year_end_declaration', {
      ...annualFacts(),
      expectedVersion: 0,
    });
    expect(await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforceYearEndDeclaration).count())).toBe(0);
    expect(await f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforceYearEndDeclaration).count())).toBe(0);
    await expect(
      call(f.db, f.manager.params, 'review_year_end_declaration', {
        declarationId: declarationRow.id,
        expectedVersion: declarationRow.version,
        decision: 'accept',
        reason: '受付',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    declarationRow = await call(f.db, f.payroll.params, 'review_year_end_declaration', {
      declarationId: declarationRow.id,
      expectedVersion: declarationRow.version,
      decision: 'accept',
      reason: '本人申告と前職・証明資料確認',
    });
  });
  it('aggregates published tax evidence and accepted deductions, then rejects stale annual calculations', async () => {
    const input = {
      employeeId: f.otherEmployee.id,
      taxYear: 2026,
      expectedVersion: 0,
      adjustedOn: '2026-12-31',
      annualPayrollCompleteConfirmed: true,
    };
    annual = await call(f.db, f.payroll.params, 'calculate_year_end_adjustment', input, late);
    const row = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforceYearEndAdjustment).get(annual.id));
    expect(row.taxablePay.toString()).toBe('3600000');
    expect(row.annualTax.toString()).toBe('40800');
    expect(row.refund.toString()).toBe('49200');
    declarationRow = await call(f.db, f.bob.params, 'submit_year_end_declaration', {
      ...annualFacts(),
      expectedVersion: declarationRow.version,
    });
    await expect(
      call(
        f.db,
        f.payroll.params,
        'confirm_year_end_adjustment',
        { adjustmentId: annual.id, expectedVersion: annual.version, calculationConfirmed: true, reason: '確認' },
        late,
      ),
    ).rejects.toBeInstanceOf(StateError);
    declarationRow = await call(f.db, f.payroll.params, 'review_year_end_declaration', {
      declarationId: declarationRow.id,
      expectedVersion: declarationRow.version,
      decision: 'accept',
      reason: '再受付',
    });
    annual = await call(
      f.db,
      f.payroll.params,
      'calculate_year_end_adjustment',
      { ...input, expectedVersion: annual.version },
      late,
    );
    annual = await call(
      f.db,
      f.payroll.params,
      'confirm_year_end_adjustment',
      {
        adjustmentId: annual.id,
        expectedVersion: annual.version,
        calculationConfirmed: true,
        reason: '再計算と年間資料確認',
      },
      late,
    );
    await expect(
      call(
        f.db,
        f.payroll.params,
        'cancel_payroll',
        { payrollId: november.id, expectedVersion: november.version, reason: '年調後の給与変更' },
        late,
      ),
    ).rejects.toBeInstanceOf(StateError);
    await expect(
      call(
        f.db,
        f.bob.params,
        'submit_year_end_declaration',
        { ...annualFacts(), expectedVersion: declarationRow.version },
        late,
      ),
    ).rejects.toBeInstanceOf(StateError);
    await expect(
      call(
        f.db,
        f.payroll.params,
        'calculate_payroll',
        { employeeId: f.otherEmployee.id, period: '2026-10', attendanceCompleteConfirmed: true },
        late,
      ),
    ).rejects.toBeInstanceOf(StateError);
    await call(
      f.db,
      f.payroll.params,
      'cancel_year_end_adjustment',
      { adjustmentId: annual.id, expectedVersion: annual.version, reason: '未精算の確認取消と再確認' },
      late,
    );
    annual = await call(f.db, f.payroll.params, 'calculate_year_end_adjustment', input, late);
    annual = await call(
      f.db,
      f.payroll.params,
      'confirm_year_end_adjustment',
      { adjustmentId: annual.id, expectedVersion: annual.version, calculationConfirmed: true, reason: '再調整確認' },
      late,
    );
  });
  it('shows only own confirmed results, records one real settlement, and preserves frozen history', async () => {
    const own = (await f.db.run({ ...f.bob.params, ...at(late) }, (ctx) =>
      runAction(ctx, 'workforce.my_fiscal_portal', { taxYear: 2026 }),
    )) as MyFiscal;
    expect(own.adjustments).toHaveLength(1);
    expect(own.adjustments[0]?.refund).toBe('49200');
    const other = (await f.db.run(f.alice.params, (ctx) =>
      runAction(ctx, 'workforce.my_fiscal_portal', { taxYear: 2026 }),
    )) as MyFiscal;
    expect(other.adjustments).toEqual([]);
    const board = (await f.db.run(f.payroll.params, (ctx) =>
      runAction(ctx, 'workforce.fiscal_board', { taxYear: 2026 }),
    )) as FiscalBoard;
    expect(board.adjustments).toHaveLength(2);
    annual = await call(
      f.db,
      f.payroll.params,
      'settle_year_end_adjustment',
      {
        adjustmentId: annual.id,
        expectedVersion: annual.version,
        settledOn: '2027-01-10',
        reference: '返金振込明細 YEA-1',
      },
      late,
    );
    await expect(
      call(
        f.db,
        f.payroll.params,
        'settle_year_end_adjustment',
        { adjustmentId: annual.id, expectedVersion: annual.version, settledOn: '2027-01-10', reference: '二重精算' },
        late,
      ),
    ).rejects.toBeInstanceOf(StateError);
    await expect(
      call(
        f.db,
        f.payroll.params,
        'cancel_year_end_adjustment',
        { adjustmentId: annual.id, expectedVersion: annual.version, reason: '精算後の取消' },
        late,
      ),
    ).rejects.toBeInstanceOf(StateError);
  });
});
