// docs/specs/inbox.md AC-1..AC-3: workforce.todo counts through the caller's repository boundaries (site, self) and
// the review/settle/confirm permissions; zero counts are omitted. Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  newId,
  PermissionDenied,
  repo,
  runAction,
  todoResult,
  type ContextParams,
  type TodoResult,
} from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkforceExpense, WorkforcePayPolicy, WorkforcePayTerms } from '../src/index.ts';
import { at, call, fixture, NOW, type Command, type Fixture } from './helpers.ts';

let f: Fixture;
let carol: { id: string; params: Partial<ContextParams> };
let managerSelf: { id: string; params: Partial<ContextParams> };
beforeAll(async () => {
  f = await fixture();
  carol = await f.person('carol', 'workforce_employee', [f.otherSiteId]);
  await call(f.db, f.hr.params, 'register_employee', {
    userId: carol.id,
    siteId: f.otherSiteId,
    code: 'C',
    name: 'Carol',
    hiredOn: '2026-01-01',
  });
  managerSelf = f.manager;
  await call(f.db, f.hr.params, 'register_employee', {
    userId: managerSelf.id,
    siteId: f.siteId,
    code: 'M',
    name: 'Manager',
    hiredOn: '2026-01-01',
  });
});
afterAll(async () => {
  await f?.db.close();
});

const todo = async (params: Partial<ContextParams>) =>
  todoResult.parse(await f.db.run({ ...params, ...at(NOW) }, (ctx) => runAction(ctx, 'workforce.todo', {})));
const count = (result: TodoResult, key: string) => result.items.find((item) => item.key === key)?.count ?? 0;
async function submittedExpense(params: Partial<ContextParams>, expenseDate = '2026-09-10'): Promise<Command> {
  const saved = await call(f.db, params, 'save_expense', {
    expectedVersion: 0,
    idempotencyKey: newId(),
    expenseDate,
    category: '交通費',
    description: '訪問交通費（受信箱の試験）',
    amount: '1000',
    evidence: '合成の領収書参照-TODO',
  });
  return call(f.db, params, 'submit_expense', { expenseId: saved.id, expectedVersion: saved.version });
}

