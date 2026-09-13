import { newId, PermissionDenied, repo, runAction, StateError } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WorkforceEmployee,
  WorkforcePayPolicy,
  WorkforcePayroll,
  WorkforcePayTerms,
  WorkforceWorkSystemPeriod,
} from '../src/index.ts';
import type { ShiftBoard } from '../src/shift-contract.ts';
import { deductionKinds } from '../src/contract.ts';
import { call, fixture, type Command, type Fixture } from './helpers.ts';
import { workSystem } from './work-system-fixtures.ts';
import { addDays } from '../src/services/time.ts';
let f: Fixture, system: Command, published: Command;
const weekStart = '2026-09-28',
  endTime = '2026-11-02T09:00:00+09:00';
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.db.close();
});
async function board(selectedWeek = weekStart) {
  return f.db.run(f.manager.params, (ctx) =>
    runAction(ctx, 'workforce.shift_board', { siteId: f.siteId, weekStart: selectedWeek }),
  ) as Promise<ShiftBoard>;
}
describe('work-system approval, shift sources and payroll integration', () => {
  it('keeps drafts scoped, rejects generic writes and requires prior agreement before confirmation', async () => {
    const input = workSystem(f.employee.id);
    input.days = input.days.map((row) =>
      row.date === '2026-10-01'
        ? { ...row, scheduledMinutes: 600, endMinute: 1200 }
        : row.date === '2026-10-02'
          ? { ...row, scheduledMinutes: 360, endMinute: 960 }
          : row,
    );
    await expect(
      call(f.db, f.alice.params, 'save_work_system', { ...input, expectedVersion: 0 }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      f.db.run(f.manager.params, (ctx) =>
        repo(ctx, WorkforceWorkSystemPeriod).create({ ...input, userId: f.alice.id, siteId: f.siteId }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    system = await call(f.db, f.manager.params, 'save_work_system', { ...input, expectedVersion: 0 });
    expect(await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforceWorkSystemPeriod).count())).toBe(0);
    expect(await f.db.run(f.remote.params, (ctx) => repo(ctx, WorkforceWorkSystemPeriod).count())).toBe(0);
    await expect(
      call(
        f.db,
        f.manager.params,
        'confirm_work_system',
        { periodId: system.id, expectedVersion: system.version, reason: '遅れた確認' },
        '2026-10-01T09:00:00+09:00',
      ),
    ).rejects.toBeInstanceOf(StateError);
    const before = await board(),
      results = await Promise.allSettled([
        call(f.db, f.manager.params, 'confirm_work_system', {
          periodId: system.id,
          expectedVersion: system.version,
          reason: '労使合意と所定を事前確認',
        }),
        call(f.db, f.manager.params, 'confirm_work_system', {
          periodId: system.id,
          expectedVersion: system.version,
          reason: '二重確認',
        }),
      ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    system = (results.find((row) => row.status === 'fulfilled') as PromiseFulfilledResult<Command>).value;
    expect((await board()).sourceRevision).not.toBe(before.sourceRevision);
    expect(await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforceWorkSystemPeriod).count())).toBe(1);
    await expect(
      f.db.run(f.hr.params, (ctx) =>
        repo(ctx, WorkforceEmployee).update(f.employee.id, { terminatedOn: '2026-10-15' }),
      ),
    ).rejects.toBeInstanceOf(StateError);
  });
  it('passes only effective work limits to recommendation and prevents cancelling a published dependency', async () => {
    await call(f.db, f.manager.params, 'save_shift_profile', {
      employeeId: f.employee.id,
      expectedVersion: 0,
      profile: {
        skills: [],
        employmentType: 'full_time',
        targetMinutes: 2400,
        maxWeeklyMinutes: 3000,
        maxDailyMinutes: 600,
        maxDays: 6,
        maxConsecutiveDays: 6,
        minRestMinutes: 660,
      },
    });
    await call(f.db, f.alice.params, 'save_shift_availability', {
      weekStart,
      expectedVersion: 0,
      days: Array.from({ length: 7 }, (_, index) => ({
        date: addDays(weekStart, index),
        preference: 'available',
        startMinute: 0,
        endMinute: 1440,
      })),
    });
    const current = await board();
    expect(current.problem.workRules?.find((row) => row.date === '2026-10-01')).toMatchObject({
      dailyLimitMinutes: 600,
      mode: 'monthly_variable',
    });
    const slots = [
        {
          id: 'long',
          date: '2026-10-01',
          label: '事前10時間勤務',
          startMinute: 540,
          endMinute: 1200,
          breakMinutes: 60,
          required: 1,
          skill: '',
        },
      ],
      assignments = [{ employeeId: f.employee.id, slotId: 'long', locked: false }];
    const draft = await call(f.db, f.manager.params, 'save_shift_plan', {
      siteId: f.siteId,
      weekStart,
      expectedVersion: 0,
      sourceRevision: current.sourceRevision,
      slots,
      assignments,
      seed: 1,
    });
    published = await call(f.db, f.manager.params, 'publish_shift_plan', {
      planId: draft.id,
      expectedVersion: draft.version,
      sourceRevision: (await board()).sourceRevision,
      acknowledgeShortage: false,
      reason: '勤務制度の所定内で公開',
    });
    await expect(
      call(f.db, f.manager.params, 'cancel_work_system', {
        periodId: system.id,
        expectedVersion: system.version,
        reason: '公開後取消',
      }),
    ).rejects.toBeInstanceOf(StateError);
    const updated = await board();
    expect(updated.problem.periodBudgets?.[0]?.remainingMinutes).toBe(10560);
    expect(updated.published?.id).toBe(published.id);
  });
  it('invalidates stale period budgets when a distant week publishes work', async () => {
    const before = await board(),
      distantWeek = '2026-10-19';
    await call(f.db, f.alice.params, 'save_shift_availability', {
      weekStart: distantWeek,
      expectedVersion: 0,
      days: Array.from({ length: 7 }, (_, index) => ({
        date: addDays(distantWeek, index),
        preference: 'available',
        startMinute: 0,
        endMinute: 1440,
      })),
    });
    const distant = await board(distantWeek);
    expect(distant.problem.periodBudgets?.[0]?.remainingMinutes).toBe(9960);
    const slots = [
        {
          id: 'distant',
          date: distantWeek,
          label: '離れた週の勤務',
          startMinute: 540,
          endMinute: 1080,
          breakMinutes: 60,
          required: 1,
          skill: '',
        },
      ],
      assignments = [{ employeeId: f.employee.id, slotId: 'distant', locked: false }];
    const draft = await call(f.db, f.manager.params, 'save_shift_plan', {
      siteId: f.siteId,
      weekStart: distantWeek,
      expectedVersion: 0,
      sourceRevision: distant.sourceRevision,
      slots,
      assignments,
      seed: 2,
    });
    await call(f.db, f.manager.params, 'publish_shift_plan', {
      planId: draft.id,
      expectedVersion: draft.version,
      sourceRevision: (await board(distantWeek)).sourceRevision,
      acknowledgeShortage: false,
      reason: '同じ清算期間の別週を公開',
    });
    const after = await board();
    expect(after.problem.periodBudgets?.[0]?.remainingMinutes).toBe(10080);
    expect(after.sourceRevision).not.toBe(before.sourceRevision);
    await expect(
      call(f.db, f.manager.params, 'save_shift_plan', {
        siteId: f.siteId,
        weekStart,
        expectedVersion: 0,
        sourceRevision: before.sourceRevision,
        slots: before.published?.slots ?? [],
        assignments: before.published?.assignments ?? [],
        seed: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('uses the same prior ten-hour conditions for approved attendance and frozen payroll', async () => {
    let attendance = await call(
      f.db,
      f.alice.params,
      'punch',
      { kind: 'clock_in', expectedVersion: 0, idempotencyKey: newId() },
      '2026-10-01T09:00:00+09:00',
    );
    attendance = await call(
      f.db,
      f.alice.params,
      'punch',
      { kind: 'break_start', expectedVersion: attendance.version, idempotencyKey: newId() },
      '2026-10-01T12:00:00+09:00',
    );
    attendance = await call(
      f.db,
      f.alice.params,
      'punch',
      { kind: 'break_end', expectedVersion: attendance.version, idempotencyKey: newId() },
      '2026-10-01T13:00:00+09:00',
    );
    attendance = await call(
      f.db,
      f.alice.params,
      'punch',
      { kind: 'clock_out', expectedVersion: attendance.version, idempotencyKey: newId() },
      '2026-10-01T20:00:00+09:00',
    );
    attendance = await call(
      f.db,
      f.alice.params,
      'submit_attendance',
      { attendanceId: attendance.id, expectedVersion: attendance.version },
      endTime,
    );
    await call(
      f.db,
      f.manager.params,
      'review_attendance',
      {
        attendanceId: attendance.id,
        expectedVersion: attendance.version,
        decision: 'approve',
        dayKind: 'workday',
        reason: '所定と実勤務・休憩確認',
      },
      endTime,
    );
    await f.db.run(f.payroll.params, async (ctx) => {
      const policy = (await repo(ctx, WorkforcePayPolicy).list()).items[0];
      if (!policy) throw new Error('Missing policy');
      await repo(ctx, WorkforcePayTerms).create({
        employeeId: f.employee.id,
        policyId: policy.id,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        payType: 'monthly',
        hourlyRate: '0',
        monthlySalary: '300000',
        monthlyBaseMinutes: 9600,
        paidLeaveDayMinutes: 480,
        confirmed: true,
        basis: '月給条件を確認',
      });
    });
    let pay = await call(
      f.db,
      f.payroll.params,
      'calculate_payroll',
      { employeeId: f.employee.id, period: '2026-10', attendanceCompleteConfirmed: true },
      endTime,
    );
    const row = await f.db.run(f.payroll.params, (ctx) => repo(ctx, WorkforcePayroll).get(pay.id));
    expect(row.premiumPay.toString()).toBe('0');
    expect((row.calculation as Record<string, unknown>)['workSystems']).toHaveLength(1);
    pay = await call(
      f.db,
      f.payroll.params,
      'confirm_payroll',
      {
        payrollId: pay.id,
        expectedVersion: pay.version,
        deductions: deductionKinds.map((kind) => ({ kind, amount: '0', basis: '外部確認済み控除額', confirmed: true })),
        allowances: [],
        calculationConfirmed: true,
        reason: '所定・勤怠・控除確認',
      },
      endTime,
    );
    expect(pay.status).toBe('confirmed');
    await expect(
      call(
        f.db,
        f.manager.params,
        'cancel_work_system',
        { periodId: system.id, expectedVersion: system.version, reason: '給与後の取消' },
        endTime,
      ),
    ).rejects.toBeInstanceOf(StateError);
  });
});
