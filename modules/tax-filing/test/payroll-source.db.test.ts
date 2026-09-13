import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { newId, repo, registry, runAction, type ContextParams } from '@daifuku/kernel';
import {
  WorkforceSite,
  WorkforcePayPolicy,
  WorkforcePayTerms,
  deductionKinds,
  seedWorkforce,
} from '@daifuku/mod-workforce';
import { FILING_PROFILE_OVERRIDE, type CountryFilingProfile, type FilingDetail } from '../src/index.ts';
const profile: CountryFilingProfile = {
  kind: 'payroll',
  option: {
    code: 'test-payment-year',
    name: 'Synthetic preparation profile',
    version: '1',
    from: '2026-01-01',
    to: '2026-12-31',
    taxYears: [2026],
    categories: [],
    sources: [],
  },
  prepare: (s) => ({
    statements: [],
    payrollRows: s.payrollRows,
    issues: s.issues,
    totals: s.totals,
    officialImport: false,
    notice: 'Synthetic test only',
  }),
  export: () => [],
};
registry.registerOverride(FILING_PROFILE_OVERRIDE, () => [profile]);
let db: TestDb;
let employeeId: string;
type Command = { id: string; version: number };
const reviewer = { actor: { type: 'user' as const, id: newId() }, roles: ['workforce_payroll'] };
const run = <T>(name: string, input: unknown, params: Partial<ContextParams> = {}) =>
  db.run({ now: () => new Date('2027-02-01T00:00:00Z'), ...params }, (ctx) =>
    runAction(ctx, name, input),
  ) as Promise<T>;
const pay = (name: string, input: unknown) => run<Command>('workforce.' + name, input, reviewer);
const request = () => ({ taxYear: 2026, idempotencyKey: newId(), annualScopeConfirmed: true });
beforeAll(async () => {
  db = await freshDb();
  employeeId = await db.run({}, async (ctx) => {
    await seedWorkforce(ctx);
    const site = await repo(ctx, WorkforceSite).create({ code: 'P', name: '合成給与拠点' });
    const employee = (await runAction(ctx, 'workforce.register_employee', {
      userId: db.adminUserId,
      siteId: site.id,
      code: 'P',
      name: '合成社員',
      hiredOn: '2025-11-01',
    })) as Command;
    const policy = (await repo(ctx, WorkforcePayPolicy).list()).items[0];
    if (!policy) throw new Error('Missing policy');
    await repo(ctx, WorkforcePayTerms).create({
      employeeId: employee.id,
      policyId: policy.id,
      validFrom: '2025-10-01',
      validTo: '2026-12-31',
      payType: 'monthly',
      hourlyRate: '0',
      monthlySalary: '300000',
      monthlyBaseMinutes: 9600,
      paidLeaveDayMinutes: 480,
      confirmed: true,
      basis: '合成検証条件',
    });
    return employee.id;
  });
  await run('tax_filing.save_payroll_profile', {
    expectedVersion: 0,
    countryProfile: profile.option.code,
    taxYear: 2026,
    legalName: '合成試験',
    payerAddress: '合成所在地',
    payerPhone: '0000000000',
    recipients: [],
    basis: '合成原票確認',
  });
});
afterAll(async () => {
  await db?.close();
});
async function confirmedPayroll(period: string, paymentDate?: string) {
  const draft = await pay('calculate_payroll', {
    employeeId,
    period,
    expectedVersion: 0,
    attendanceCompleteConfirmed: true,
  });
  const confirmed = await pay('confirm_payroll', {
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
  });
  if (paymentDate)
    await pay('record_payroll_tax_evidence', {
      payrollId: confirmed.id,
      paymentDate,
      taxablePay: '300000',
      basis: '合成支払記録',
      verified: true,
    });
  return confirmed;
}
describe('payroll filing payment-year evidence', () => {
  it('includes prior December paid this January and excludes this December paid next January', async () => {
    await confirmedPayroll('2025-11', '2025-12-31');
    await confirmedPayroll('2025-12', '2026-01-01');
    await confirmedPayroll('2026-12', '2027-01-01');
    const created = await run<Command>('tax_filing.prepare_payroll', request());
    const detail = await run<FilingDetail>('tax_filing.get', { kind: 'payroll', id: created.id });
    expect(detail.payrollRows[0]).toMatchObject({
      payrollCount: 1,
      taxablePay: '300000',
      socialPremium: '2000',
      withheldTax: '1000',
      annualTax: null,
    });
    expect(detail.issues.map((i) => i.code)).not.toContain('payroll_evidence_missing');
  });
  it('marks a partial year unknown instead of summing only the months with evidence', async () => {
    await confirmedPayroll('2026-11');
    const created = await run<Command>('tax_filing.prepare_payroll', request());
    const detail = await run<FilingDetail>('tax_filing.get', { kind: 'payroll', id: created.id });
    expect(detail.payrollRows[0]).toMatchObject({
      payrollCount: 1,
      taxablePay: null,
      socialPremium: null,
      withheldTax: null,
    });
    expect(detail.totals.taxablePay).toBeNull();
    expect(detail.issues.map((i) => i.code)).toContain('payroll_evidence_missing');
  });
});
