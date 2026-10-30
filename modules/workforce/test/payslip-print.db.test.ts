// docs/specs/print-templates.md AC-9, AC-16, AC-17, AC-19, AC-21: workforce.render_payslip_html against Postgres with
// the workforce row rules (ADR-0019) — employees, managers and HR print only their own confirmed payslip (the employee
// and the manager from a site-limited context), other people's and other companies' payslips are NOT_FOUND, payroll
// prints the company's, drafts are refused (INVALID_STATE for payroll, NOT_FOUND for the employee), cancelled ones
// carry the banner, and the issuer is the company profile without a registration number. Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  companies,
  COMPANY_PROFILE_KEY,
  companyProfileSchema,
  ensureCompanyProfileSetting,
  newId,
  NotFound,
  PermissionDenied,
  repo,
  runAction,
  setSetting,
  type ContextParams,
} from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deductionKinds } from '../src/contract.ts';
import { WorkforcePayPolicy, WorkforcePayTerms } from '../src/index.ts';
import { at, call, fixture, NOW, type Command, type Fixture } from './helpers.ts';

let f: Fixture;
let august: Command;
const PAYSLIP = 'workforce.render_payslip_html';
const render = (person: Partial<ContextParams>, id: string) =>
  f.db.run(
    { ...person, ...at(NOW) },
    async (ctx) => ((await runAction(ctx, PAYSLIP, { id })) as { html: string }).html,
  );

