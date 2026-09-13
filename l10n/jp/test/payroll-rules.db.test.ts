import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import {
  bootstrapTenant,
  companies,
  companyMemberships,
  newId,
  defineWriteCapability,
  withWriteCapability,
  repo,
  runAction,
  registry,
  PermissionDenied,
  StateError,
  Decimal,
  type Context,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import {
  WorkforcePayrollRules,
  WorkforcePayrollRuleRelease,
  PAYROLL_RULE_PROVIDERS_OVERRIDE,
  resolveMonthlyRules,
  resolveYearEndRules,
  supportedPayrollTaxYears,
  validatePayrollCondition,
  payloadHash,
  manifestHash,
  type PayrollRuleBundle,
} from '@daifuku/mod-workforce';
import type { PayrollRuleCatalog, PayrollRulePreview } from '@daifuku/mod-workforce/payroll-rules-contract';
import {
  registerJapanPayrollProvider,
  JAPAN_PAYROLL_PROVIDER,
  createJapanPayrollProvider,
} from '../src/payroll/provider.ts';
import { payrollDataSchema } from '../src/payroll/schema.ts';
import { condition } from './payroll-fixtures.ts';
import '../src/module.ts';

let db: TestDb;
const payroll = { roles: ['workforce_payroll'], accessScope: 'all' as const };
const monthly = { paymentDate: '2026-09-10', insurancePeriod: '2026-08', wagePeriod: '2026-08' };
const originalBundle = JAPAN_PAYROLL_PROVIDER.bundles()[0];
if (!originalBundle) throw new Error('Missing synthetic baseline');
const legacy = structuredClone(originalBundle);
const fixtureCapability = defineWriteCapability({
  name: 'test.legacy-payroll-rule',
  entity: WorkforcePayrollRules.name,
  fields: ['code', 'taxYear', 'data', 'sources', 'verifiedOn'],
  operations: ['create', 'workflow'],
});
const action = <T>(name: string, input: unknown, params = payroll) =>
  db.run(params, (ctx) => runAction(ctx, `workforce.${name}`, input)) as Promise<T>;
const installInput = (bundle: PayrollRuleBundle) => ({
  packageCode: bundle.manifest.packageCode,
  expectedPayloadHash: payloadHash(bundle),
  expectedManifestHash: manifestHash(bundle.manifest),
  sourcesReviewed: true,
  basis: '合成試験の資料・適用日・出典を確認',
});
function register(bundles: PayrollRuleBundle[]) {
  registry.registerOverride(PAYROLL_RULE_PROVIDERS_OVERRIDE, () => [createJapanPayrollProvider(bundles)]);
}
function revisedBundle(code: string, revision = 2): PayrollRuleBundle {
  const bundle = structuredClone(legacy),
    data = payrollDataSchema.parse(bundle.data);
  bundle.code = data.code = bundle.manifest.packageCode = code;
  bundle.manifest.revision = revision;
  bundle.manifest.supersedesPackageCode = legacy.manifest.packageCode;
  const parameters = { ...bundle.manifest.parameters };
  delete parameters.legacySnapshotSchema;
  bundle.manifest.parameters = parameters;
  data.monthlyTax.dependent = 100000;
  bundle.data = data;
  return bundle;
}
function futureBundle(): PayrollRuleBundle {
  const bundle = JSON.parse(JSON.stringify(legacy), (_key: string, value: unknown) =>
    typeof value === 'string' && /^202[567]-\d{2}(?:-\d{2})?$/.test(value)
      ? `${Number(value.slice(0, 4)) + 11}${value.slice(4)}`
      : value,
  ) as PayrollRuleBundle;
  const data = payrollDataSchema.parse(bundle.data);
  bundle.code = data.code = bundle.manifest.packageCode = 'synthetic-2037-not-law';
  bundle.taxYear = data.taxYear = bundle.manifest.taxYear = data.annualTax.year = data.deductions.year = 2037;
  bundle.data = data;
  const parameters = { ...bundle.manifest.parameters };
  delete parameters.legacySnapshotSchema;
  bundle.manifest.parameters = parameters;
  bundle.sources = ['https://example.invalid/synthetic-payroll-not-law'];
  return bundle;
}
async function createLegacy(ctx: Context, bundle = legacy) {
  return withWriteCapability(ctx, fixtureCapability, (write) =>
    repo(write, WorkforcePayrollRules).create({
      code: bundle.code,
      taxYear: bundle.taxYear,
      data: bundle.data,
      sources: [...bundle.sources],
      verifiedOn: bundle.verifiedOn,
    }),
  );
}
async function sameTenantCompany() {
  const companyId = newId();
  await db.owner.drizzle
    .insert(companies)
    .values({ id: companyId, tenantId: db.tenantId, code: 'SAME-TENANT', name: 'Synthetic second company' });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, companyId, userId: db.adminUserId, roles: ['admin'], accessScope: 'all' });
  return { tenantId: db.tenantId, companyId, userId: db.adminUserId };
}
beforeAll(async () => {
  registerJapanPayrollProvider();
  db = await freshDb();
});
afterEach(() => registerJapanPayrollProvider());
afterAll(async () => {
  await db?.close();
});

