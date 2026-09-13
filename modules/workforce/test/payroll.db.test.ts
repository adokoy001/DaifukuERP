import {
  newId,
  PermissionDenied,
  repo,
  runAction,
  StateError,
  ValidationError,
  type InsertInput,
} from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deductionKinds } from '../src/contract.ts';
import {
  WorkforceAttendance,
  WorkforceEmployee,
  WorkforcePayPolicy,
  WorkforcePayTerms,
  WorkforcePayroll,
  WorkforcePeriodLock,
} from '../src/index.ts';
import { at, call, fixture, type Command, type Fixture } from './helpers.ts';
let f: Fixture;
let august: Command;
let september: Command;
let boundaryAttendance: Command;
let termsId: string;
const deductionInput = deductionKinds.map((kind) => ({
  kind,
  amount: '0',
  basis: '外部算定結果を確認してゼロ',
  confirmed: true,
}));
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.db.close();
});
async function terms(employeeId = f.employee.id) {
  return f.db.run(f.payroll.params, async (ctx) => {
    const policy = (
      await repo(ctx, WorkforcePayPolicy).list({
        where: { validFrom: { $lte: '2026-01-01' }, validTo: { $gte: '2026-09-30' } },
      })
    ).items[0];
    if (!policy) throw new Error('Missing fixture policy');
    return repo(ctx, WorkforcePayTerms).create({
      employeeId,
      policyId: policy.id,
      validFrom: '2026-01-01',
      validTo: policy.validTo < '2026-12-31' ? policy.validTo : '2026-12-31',
      payType: 'hourly',
      hourlyRate: '1200',
      monthlySalary: '0',
      monthlyBaseMinutes: 9600,
      paidLeaveDayMinutes: 480,
      confirmed: true,
      basis: '雇用契約確認済み',
    });
  });
}
async function approved(date: string, start = '09:00:00', end = '10:00:00') {
  const input = (kind: string, expectedVersion: number) => ({ kind, expectedVersion, idempotencyKey: newId() });
  const opened = await call(f.db, f.alice.params, 'punch', input('clock_in', 0), `${date}T${start}+09:00`);
  const closed = await call(f.db, f.alice.params, 'punch', input('clock_out', opened.version), `${date}T${end}+09:00`);
  const submitted = await call(f.db, f.alice.params, 'submit_attendance', {
    attendanceId: closed.id,
    expectedVersion: closed.version,
  });
  return call(f.db, f.manager.params, 'review_attendance', {
    attendanceId: submitted.id,
    expectedVersion: submitted.version,
    decision: 'approve',
    dayKind: 'workday',
    reason: '勤怠と休憩を確認',
  });
}
const confirmInput = (row: Command) => ({
  payrollId: row.id,
  expectedVersion: row.version,
  deductions: deductionInput,
  allowances: [],
  calculationConfirmed: true,
  reason: '全項目の外部算定と賃金台帳を確認',
});
describe('workforce payroll source, finalization and privacy', () => {
  it('requires valid nonoverlapping effective terms and an ended month', async () => {
    await expect(
      call(f.db, f.payroll.params, 'calculate_payroll', {
        employeeId: f.employee.id,
        period: '2026-08',
        attendanceCompleteConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(StateError);
    const created = await terms();
    termsId = created.id;
    await expect(terms()).rejects.toBeInstanceOf(ValidationError);
    await expect(
      call(f.db, f.payroll.params, 'calculate_payroll', {
        employeeId: f.employee.id,
        period: '2026-09',
        attendanceCompleteConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(StateError);
  });
  it('calculates only the requested month and rejects incomplete or duplicate external deductions', async () => {
    await approved('2026-08-03');
    boundaryAttendance = await approved('2026-08-31');
    await approved('2026-09-01');
    august = await call(f.db, f.payroll.params, 'calculate_payroll', {
      employeeId: f.employee.id,
      period: '2026-08',
      attendanceCompleteConfirmed: true,
    });
    const row = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(august.id));
    expect(row.grossPay.toString()).toBe('2400');
    expect(row.workedMs).toBe(7200000);
    expect(row.netPay.toString()).toBe('0');
    expect(row.calculationConfirmed).toBe(false);
    await expect(
      call(f.db, f.payroll.params, 'confirm_payroll', { ...confirmInput(august), deductions: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      call(f.db, f.payroll.params, 'confirm_payroll', {
        ...confirmInput(august),
        deductions: Array(8).fill(deductionInput[0]),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).update(row.id, { netPay: '2400' })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    expect((await f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforcePayroll).list())).items).toEqual([]);
    expect(await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforcePayroll).count())).toBe(0);
  });
  it('requires explicit recalculation after a source change and serializes duplicate confirmation', async () => {
    await approved('2026-08-04');
    await expect(call(f.db, f.payroll.params, 'confirm_payroll', confirmInput(august))).rejects.toBeInstanceOf(
      StateError,
    );
    await expect(
      call(f.db, f.payroll.params, 'calculate_payroll', {
        employeeId: f.employee.id,
        period: '2026-08',
        attendanceCompleteConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    august = await call(f.db, f.payroll.params, 'calculate_payroll', {
      employeeId: f.employee.id,
      period: '2026-08',
      expectedVersion: august.version,
      attendanceCompleteConfirmed: true,
    });
    const results = await Promise.allSettled([
      call(f.db, f.payroll.params, 'confirm_payroll', confirmInput(august)),
      call(f.db, f.payroll.params, 'confirm_payroll', confirmInput(august)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    august = (results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Command>).value;
    const own = (await f.db.run({ ...f.alice.params, ...at('2026-09-12T09:00:00+09:00') }, (ctx) =>
      runAction(ctx, 'workforce.my_portal', { period: '2026-08' }),
    )) as { payrolls: { netPay: string; deductions: unknown[] }[] };
    expect(own.payrolls).toHaveLength(1);
    expect(own.payrolls[0]).toMatchObject({ netPay: '3600', deductions: deductionInput });
    expect(await f.db.run(f.bob.params, (ctx) => repo(ctx, WorkforcePayroll).count())).toBe(0);
  });
  it('freezes confirmed source terms and policies, and permits adjacent month finalization', async () => {
    await expect(
      f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayTerms).update(termsId, { hourlyRate: '1500' })),
    ).rejects.toBeInstanceOf(StateError);
    const policy = await f.db.run({}, async (ctx) => (await repo(ctx, WorkforcePayPolicy).list()).items[0]);
    if (!policy) throw new Error('Missing fixture policy');
    await expect(
      f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayPolicy).update(policy.id, { weekStartsOn: 0 })),
    ).rejects.toBeInstanceOf(StateError);
    september = await call(
      f.db,
      f.payroll.params,
      'calculate_payroll',
      { employeeId: f.employee.id, period: '2026-09', attendanceCompleteConfirmed: true },
      '2026-10-01T09:00:00+09:00',
    );
    september = await call(
      f.db,
      f.payroll.params,
      'confirm_payroll',
      confirmInput(september),
      '2026-10-01T09:00:00+09:00',
    );
    expect(september.status).toBe('confirmed');
    const lock = await f.db.run(
      {},
      async (ctx) => (await repo(ctx, WorkforcePeriodLock).list({ where: { payrollId: september.id } })).items[0],
    );
    expect(lock?.periodStart).toBe('2026-08-31');
  });
  it('allows prospective retirement and interval changes while preserving historical calculation values', async () => {
    await f.db.run(f.hr.params, (ctx) =>
      repo(ctx, WorkforceEmployee).update(f.employee.id, { terminatedOn: '2026-12-31' }),
    );
    await expect(
      f.db.run(f.hr.params, (ctx) =>
        repo(ctx, WorkforceEmployee).update(f.employee.id, { terminatedOn: '2026-08-15' }),
      ),
    ).rejects.toBeInstanceOf(StateError);
    await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayTerms).update(termsId, { validTo: '2026-09-30' }));
    const policy = await f.db.run({}, async (ctx) => (await repo(ctx, WorkforcePayPolicy).list()).items[0]);
    if (!policy) throw new Error('Missing fixture policy');
    await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayPolicy).update(policy.id, { validTo: '2026-09-30' }));
    const copiedFields = Object.fromEntries(
      WorkforcePayPolicy.fieldNames.map((field) => [field, policy[field as keyof typeof policy]]),
    ) as InsertInput<typeof WorkforcePayPolicy>;
    const future = await f.db.run(f.hr.params, (ctx) =>
      repo(ctx, WorkforcePayPolicy).create({
        ...copiedFields,
        code: 'NEXT',
        validFrom: '2026-10-01',
        validTo: '2026-12-31',
      }),
    );
    await f.db.run(f.payroll.params, (ctx) =>
      repo(ctx, WorkforcePayTerms).create({
        employeeId: f.employee.id,
        policyId: future.id,
        validFrom: '2026-10-01',
        validTo: '2026-12-31',
        payType: 'hourly',
        hourlyRate: '1500',
        monthlySalary: '0',
        monthlyBaseMinutes: 9600,
        paidLeaveDayMinutes: 480,
        confirmed: true,
        basis: '10月からの昇給合意',
      }),
    );
    await expect(
      f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayTerms).update(termsId, { validTo: '2026-09-15' })),
    ).rejects.toBeInstanceOf(StateError);
    const saved = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(august.id));
    expect(saved.netPay.toString()).toBe('3600');
  });
  it('keeps the prior-week source frozen after its own month is cancelled', async () => {
    await call(f.db, f.payroll.params, 'cancel_payroll', {
      payrollId: august.id,
      expectedVersion: august.version,
      reason: '外部控除の訂正のため取消',
    });
    await expect(
      call(f.db, f.alice.params, 'request_correction', {
        attendanceId: boundaryAttendance.id,
        expectedVersion: boundaryAttendance.version,
        idempotencyKey: newId(),
        clockIn: '2026-08-31T09:00:00+09:00',
        clockOut: '2026-08-31T11:00:00+09:00',
        breaks: [],
        reason: '週境界の勤務を訂正',
      }),
    ).rejects.toBeInstanceOf(StateError);
    await call(f.db, f.payroll.params, 'cancel_payroll', {
      payrollId: september.id,
      expectedVersion: september.version,
      reason: '依存する勤務訂正のため取消',
    });
    expect(await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforcePayroll).count())).toBe(0);
    expect(await f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforcePeriodLock).count({ active: true }))).toBe(0);
  });
  it('preserves overnight attendance but explicitly rejects automatic payroll across JST calendar dates', async () => {
    const row = await call(
      f.db,
      f.bob.params,
      'punch',
      { kind: 'clock_in', expectedVersion: 0, idempotencyKey: newId() },
      '2026-08-10T22:00:00+09:00',
    );
    const closed = await call(
      f.db,
      f.bob.params,
      'punch',
      { kind: 'clock_out', expectedVersion: row.version, idempotencyKey: newId() },
      '2026-08-11T02:00:00+09:00',
    );
    const submitted = await call(f.db, f.bob.params, 'submit_attendance', {
      attendanceId: row.id,
      expectedVersion: closed.version,
    });
    await call(f.db, f.manager.params, 'review_attendance', {
      attendanceId: row.id,
      expectedVersion: submitted.version,
      decision: 'approve',
      dayKind: 'workday',
      reason: '実際の夜勤を確認',
    });
    await terms(f.otherEmployee.id);
    await expect(
      call(f.db, f.payroll.params, 'calculate_payroll', {
        employeeId: f.otherEmployee.id,
        period: '2026-08',
        attendanceCompleteConfirmed: true,
      }),
    ).rejects.toThrow('暦日ごとの休日区分に未対応');
    expect((await f.db.run(f.bob.params, (ctx) => repo(ctx, WorkforceAttendance).get(row.id))).workedMs).toBe(14400000);
  });
});
