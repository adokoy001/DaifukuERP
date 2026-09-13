import { getCompany, registry, StateError, ValidationError, type Context, type Infer } from '@daifuku/kernel';
import { WorkforcePayrollRules, WorkforcePayrollRuleRelease } from '../entities/index.ts';
import { allRows } from '../common.ts';
import { periodBounds, addDays } from '../services/time.ts';
import { payrollRuleManifest } from './contract.ts';
import { payloadHash, manifestHash } from './hash.ts';
import {
  PAYROLL_RULE_PROVIDERS_OVERRIDE,
  type CountryPayrollProvider,
  type PayrollConditionInput,
  type PayrollRuleBundle,
  type PayrollRuleProviders,
  type PayrollRuleRange,
} from './port.ts';

type Rule = Infer<typeof WorkforcePayrollRules>;
type Release = Infer<typeof WorkforcePayrollRuleRelease>;
export interface InstalledPayrollRule {
  row: Rule;
  release: Release | null;
  provider: CountryPayrollProvider;
  bundle: PayrollRuleBundle;
}
export function ruleError(message: string): never {
  throw new StateError(
    message,
    '給与本部で国・通貨、制度資料の導入状態、適用期間と承認版を確認してください。未対応の資料で計算は行いません。',
  );
}
export async function getCompanyPayrollProvider(ctx: Context): Promise<CountryPayrollProvider> {
  const company = await getCompany(ctx);
  const providers = registry
    .override<PayrollRuleProviders>(PAYROLL_RULE_PROVIDERS_OVERRIDE, () => [])()
    .filter((provider) => provider.country === company.country && provider.currency === company.currency);
  if (providers.length !== 1 || !providers[0]) ruleError('会社の国・通貨に対応する給与算定方式が一意にありません');
  return providers[0];
}
export function distributedBundles(provider: CountryPayrollProvider): readonly PayrollRuleBundle[] {
  const bundles = provider.bundles();
  const packages = new Set<string>(),
    codes = new Set<string>();
  for (const bundle of bundles) {
    const manifest = parseManifest(bundle.manifest);
    if (
      manifest.country !== provider.country ||
      manifest.currency !== provider.currency ||
      manifest.taxYear !== bundle.taxYear ||
      packages.has(manifest.packageCode) ||
      codes.has(bundle.code)
    )
      ruleError('配布制度資料の識別情報が不正または重複しています');
    if (
      manifest.applicability.paymentDates.from.slice(0, 4) !== String(bundle.taxYear) ||
      manifest.applicability.paymentDates.to.slice(0, 4) !== String(bundle.taxYear) ||
      manifest.applicability.yearEndFactsOn.slice(0, 4) !== String(bundle.taxYear) ||
      manifest.applicability.requiredFinalPaymentFrom.slice(0, 4) !== String(bundle.taxYear)
    )
      ruleError('制度資料の税年と年末判定日が一致しません');
    provider.validate(bundle);
    packages.add(manifest.packageCode);
    codes.add(bundle.code);
  }
  return bundles;
}
function parseManifest(value: unknown): PayrollRuleBundle['manifest'] {
  const parsed = payrollRuleManifest.safeParse(value);
  if (!parsed.success) ruleError('制度版のmanifest形式が不正です');
  const { supersedesPackageCode, ...manifest } = parsed.data;
  return { ...manifest, ...(supersedesPackageCode ? { supersedesPackageCode } : {}) };
}
function storedBundle(row: Rule, manifest: PayrollRuleBundle['manifest']): PayrollRuleBundle {
  if (!Array.isArray(row.sources) || row.sources.some((source) => typeof source !== 'string'))
    ruleError('制度の出典形式が不正です');
  return {
    code: row.code,
    taxYear: row.taxYear,
    verifiedOn: row.verifiedOn,
    data: row.data,
    sources: row.sources as string[],
    manifest,
  };
}
function validateInstalled(
  provider: CountryPayrollProvider,
  candidate: PayrollRuleBundle,
  row: Rule,
  release: Release | null,
): InstalledPayrollRule {
  const bundle = storedBundle(row, release ? parseManifest(release.manifest) : candidate.manifest);
  if (
    payloadHash(bundle) !== payloadHash(candidate) ||
    manifestHash(bundle.manifest) !== manifestHash(candidate.manifest)
  )
    ruleError('保存された制度資料が検証済みの配布内容と一致しません');
  if (
    release &&
    (release.status !== 'approved' ||
      release.country !== provider.country ||
      release.currency !== provider.currency ||
      release.taxYear !== row.taxYear ||
      release.packageCode !== bundle.manifest.packageCode ||
      release.payloadHash !== payloadHash(bundle) ||
      release.manifestHash !== manifestHash(bundle.manifest))
  )
    ruleError('制度承認版の識別情報または内容hashが一致しません');
  provider.validate(bundle);
  return { row, release, provider, bundle };
}
export async function installedPayrollRules(ctx: Context): Promise<{
  provider: CountryPayrollProvider;
  installed: InstalledPayrollRule[];
  available: readonly PayrollRuleBundle[];
}> {
  const provider = await getCompanyPayrollProvider(ctx),
    available = distributedBundles(provider);
  const [rows, releases] = await Promise.all([
    allRows(ctx, WorkforcePayrollRules),
    allRows(ctx, WorkforcePayrollRuleRelease),
  ]);
  const installed: InstalledPayrollRule[] = [];
  for (const row of rows) {
    const matchingReleases = releases.filter((release) => release.ruleId === row.id);
    if (matchingReleases.length > 1) ruleError('同じ制度資料に複数の承認版があります');
    const release = matchingReleases[0] ?? null;
    const candidate = available.find((bundle) =>
      release
        ? bundle.manifest.packageCode === release.packageCode
        : bundle.code === row.code && bundle.manifest.parameters['legacySnapshotSchema'] === 1,
    );
    if (!candidate) ruleError('保存済み制度資料に対応する検証済み方式がありません');
    installed.push(validateInstalled(provider, candidate, row, release));
  }
  if (releases.some((release) => !rows.some((row) => row.id === release.ruleId)))
    ruleError('承認版の元制度資料がありません');
  activePayrollRules(installed);
  return { provider, available, installed };
}
const contains = (range: PayrollRuleRange, value: string): boolean => range.from <= value && value <= range.to;
const overlaps = (a: PayrollRuleRange, b: PayrollRuleRange): boolean => a.from <= b.to && b.from <= a.to;
export function activePayrollRules(installed: readonly InstalledPayrollRule[]): InstalledPayrollRule[] {
  const byPackage = new Map(installed.map((rule) => [rule.bundle.manifest.packageCode, rule]));
  if (byPackage.size !== installed.length) ruleError('制度承認版が重複しています');
  const superseded = new Set<string>();
  for (const rule of installed) {
    const manifest = rule.bundle.manifest,
      priorCode = manifest.supersedesPackageCode;
    if (!priorCode) {
      if (rule.release?.supersedesReleaseId) ruleError('制度版の置換参照が不正です');
      continue;
    }
    const prior = byPackage.get(priorCode);
    if (
      !prior ||
      !prior.release ||
      !rule.release ||
      rule.release.supersedesReleaseId !== prior.release.id ||
      prior.bundle.taxYear !== rule.bundle.taxYear ||
      prior.bundle.manifest.regime !== manifest.regime ||
      prior.bundle.manifest.revision >= manifest.revision ||
      superseded.has(priorCode)
    )
      ruleError('制度版の置換関係が不足・競合しています');
    for (const key of ['paymentDates', 'insuranceMonths', 'wageCutoffDates', 'adjustmentDates'] as const) {
      const old = prior.bundle.manifest.applicability[key],
        next = manifest.applicability[key];
      if (next.from > old.from || next.to < old.to) ruleError('訂正版が旧版の適用期間を覆っていません');
    }
    superseded.add(priorCode);
  }
  const active = installed.filter((rule) => !superseded.has(rule.bundle.manifest.packageCode));
  for (const [i, a] of active.entries())
    for (const b of active.slice(i + 1)) {
      if (
        a.bundle.taxYear === b.bundle.taxYear &&
        (overlaps(a.bundle.manifest.applicability.paymentDates, b.bundle.manifest.applicability.paymentDates) ||
          overlaps(a.bundle.manifest.applicability.adjustmentDates, b.bundle.manifest.applicability.adjustmentDates))
      )
        ruleError('同じ適用期間に競合する給与制度があります');
    }
  return active;
}
export function payrollRuleSelection(rule: InstalledPayrollRule) {
  const { row, bundle, provider } = rule;
  // Companion approval is administrative metadata, not a change to the calculation inputs.
  return {
    selectionSchema: 1 as const,
    providerId: provider.id,
    ruleId: row.id,
    ruleVersion: row.version,
    code: row.code,
    packageCode: bundle.manifest.packageCode,
    taxYear: bundle.taxYear,
    payloadHash: payloadHash(bundle),
    manifestHash: manifestHash(bundle.manifest),
    algorithmVersion: bundle.manifest.algorithmVersion,
    applicability: bundle.manifest.applicability,
  };
}
function resolved(rule: InstalledPayrollRule) {
  return {
    ...rule,
    selection: payrollRuleSelection(rule),
    legacyCompatible: rule.bundle.manifest.parameters['legacySnapshotSchema'] === 1,
  };
}
export async function resolveMonthlyRules(
  ctx: Context,
  input: { paymentDate: string; insurancePeriod: string; wagePeriod: string },
) {
  const active = activePayrollRules((await installedPayrollRules(ctx)).installed);
  const cutoff = periodBounds(input.wagePeriod).end;
  const matches = active.filter(
    ({ bundle }) =>
      contains(bundle.manifest.applicability.paymentDates, input.paymentDate) &&
      contains(bundle.manifest.applicability.insuranceMonths, input.insurancePeriod) &&
      contains(bundle.manifest.applicability.wageCutoffDates, cutoff),
  );
  if (matches.length !== 1 || !matches[0]) ruleError('支払日・保険対象月・賃金締日に一意の導入済み制度がありません');
  return resolved(matches[0]);
}
export async function resolveYearEndRules(ctx: Context, input: { taxYear: number; adjustedOn: string }) {
  const active = activePayrollRules((await installedPayrollRules(ctx)).installed);
  const matches = active.filter(
    ({ bundle }) =>
      bundle.taxYear === input.taxYear && contains(bundle.manifest.applicability.adjustmentDates, input.adjustedOn),
  );
  if (matches.length !== 1 || !matches[0]) ruleError('税年・年末調整実施日に一意の導入済み制度がありません');
  return resolved(matches[0]);
}
export async function supportedPayrollTaxYears(ctx: Context): Promise<number[]> {
  try {
    return [
      ...new Set(activePayrollRules((await installedPayrollRules(ctx)).installed).map((rule) => rule.bundle.taxYear)),
    ].sort((a, b) => a - b);
  } catch (error) {
    if (error instanceof StateError || error instanceof ValidationError) return [];
    throw error;
  }
}
export async function validatePayrollCondition(ctx: Context, condition: PayrollConditionInput): Promise<void> {
  if (condition.validFrom > condition.validTo || condition.birthDate > condition.validFrom)
    ruleError('本人条件の日付範囲が不正です');
  const active = activePayrollRules((await installedPayrollRules(ctx)).installed);
  const covered: PayrollRuleRange[] = [];
  for (const { provider, bundle } of active) {
    const a = bundle.manifest.applicability;
    const ranges = [
      a.paymentDates,
      a.wageCutoffDates,
      { from: periodBounds(a.insuranceMonths.from).start, to: periodBounds(a.insuranceMonths.to).end },
    ];
    if (!ranges.some((range) => overlaps(range, { from: condition.validFrom, to: condition.validTo }))) continue;
    provider.validateCondition(bundle, condition);
    covered.push(...ranges);
  }
  let cursor = condition.validFrom;
  for (const range of covered.sort((a, b) => a.from.localeCompare(b.from))) {
    if (range.to < cursor) continue;
    if (range.from > cursor) break;
    if (range.to >= condition.validTo) return;
    cursor = addDays(range.to, 1);
  }
  ruleError('本人条件の全適用期間を導入済み制度で検証できません');
}