/** Confirmed hourly pay terms for an employee (payroll headquarters). */
async function payTerms(employeeId: string): Promise<void> {
  await f.db.run(f.payroll.params, async (ctx) => {
    const policy = (
      await repo(ctx, WorkforcePayPolicy).list({
        where: { validFrom: { $lte: '2026-01-01' }, validTo: { $gte: '2026-09-30' } },
      })
    ).items[0];
    if (!policy) throw new Error('Missing fixture policy');
    await repo(ctx, WorkforcePayTerms).create({
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

/** Registers `person` as an employee of the fixture site and confirms their August payroll; returns its id. */
async function confirmedPayslipOf(person: Fixture['manager'], code: string, name: string): Promise<string> {
  const employee = await call(f.db, f.hr.params, 'register_employee', {
    userId: person.id,
    siteId: f.siteId,
    code,
    name,
    hiredOn: '2026-01-01',
  });
  await payTerms(employee.id);
  const draft = await call(f.db, f.payroll.params, 'calculate_payroll', {
    employeeId: employee.id,
    period: '2026-08',
    attendanceCompleteConfirmed: true,
  });
  const confirmed = await call(f.db, f.payroll.params, 'confirm_payroll', {
    payrollId: draft.id,
    expectedVersion: draft.version,
    deductions: deductionKinds.map((kind) => ({ kind, amount: '0', basis: '該当なしを確認', confirmed: true })),
    allowances: [],
    calculationConfirmed: true,
    reason: '帳票の試験で確定',
  });
  return confirmed.id;
}

beforeAll(async () => {
  ensureCompanyProfileSetting();
  f = await fixture();
  await payTerms(f.employee.id);
  const input = (kind: string, expectedVersion: number) => ({ kind, expectedVersion, idempotencyKey: newId() });
  const opened = await call(f.db, f.alice.params, 'punch', input('clock_in', 0), '2026-08-03T09:00:00+09:00');
  const closed = await call(
    f.db,
    f.alice.params,
    'punch',
    input('clock_out', opened.version),
    '2026-08-03T11:30:00+09:00',
  );
  const submitted = await call(f.db, f.alice.params, 'submit_attendance', {
    attendanceId: closed.id,
    expectedVersion: closed.version,
  });
  await call(f.db, f.manager.params, 'review_attendance', {
    attendanceId: submitted.id,
    expectedVersion: submitted.version,
    decision: 'approve',
    dayKind: 'workday',
    reason: '勤怠と休憩を確認',
  });
  august = await call(f.db, f.payroll.params, 'calculate_payroll', {
    employeeId: f.employee.id,
    period: '2026-08',
    attendanceCompleteConfirmed: true,
  });
}, 120_000);
afterAll(async () => {
  await f?.db.close();
});

describe('workforce.render_payslip_html (docs/specs/print-templates.md)', () => {
  it('AC-16 AC-21 a draft is INVALID_STATE for payroll and invisible (NOT_FOUND) to the employee', async () => {
    await expect(render(f.payroll.params, august.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(render(f.alice.params, august.id)).rejects.toBeInstanceOf(NotFound);
  });

  it('AC-16 AC-21 once confirmed, the employee prints their own payslip from a site-limited context', async () => {
    august = await call(f.db, f.payroll.params, 'confirm_payroll', {
      payrollId: august.id,
      expectedVersion: august.version,
      deductions: deductionKinds.map((kind) => ({
        kind,
        amount: kind === 'income_tax' ? '30' : '0',
        basis: '外部算定結果を確認',
        confirmed: true,
      })),
      allowances: [{ name: '通勤手当', amount: '500', basis: '定期代' }],
      calculationConfirmed: true,
      reason: '全項目の外部算定と賃金台帳を確認',
    });
    expect(f.alice.params.accessScope).toBe('sites');
    const html = await render(f.alice.params, august.id);
    for (const s of [
      '>給与明細<',
      '2026年8月分',
      'Alice 様',
      '従業員コード: A',
      '所属: 東拠点',
      '>通常賃金<',
      '>3,000<', // 2.5 h x 1,200
      '>通勤手当<',
      '>500<',
      '>所得税<',
      '>30<',
      '3,470円', // 3,000 + 500 - 30
      '>2:30<',
      'テスト株式会社',
    ])
      expect(html).toContain(s);
    expect(html).not.toContain('外部算定結果を確認'); // basis text is not printed
    expect(html).not.toContain('定期代');
  });

  it('AC-21 other employees, managers and HR cannot print it (NOT_FOUND); payroll can', async () => {
    for (const person of [f.bob, f.manager, f.remote, f.hr])
      await expect(render(person.params, august.id)).rejects.toBeInstanceOf(NotFound);
    expect(await render(f.payroll.params, august.id)).toContain('Alice 様');
  });

  it("AC-21 managers and HR print their own confirmed payslip (the same self row rule), not each other's", async () => {
    const own = {
      manager: await confirmedPayslipOf(f.manager, 'M', 'Manager'),
      hr: await confirmedPayslipOf(f.hr, 'H', 'HR'),
    };
    expect(f.manager.params.accessScope).toBe('sites');
    const managerSlip = await render(f.manager.params, own.manager);
    expect(managerSlip).toContain('Manager 様');
    expect(managerSlip).toContain('従業員コード: M');
    const hrSlip = await render(f.hr.params, own.hr);
    expect(hrSlip).toContain('HR 様');
    expect(hrSlip).toContain('従業員コード: H');
    await expect(render(f.manager.params, own.hr)).rejects.toBeInstanceOf(NotFound);
    await expect(render(f.hr.params, own.manager)).rejects.toBeInstanceOf(NotFound);
    await expect(render(f.alice.params, own.manager)).rejects.toBeInstanceOf(NotFound);
    expect(await render(f.payroll.params, own.hr)).toContain('HR 様');
  });

  it('AC-19 another company is NOT_FOUND; a role outside workforce is refused and has no print declaration', async () => {
    const otherCompanyId = newId();
    await f.db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: f.db.tenantId, code: 'OTHER-W', name: '別会社' });
    await expect(render({ ...f.payroll.params, companyId: otherCompanyId }, august.id)).rejects.toBeInstanceOf(
      NotFound,
    );
    const outsider = { roles: ['sales'], actor: { type: 'user' as const, id: newId() } };
    await expect(render(outsider, august.id)).rejects.toBeInstanceOf(PermissionDenied);
    const names = await f.db.run(outsider, async (ctx) => appMeta(ctx).actions.map((a) => a.name));
    expect(names).not.toContain(PAYSLIP);
    const mine = await f.db.run(f.alice.params, async (ctx) => appMeta(ctx).actions);
    expect(mine.find((a) => a.name === PAYSLIP)?.print).toEqual({
      entity: 'workforce_payroll',
      label: { ja: '給与明細を表示', en: 'View payslip' },
      idInput: 'id',
    });
  });

  it('AC-9 the issuer is company.profile (legal name, address) without the registration number', async () => {
    await f.db.run({}, (ctx) =>
      setSetting(ctx, COMPANY_PROFILE_KEY, companyProfileSchema, {
        legalName: '株式会社テスト本社',
        invoiceRegistrationNo: 'T9999999999999',
        address: '東京都港区9-9',
        email: 'payroll@example.com',
      }),
    );
    const html = await render(f.alice.params, august.id);
    expect(html).toContain('株式会社テスト本社');
    expect(html).toContain('東京都港区9-9');
    expect(html).not.toContain('T9999999999999');
    expect(html).not.toContain('payroll@example.com');
  });

  it('AC-17 a cancelled payslip carries the cancelled banner for payroll and disappears for the employee', async () => {
    await call(f.db, f.payroll.params, 'cancel_payroll', {
      payrollId: august.id,
      expectedVersion: august.version,
      reason: '帳票の試験で取消',
    });
    expect(await render(f.payroll.params, august.id)).toContain('取消済み / CANCELLED');
    await expect(render(f.alice.params, august.id)).rejects.toBeInstanceOf(NotFound);
  });
});