describe('company approved payroll rule releases', () => {
  it('offers verified candidates without silently installing or marking them supported', async () => {
    const catalog = await action<PayrollRuleCatalog>('payroll_rule_catalog', {});
    expect(catalog.supportedTaxYears).toEqual([]);
    expect(catalog.bundles).toHaveLength(1);
    expect(catalog.bundles[0]?.status).toBe('available');
    const preview = await action<PayrollRulePreview>('preview_payroll_rule', {
      packageCode: legacy.manifest.packageCode,
    });
    expect(preview.canInstall).toBe(true);
    expect(preview.issues).toEqual([]);
    expect(preview.affectedDrafts).toEqual({ payroll: 0, yearEnd: 0 });
    expect(await db.run(payroll, (ctx) => repo(ctx, WorkforcePayrollRules).count())).toBe(0);
    await expect(db.run(payroll, (ctx) => resolveMonthlyRules(ctx, monthly))).rejects.toBeInstanceOf(StateError);
  });
  it('requires company payroll authority, explicit review and matching content hashes', async () => {
    for (const roles of [['workforce_employee'], ['workforce_manager'], ['workforce_hr']])
      await expect(action('payroll_rule_catalog', {}, { roles, accessScope: 'all' })).rejects.toBeInstanceOf(
        PermissionDenied,
      );
    await expect(
      db.run({ ...payroll, accessScope: 'sites', siteIds: [] }, (ctx) =>
        runAction(ctx, 'workforce.install_payroll_rule', installInput(legacy)),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(action('install_payroll_rule', { ...installInput(legacy), sourcesReviewed: false })).rejects.toThrow();
    await expect(
      action('install_payroll_rule', { ...installInput(legacy), expectedPayloadHash: '0'.repeat(64) }),
    ).rejects.toBeInstanceOf(StateError);
    await expect(
      action('install_payroll_rule', { ...installInput(legacy), expectedManifestHash: '0'.repeat(64) }),
    ).rejects.toBeInstanceOf(StateError);
    expect(await db.run(payroll, (ctx) => repo(ctx, WorkforcePayrollRuleRelease).count())).toBe(0);
  });
  it('adopts an exact legacy row without modifying it or changing the comparison selection', async () => {
    const before = await db.run(payroll, (ctx) => createLegacy(ctx));
    const selectedBefore = await db.run(payroll, (ctx) => resolveMonthlyRules(ctx, monthly));
    expect(selectedBefore.legacyCompatible).toBe(true);
    expect((await action<PayrollRuleCatalog>('payroll_rule_catalog', {})).bundles[0]?.status).toBe('legacy');
    const results = await Promise.all([
      action<{ alreadyInstalled: boolean }>('install_payroll_rule', installInput(legacy)),
      action<{ alreadyInstalled: boolean }>('install_payroll_rule', installInput(legacy)),
    ]);
    expect(results.map((r) => r.alreadyInstalled).sort()).toEqual([false, true]);
    const selectedAfter = await db.run(payroll, (ctx) => resolveMonthlyRules(ctx, monthly));
    expect(selectedAfter.row).toEqual(before);
    expect(selectedAfter.selection).toEqual(selectedBefore.selection);
    expect(selectedAfter.bundle.data).toEqual(before.data);
    expect(selectedAfter.selection).not.toHaveProperty('approvedAt');
    expect(selectedAfter.selection).not.toHaveProperty('releaseId');
    expect(await db.run(payroll, (ctx) => repo(ctx, WorkforcePayrollRuleRelease).count())).toBe(1);
    expect((await action<PayrollRuleCatalog>('payroll_rule_catalog', {})).supportedTaxYears).toEqual([2026]);
  });
  it('keeps rule data and companion approvals immutable through all generic paths', async () => {
    const release = await db.run(
      payroll,
      async (ctx) => (await repo(ctx, WorkforcePayrollRuleRelease).list()).items[0],
    );
    if (!release) throw new Error('Missing approval fixture');
    await expect(
      db.run({}, (ctx) =>
        repo(ctx, WorkforcePayrollRuleRelease).update(
          release.id,
          { approvalBasis: 'tampered' },
          { expectedVersion: release.version },
        ),
      ),
    ).rejects.toThrow();
    await expect(db.run({}, (ctx) => repo(ctx, WorkforcePayrollRuleRelease).delete(release.id))).rejects.toThrow();
    await expect(
      db.run(payroll, (ctx) =>
        repo(ctx, WorkforcePayrollRules).create({
          code: 'untrusted',
          taxYear: 2026,
          data: {},
          sources: [],
          verifiedOn: '2026-09-12',
        }),
      ),
    ).rejects.toThrow();
  });
  it('selects payment date, insurance month and wage cutoff independently at their exact boundaries', async () => {
    for (const input of [
      { paymentDate: '2026-01-01', insurancePeriod: '2025-12', wagePeriod: '2025-12' },
      { paymentDate: '2026-12-31', insurancePeriod: '2026-12', wagePeriod: '2026-12' },
    ])
      expect((await db.run(payroll, (ctx) => resolveMonthlyRules(ctx, input))).bundle.taxYear).toBe(2026);
    for (const input of [
      { ...monthly, paymentDate: '2025-12-31' },
      { ...monthly, paymentDate: '2027-01-01' },
      { ...monthly, insurancePeriod: '2025-11' },
      { ...monthly, insurancePeriod: '2027-01' },
      { ...monthly, wagePeriod: '2025-11' },
      { ...monthly, wagePeriod: '2027-01' },
    ])
      await expect(db.run(payroll, (ctx) => resolveMonthlyRules(ctx, input))).rejects.toBeInstanceOf(StateError);
    for (const adjustedOn of ['2026-12-01', '2027-01-31'])
      expect(
        (await db.run(payroll, (ctx) => resolveYearEndRules(ctx, { taxYear: 2026, adjustedOn }))).bundle.taxYear,
      ).toBe(2026);
    for (const adjustedOn of ['2026-11-30', '2027-02-01'])
      await expect(
        db.run(payroll, (ctx) => resolveYearEndRules(ctx, { taxYear: 2026, adjustedOn })),
      ).rejects.toBeInstanceOf(StateError);
    await expect(
      db.run(payroll, (ctx) => resolveYearEndRules(ctx, { taxYear: 2027, adjustedOn: '2027-01-01' })),
    ).rejects.toBeInstanceOf(StateError);
  });
  it('rejects unverified condition years and grades while preserving the prior December insurance conditions', async () => {
    await db.run(payroll, (ctx) => validatePayrollCondition(ctx, condition()));
    await expect(
      db.run(payroll, (ctx) => validatePayrollCondition(ctx, condition({ validTo: '2027-01-01' }))),
    ).rejects.toBeInstanceOf(StateError);
    await expect(
      db.run(payroll, (ctx) => validatePayrollCondition(ctx, condition({ healthStandardMonthly: '123456' }))),
    ).rejects.toThrow();
    registry.registerOverride(PAYROLL_RULE_PROVIDERS_OVERRIDE, () => []);
    expect(await db.run(payroll, supportedPayrollTaxYears)).toEqual([]);
    await expect(db.run(payroll, (ctx) => resolveMonthlyRules(ctx, monthly))).rejects.toBeInstanceOf(StateError);
  });
  it('rejects an unknown legacy payload and does not present its year as supported', async () => {
    await expect(
      db.run(payroll, async (ctx) => {
        await createLegacy(ctx, { ...legacy, code: 'unrecognized-legacy' });
        await expect(resolveMonthlyRules(ctx, monthly)).rejects.toBeInstanceOf(StateError);
        expect(await supportedPayrollTaxYears(ctx)).toEqual([]);
        throw new Error('rollback synthetic corruption');
      }),
    ).rejects.toThrow('rollback synthetic corruption');
  });
  it('rejects overlapping packages without a valid replacement and preserves originals on correction', async () => {
    const revision = revisedBundle('synthetic-2026-revision-2'),
      conflict = revisedBundle('synthetic-2026-conflict');
    delete conflict.manifest.supersedesPackageCode;
    register([legacy, revision, conflict]);
    const bad = await action<PayrollRulePreview>('preview_payroll_rule', {
      packageCode: conflict.manifest.packageCode,
    });
    expect(bad.canInstall).toBe(false);
    expect(bad.issues).not.toEqual([]);
    await expect(action('install_payroll_rule', installInput(conflict))).rejects.toBeInstanceOf(StateError);
    const before = await db.run(payroll, (ctx) => resolveMonthlyRules(ctx, monthly));
    // Roll back the corrected installation so later tests retain the production-only distribution.
    await expect(
      db.run(payroll, async (ctx) => {
        await runAction(ctx, 'workforce.install_payroll_rule', installInput(revision));
        const after = await resolveMonthlyRules(ctx, monthly);
        expect(after.legacyCompatible).toBe(false);
        expect(after.selection).not.toEqual(before.selection);
        expect(after.bundle.code).toBe(revision.code);
        expect(await repo(ctx, WorkforcePayrollRules).get(before.row.id)).toEqual(before.row);
        const value = after.provider
          .monthly(after.bundle, Decimal.from(300000), Decimal.from(45000), 1)
          .incomeTax.toString();
        expect(value).toBe('1200');
        const fork = revisedBundle('synthetic-2026-fork', 3);
        register([legacy, revision, fork]);
        const preview = (await runAction(ctx, 'workforce.preview_payroll_rule', {
          packageCode: fork.manifest.packageCode,
        })) as PayrollRulePreview;
        expect(preview.canInstall).toBe(false);
        throw new Error('rollback synthetic correction');
      }),
    ).rejects.toThrow('rollback synthetic correction');
  });
  it('separates approved rules by tenant and company', async () => {
    for (const tenantId of [undefined, db.tenantId]) {
      const other = tenantId
        ? await sameTenantCompany()
        : await bootstrapTenant(db.owner, {
            tenantName: 'Other rule tenant',
            companyCode: 'OTHER',
            companyName: 'Other rules company',
            adminEmail: 'other-rules@example.invalid',
            adminName: 'Synthetic reviewer',
            adminPassword: 'synthetic-fixture-password',
          });
      await db.run(
        {
          tenantId: other.tenantId,
          companyId: other.companyId,
          actor: { type: 'user', id: other.userId },
          roles: ['admin'],
        },
        async (ctx) => {
          expect(await repo(ctx, WorkforcePayrollRules).count()).toBe(0);
          expect(await repo(ctx, WorkforcePayrollRuleRelease).count()).toBe(0);
          expect(await supportedPayrollTaxYears(ctx)).toEqual([]);
          await expect(resolveMonthlyRules(ctx, monthly)).rejects.toBeInstanceOf(StateError);
        },
      );
      expect(await db.run(payroll, supportedPayrollTaxYears)).toEqual([2026]);
    }
  });
  it('rejects a recognized legacy code whose saved content differs from the verified payload', async () => {
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Corrupt rule test',
      companyCode: 'CORRUPT',
      companyName: 'Corrupt rule fixture',
      adminEmail: 'corrupt-rule@example.invalid',
      adminName: 'Synthetic reviewer',
      adminPassword: 'synthetic-fixture-password',
    });
    await db.run(
      {
        tenantId: other.tenantId,
        companyId: other.companyId,
        actor: { type: 'user', id: other.userId },
        roles: ['admin'],
      },
      async (ctx) => {
        await createLegacy(ctx, { ...legacy, sources: [...legacy.sources, 'https://example.invalid/tampered-source'] });
        await expect(resolveMonthlyRules(ctx, monthly)).rejects.toBeInstanceOf(StateError);
        expect(await supportedPayrollTaxYears(ctx)).toEqual([]);
        await expect(runAction(ctx, 'workforce.install_payroll_rule', installInput(legacy))).rejects.toBeInstanceOf(
          StateError,
        );
      },
    );
  });
  it('installs a synthetic future year without any production fallback or algorithm-year edits', async () => {
    const future = futureBundle();
    register([legacy, future]);
    expect(await db.run(payroll, supportedPayrollTaxYears)).toEqual([2026]);
    await expect(
      db.run(payroll, async (ctx) => {
        await runAction(ctx, 'workforce.install_payroll_rule', installInput(future));
        expect(await supportedPayrollTaxYears(ctx)).toEqual([2026, 2037]);
        const selected = await resolveMonthlyRules(ctx, {
          paymentDate: '2037-09-10',
          insurancePeriod: '2037-08',
          wagePeriod: '2037-08',
        });
        expect(selected.legacyCompatible).toBe(false);
        expect(selected.bundle.taxYear).toBe(2037);
        expect(
          selected.provider.monthly(selected.bundle, Decimal.from(300000), Decimal.from(45000), 0).incomeTax.toString(),
        ).toBe(
          JAPAN_PAYROLL_PROVIDER.monthly(legacy, Decimal.from(300000), Decimal.from(45000), 0).incomeTax.toString(),
        );
        throw new Error('rollback synthetic future');
      }),
    ).rejects.toThrow('rollback synthetic future');
  });
});
