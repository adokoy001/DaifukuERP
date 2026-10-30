// Postgres tests for the payroll part of docs/specs/cash-forecast.md (D-4 `payroll`, AC-8, AC-14): confirmed payroll
// with published payment evidence is scheduled on its payment date and summed per date; payroll paid before today,
// drafts and cancelled payroll are left out; confirmed payroll without evidence is only counted; a caller without
// payroll access gets the repository refusal. Payroll is created through the public workforce actions.
import { repo, type ContextParams } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deductionKinds } from '../src/contract.ts';
import { payrollCashSchedule, WorkforcePayPolicy, WorkforcePayTerms } from '../src/index.ts';
import { call, fixture, type Command, type Fixture } from './helpers.ts';

let f: Fixture;
const TODAY = '2026-09-12';
const OCTOBER = '2026-10-02T09:00:00+09:00';

async function monthlyTerms(employeeId: string) {
  await f.db.run(f.payroll.params, async (ctx) => {
    const policy = (
      await repo(ctx, WorkforcePayPolicy).list({
        where: { validFrom: { $lte: '2026-01-01' }, validTo: { $gte: '2026-10-31' } },
      })
    ).items[0];
    if (!policy) throw new Error('Missing fixture policy');
    await repo(ctx, WorkforcePayTerms).create({
      employeeId,
      policyId: policy.id,
      validFrom: '2026-01-01',
      validTo: policy.validTo < '2026-12-31' ? policy.validTo : '2026-12-31',
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

async function payroll(
  employeeId: string,
  period: string,
  opts: { confirm?: boolean; paymentDate?: string; time?: string } = {},
): Promise<Command> {
  const draft = await call(
    f.db,
    f.payroll.params,
    'calculate_payroll',
    { employeeId, period, expectedVersion: 0, attendanceCompleteConfirmed: true },
    opts.time,
  );
  if (opts.confirm === false) return draft;
  const confirmed = await call(
    f.db,
    f.payroll.params,
    'confirm_payroll',
    {
      payrollId: draft.id,
      expectedVersion: draft.version,
      deductions: deductionKinds.map((kind) => ({
        kind,
        amount: kind === 'income_tax' ? '1000' : kind === 'health_insurance' ? '2000' : '0',
        basis: '合成原票の値',
        confirmed: true,
      })),
      allowances: [],
      calculationConfirmed: true,
      reason: '全控除・金額の合成根拠確認',
    },
    opts.time,
  );
  if (opts.paymentDate)
    await call(
      f.db,
      f.payroll.params,
      'record_payroll_tax_evidence',
      {
        payrollId: confirmed.id,
        paymentDate: opts.paymentDate,
        taxablePay: '300000',
        basis: '合成支払記録',
        verified: true,
      },
      opts.time,
    );
  return confirmed;
}

const schedule = (params: Partial<ContextParams>, to = '2026-10-31') =>
  f.db.run(params, (ctx) => payrollCashSchedule(ctx, { today: TODAY, to }));

let bobAugust: Command;

beforeAll(async () => {
  f = await fixture();
  await monthlyTerms(f.employee.id);
  await monthlyTerms(f.otherEmployee.id);
  await payroll(f.employee.id, '2026-07', { paymentDate: '2026-08-10' });
  await payroll(f.employee.id, '2026-08', { paymentDate: '2026-09-25' });
  bobAugust = await payroll(f.otherEmployee.id, '2026-08', { paymentDate: '2026-09-25' });
  await payroll(f.employee.id, '2026-09', { confirm: false, time: OCTOBER });
  await payroll(f.otherEmployee.id, '2026-09', { time: OCTOBER });
});
afterAll(async () => {
  await f?.db.close();
});

describe('payroll cash schedule (cash-forecast AC-8)', () => {
  it('AC-8: confirmed payroll with evidence is summed per payment date; paid-before-today, drafts and missing evidence stay out', async () => {
    const result = await schedule(f.payroll.params);
    expect(result.days.map((d) => [d.paymentDate, d.count, d.netPay.toString()])).toEqual([
      ['2026-09-25', 2, '594000'],
    ]);
    // bob's confirmed September has no payment evidence; alice's September is a draft
    expect(result.unscheduled.count).toBe(1);
    expect(result.unscheduled.netPay.toString()).toBe('297000');
    // nothing paid after `to`; the unscheduled window is the previous month .. the month of `to`
    const short = await schedule(f.payroll.params, '2026-09-24');
    expect(short.days).toEqual([]);
    expect(short.unscheduled.count).toBe(1);
    expect((await schedule(f.payroll.params, '2026-08-31')).unscheduled.count).toBe(0);
  });

  it('AC-8: cancelled payroll leaves the schedule even though its evidence row remains', async () => {
    await call(f.db, f.payroll.params, 'cancel_payroll', {
      payrollId: bobAugust.id,
      expectedVersion: bobAugust.version,
      reason: '支給額の誤りを取消',
    });
    const result = await schedule(f.payroll.params);
    expect(result.days.map((d) => [d.paymentDate, d.count, d.netPay.toString()])).toEqual([
      ['2026-09-25', 1, '297000'],
    ]);
  });

  it('AC-14: a caller without payroll read gets the repository refusal and no amount', async () => {
    for (const roles of [['accounting'], ['workforce_hr']])
      await expect(schedule({ roles, actor: { type: 'user', id: f.hr.id } })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    const admin = await f.db.run({}, (ctx) => payrollCashSchedule(ctx, { today: TODAY, to: '2026-10-31' }));
    expect(admin.days).toHaveLength(1);
  });
});
