// docs/specs/inbox.md AC-1..AC-3: tax_filing.todo counts draft preparations another person prepared, per kind the
// caller may confirm (company-wide accounting / payroll); the preparer's own drafts and other kinds are left out.
import {
  appMeta,
  newId,
  PermissionDenied,
  registry,
  repo,
  runAction,
  todoResult,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { openFiscalYear } from '@daifuku/mod-accounting';
import { seedWorkforce, WorkforceSite } from '@daifuku/mod-workforce';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FILING_PROFILE_OVERRIDE, type CountryFilingProfile } from '../src/index.ts';

const profile: CountryFilingProfile = {
  kind: 'payroll',
  option: {
    code: 'test-inbox-year',
    name: 'Synthetic inbox profile',
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
const accountingProfile: CountryFilingProfile = {
  ...profile,
  kind: 'accounting',
  option: { ...profile.option, code: 'test-inbox-accounting', taxYears: [] },
};
registry.registerOverride(FILING_PROFILE_OVERRIDE, () => [profile, accountingProfile]);
let db: TestDb;
type Command = { id: string; version: number };
const NOW = new Date('2027-02-01T00:00:00Z');
const run = <T>(name: string, input: unknown, params: Partial<ContextParams> = {}) =>
  db.run({ now: () => NOW, ...params }, (ctx) => runAction(ctx, name, input)) as Promise<T>;
const todo = async (params: Partial<ContextParams> = {}) => todoResult.parse(await run('tax_filing.todo', {}, params));
const person = (roles: string[]): Partial<ContextParams> => ({ roles, actor: { type: 'user', id: newId() } });
const reviewer = person(['workforce_payroll']);

beforeAll(async () => {
  db = await freshDb();
  await db.run({}, async (ctx) => {
    await seedWorkforce(ctx);
    await repo(ctx, WorkforceSite).create({ code: 'P', name: '合成給与拠点' });
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

describe('tax_filing.todo (docs/specs/inbox.md)', () => {
  it('AC-1 AC-2: a draft is waiting for everyone who may confirm it except its preparer', async () => {
    expect(await todo(reviewer)).toEqual({ items: [] });
    const draft = await run<Command>('tax_filing.prepare_payroll', {
      taxYear: 2026,
      idempotencyKey: newId(),
      annualScopeConfirmed: true,
    }); // prepared by the bootstrap admin
    expect(await todo(reviewer)).toEqual({
      items: [
        {
          key: 'payroll_review',
          label: { ja: '確認待ちの給与申告の準備資料', en: 'Payroll filing preparations awaiting review' },
          count: 1,
          href: '/finance/filing',
          severity: 'info',
        },
      ],
    });
    expect(await todo()).toEqual({ items: [] }); // the preparer cannot confirm their own version
    expect(await todo(person(['accounting']))).toEqual({ items: [] }); // payroll kind is not accounting's
    await run('tax_filing.cancel', { kind: 'payroll', id: draft.id, expectedVersion: draft.version, reason: '取消' });
    expect(await todo(reviewer)).toEqual({ items: [] });
  });

  it('AC-2: a financial statement preparation drafted by another accounting user waits for the other accounting users', async () => {
    const preparer = person(['accounting']);
    const other = person(['accounting']);
    const year = await db.run({ now: () => NOW }, (ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
    await run(
      'tax_filing.save_accounting_profile',
      {
        expectedVersion: 0,
        countryProfile: accountingProfile.option.code,
        entityType: 'corporation',
        accountingBasis: 'tax_exclusive',
        consolidation: 'standalone',
        legalName: '合成試験',
        mappings: [],
        basis: '合成の科目分類確認',
      },
      preparer,
    );
    expect(await todo(other)).toEqual({ items: [] });
    const draft = await run<Command>(
      'tax_filing.prepare_accounting',
      {
        fiscalYearId: year.fiscalYear.id,
        idempotencyKey: newId(),
        incomeTransferNotPostedConfirmed: true,
        taxClassificationReview: '合成の税区分確認',
      },
      preparer,
    );
    expect(await todo(other)).toEqual({
      items: [
        {
          key: 'accounting_review',
          label: { ja: '確認待ちの財務諸表の準備資料', en: 'Financial statement preparations awaiting review' },
          count: 1,
          href: '/finance/filing',
          severity: 'info',
        },
      ],
    });
    expect(await todo()).toMatchObject({ items: [{ key: 'accounting_review', count: 1 }] }); // admin, not the preparer
    expect(await todo(preparer)).toEqual({ items: [] }); // the preparer cannot confirm their own version
    expect(await todo(reviewer)).toEqual({ items: [] }); // accounting kind is not workforce_payroll's
    await run('tax_filing.cancel', {
      kind: 'accounting',
      id: draft.id,
      expectedVersion: draft.version,
      reason: '取消',
    });
    expect(await todo(other)).toEqual({ items: [] });
  });

  it('AC-3: site-limited and unrelated roles are refused and do not see the provider', async () => {
    const siteScoped = { ...person(['workforce_payroll']), accessScope: 'sites' as const, siteIds: [newId()] };
    for (const params of [siteScoped, person(['sales']), person(['workforce_manager'])]) {
      await expect(todo(params)).rejects.toBeInstanceOf(PermissionDenied);
      expect(await db.run(params, async (ctx) => appMeta(ctx).actions.map((a) => a.name))).not.toContain(
        'tax_filing.todo',
      );
    }
  });
});