describe('workforce.todo (docs/specs/inbox.md)', () => {
  it('AC-1 AC-2: counts expenses awaiting approval within the reviewer site boundary and omits zero counts', async () => {
    expect((await todo(f.manager.params)).items).toEqual([]);
    await submittedExpense(f.alice.params);
    await submittedExpense(carol.params, '2026-08-20');
    const manager = await todo(f.manager.params);
    expect(manager.items).toEqual([
      {
        key: 'expense_review',
        label: { ja: '承認待ちの経費', en: 'Expenses awaiting approval' },
        count: 1,
        href: '/workforce?period=2026-09',
        severity: 'info',
      },
    ]);
    // The other site's manager sees only Carol's request; company-wide HR sees both, linked to the oldest month.
    expect(await todo(f.remote.params)).toMatchObject({
      items: [{ key: 'expense_review', count: 1, href: '/workforce?period=2026-08' }],
    });
    expect(await todo(f.hr.params)).toMatchObject({
      items: [{ key: 'expense_review', count: 2, href: '/workforce?period=2026-08' }],
    });
    // Employees cannot review, so their own pending request is not an inbox item for them.
    expect((await todo(f.alice.params)).items).toEqual([]);
  });

  it('AC-1: leaves out the reviewer’s own requests, which the review action refuses', async () => {
    await submittedExpense(managerSelf.params);
    expect(count(await todo(f.manager.params), 'expense_review')).toBe(1);
    expect(count(await todo(f.hr.params), 'expense_review')).toBe(3);
  });

  it('AC-2: attendance, correction and paid leave reviews; returned records reach only their owner', async () => {
    const punch = (kind: string, version: number, time: string) =>
      call(f.db, f.alice.params, 'punch', { kind, expectedVersion: version, idempotencyKey: newId() }, time);
    const opened = await punch('clock_in', 0, '2026-08-05T09:00:00+09:00');
    const closed = await punch('clock_out', opened.version, '2026-08-05T10:00:00+09:00');
    const submitted = await call(f.db, f.alice.params, 'submit_attendance', {
      attendanceId: closed.id,
      expectedVersion: closed.version,
    });
    await call(f.db, f.alice.params, 'request_correction', {
      attendanceId: submitted.id,
      expectedVersion: submitted.version,
      idempotencyKey: newId(),
      clockIn: '2026-08-05T09:00:00+09:00',
      clockOut: '2026-08-05T11:00:00+09:00',
      breaks: [],
      reason: '退勤打刻の訂正（受信箱の試験）',
    });
    await call(f.db, f.hr.params, 'grant_leave', {
      employeeId: f.employee.id,
      validFrom: '2026-09-01',
      expiresOn: '2026-09-30',
      days: '1',
      eligibilityConfirmed: true,
      basis: '雇用・出勤条件確認済みの演習付与',
    });
    await call(f.db, f.alice.params, 'request_leave', {
      leaveDate: '2026-09-14',
      portion: 'full',
      idempotencyKey: newId(),
      reason: '私用のため',
    });
    const manager = await todo(f.manager.params);
    expect(manager.items.map((item) => [item.key, item.count, item.href])).toEqual([
      ['attendance_review', 1, '/workforce?period=2026-08'],
      ['correction_review', 1, '/workforce?period=2026-08'],
      ['leave_review', 1, '/workforce?period=2026-09'],
      ['expense_review', 1, '/workforce?period=2026-09'],
    ]);
    expect((await todo(f.remote.params)).items.map((item) => item.key)).toEqual(['expense_review']);

    const pending = (
      await f.db.run(f.alice.params, (ctx) =>
        repo(ctx, WorkforceExpense).list({ where: { userId: f.alice.id, status: 'submitted' } }),
      )
    ).items[0];
    if (!pending) throw new Error('Expected the submitted expense');
    await call(f.db, f.manager.params, 'review_expense', {
      expenseId: pending.id,
      expectedVersion: pending.version,
      decision: 'return',
      reason: '証憑の参照先を確認してください',
    });
    expect(await todo(f.alice.params)).toEqual({
      items: [
        {
          key: 'my_returned',
          label: { ja: '差し戻された自分の勤怠・経費', en: 'My returned attendance and expenses' },
          count: 1,
          href: '/me',
          severity: 'warn',
        },
      ],
    });
    expect(count(await todo(f.bob.params), 'my_returned')).toBe(0);
    expect(count(await todo(f.manager.params), 'expense_review')).toBe(0);
  });

  it('AC-2: approved expenses and draft payroll are counted for the payroll role only', async () => {
    const own = await submittedExpense(f.bob.params, '2026-09-11');
    await call(f.db, f.manager.params, 'review_expense', {
      expenseId: own.id,
      expectedVersion: own.version,
      decision: 'approve',
      reason: '証憑と用務を確認',
    });
    await f.db.run(f.payroll.params, async (ctx) => {
      const policy = (await repo(ctx, WorkforcePayPolicy).list({ limit: 1 })).items[0];
      if (!policy) throw new Error('Missing fixture policy');
      await repo(ctx, WorkforcePayTerms).create({
        employeeId: f.otherEmployee.id,
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
    await call(f.db, f.payroll.params, 'calculate_payroll', {
      employeeId: f.otherEmployee.id,
      period: '2026-08',
      attendanceCompleteConfirmed: true,
    });
    const payroll = await todo(f.payroll.params);
    expect(payroll.items.map((item) => [item.key, item.count, item.href, item.severity])).toEqual([
      ['expense_settlement', 1, '/workforce?period=2026-09', 'info'],
      ['payroll_confirmation', 1, '/workforce?tab=payroll&period=2026-08', 'warn'],
    ]);
    for (const person of [f.manager, f.hr, f.bob])
      expect((await todo(person.params)).items.map((item) => item.key)).not.toContain('payroll_confirmation');
  });

  it('AC-3: a role outside workforce cannot run the provider and does not see it in /meta', async () => {
    const outsider = { roles: ['sales'], actor: { type: 'user' as const, id: newId() } };
    await expect(
      f.db.run({ ...outsider, ...at(NOW) }, (ctx) => runAction(ctx, 'workforce.todo', {})),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const names = (params: Partial<ContextParams>) =>
      f.db.run(params, async (ctx) => appMeta(ctx).actions.map((action) => action.name));
    expect(await names(outsider)).not.toContain('workforce.todo');
    expect(await names(f.alice.params)).toContain('workforce.todo');
    await expect(
      f.db.run({ ...f.manager.params, ...at(NOW) }, (ctx) => runAction(ctx, 'workforce.todo', { extra: true })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
