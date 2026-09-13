import { defineAction, label, PermissionDenied, repo, withLock, type Context } from '@daifuku/kernel';
import { z } from 'zod';
import { allRows, command, userId } from '../common.ts';
import { P } from '../entities/common.ts';
import {
  WorkforcePayroll,
  WorkforcePayrollRules,
  WorkforcePayrollRuleRelease,
  WorkforceYearEndAdjustment,
} from '../entities/index.ts';
import { internalWrite } from '../internal.ts';
import { stableJson } from '../services/json.ts';
import {
  installPayrollRuleInput,
  installPayrollRuleResult,
  payrollRuleCatalog,
  payrollRulePreview,
  previewPayrollRuleInput,
  type PayrollRuleSummary,
  type PayrollRulePreview,
} from './contract.ts';
import { payloadHash, manifestHash } from './hash.ts';
import type { PayrollRuleBundle } from './port.ts';
import { activePayrollRules, installedPayrollRules, ruleError } from './resolver.ts';

type State = Awaited<ReturnType<typeof installedPayrollRules>>;
export function requirePayrollRuleAdmin(ctx: Context): void {
  if (
    !ctx.companyId ||
    ctx.actor.type === 'relay' ||
    (ctx.accessScope && ctx.accessScope !== 'all') ||
    (!ctx.roles.includes('admin') && !ctx.roles.includes(P))
  )
    throw new PermissionDenied('workforce_payroll_rule_release', 'company-rule-installation', ctx.roles);
}
function summary(state: State, bundle: PayrollRuleBundle): PayrollRuleSummary {
  const found = state.installed.find((rule) => rule.bundle.manifest.packageCode === bundle.manifest.packageCode);
  const active = activePayrollRules(state.installed);
  return {
    packageCode: bundle.manifest.packageCode,
    code: bundle.code,
    taxYear: bundle.taxYear,
    verifiedOn: bundle.verifiedOn,
    status: !found ? 'available' : !active.includes(found) ? 'superseded' : found.release ? 'approved' : 'legacy',
    payloadHash: payloadHash(bundle),
    manifestHash: manifestHash(bundle.manifest),
    manifest: bundle.manifest,
    sources: [...bundle.sources],
    ruleId: found?.row.id ?? null,
    approvedAt: found?.release?.approvedAt.toISOString() ?? null,
    approvalBasis: found?.release?.approvalBasis ?? null,
  };
}
function installationIssues(state: State, bundle: PayrollRuleBundle): string[] {
  const manifest = bundle.manifest;
  const existing = state.installed.find((rule) => rule.bundle.manifest.packageCode === manifest.packageCode);
  if (existing) return [];
  const active = activePayrollRules(state.installed);
  const issues: string[] = [];
  const previous = active.find((rule) => rule.bundle.manifest.packageCode === manifest.supersedesPackageCode);
  if (manifest.supersedesPackageCode) {
    if (!previous?.release) issues.push('置換元の有効な承認版を先に導入してください。');
    else if (
      previous.bundle.taxYear !== bundle.taxYear ||
      previous.bundle.manifest.regime !== manifest.regime ||
      previous.bundle.manifest.revision >= manifest.revision
    )
      issues.push('置換元の税年・制度区分・版番号が一致しません。');
    else
      for (const key of ['paymentDates', 'insuranceMonths', 'wageCutoffDates', 'adjustmentDates'] as const) {
        const old = previous.bundle.manifest.applicability[key];
        const next = manifest.applicability[key];
        if (next.from > old.from || next.to < old.to) issues.push('訂正版の適用範囲が置換元の全期間を覆っていません。');
      }
  }
  for (const rule of active) {
    if (rule === previous || rule.bundle.taxYear !== bundle.taxYear) continue;
    if (
      ['paymentDates', 'adjustmentDates'].some((key) => {
        const k = key as 'paymentDates' | 'adjustmentDates';
        const a = rule.bundle.manifest.applicability[k];
        const b = manifest.applicability[k];
        return a.from <= b.to && b.from <= a.to;
      })
    )
      issues.push('同じ期間に別の承認済み制度があります。明示的な置換関係が必要です。');
  }
  return [...new Set(issues)];
}
function selectedBundle(state: State, packageCode: string): PayrollRuleBundle {
  const bundle = state.available.find((item) => item.manifest.packageCode === packageCode);
  if (!bundle) ruleError('選択した制度資料は配布・検証されていません');
  return bundle;
}
export async function previewPayrollRule(ctx: Context, packageCode: string): Promise<PayrollRulePreview> {
  requirePayrollRuleAdmin(ctx);
  const state = await installedPayrollRules(ctx);
  const bundle = selectedBundle(state, packageCode);
  const row = summary(state, bundle);
  const issues = installationIssues(state, bundle);
  const pays = await allRows(ctx, WorkforcePayroll, {
    docstatus: 0,
    periodEnd: { $gte: `${bundle.taxYear - 1}-12-01`, $lte: `${bundle.taxYear}-12-31` },
  });
  const payroll = pays.filter((pay) => {
    const raw = pay.calculation as { statutory?: { input?: { paymentDate?: string } } } | null;
    return raw?.statutory?.input?.paymentDate?.slice(0, 4) === String(bundle.taxYear);
  }).length;
  const yearEnd = await repo(ctx, WorkforceYearEndAdjustment).count({ taxYear: bundle.taxYear, docstatus: 0 });
  return {
    ...row,
    canInstall: issues.length === 0 && (row.status === 'available' || row.status === 'legacy'),
    issues,
    changes:
      row.status === 'legacy'
        ? ['既存の制度資料・給与を変更せず、導入確認の記録だけを追加します。']
        : row.status === 'approved' || row.status === 'superseded'
          ? ['この制度版は導入済みです。保存済みの内容は変更しません。']
          : bundle.manifest.supersedesPackageCode
            ? ['旧版を保持し、新規算定を訂正版へ切り替えます。旧版で計算した未確定資料は再計算が必要です。']
            : ['対応期間の新規算定に利用できる承認版を追加します。既存給与は再計算しません。'],
    affectedDrafts: { payroll, yearEnd },
  };
}
async function install(ctx: Context, input: z.infer<typeof installPayrollRuleInput>) {
  requirePayrollRuleAdmin(ctx);
  return withLock(ctx, 'workforce:policies', async () => {
    const state = await installedPayrollRules(ctx);
    const bundle = selectedBundle(state, input.packageCode);
    if (
      input.expectedPayloadHash !== payloadHash(bundle) ||
      input.expectedManifestHash !== manifestHash(bundle.manifest)
    )
      ruleError('導入確認後に配布資料が変更されています。資料を再表示してください');
    const existing = state.installed.find((rule) => rule.bundle.manifest.packageCode === input.packageCode);
    if (existing?.release) return { rule: existing.row, release: existing.release, alreadyInstalled: true };
    const issues = installationIssues(state, bundle);
    if (issues.length) ruleError(issues.join(' '));
    const rule =
      existing?.row ??
      (await internalWrite(ctx, WorkforcePayrollRules, (write) =>
        repo(write, WorkforcePayrollRules).create({
          code: bundle.code,
          taxYear: bundle.taxYear,
          data: bundle.data,
          sources: [...bundle.sources],
          verifiedOn: bundle.verifiedOn,
        }),
      ));
    const prior = state.installed.find(
      (item) => item.bundle.manifest.packageCode === bundle.manifest.supersedesPackageCode,
    );
    const release = await internalWrite(ctx, WorkforcePayrollRuleRelease, (write) =>
      repo(write, WorkforcePayrollRuleRelease).create({
        packageCode: input.packageCode,
        ruleId: rule.id,
        taxYear: bundle.taxYear,
        country: bundle.manifest.country,
        currency: bundle.manifest.currency,
        manifest: JSON.parse(stableJson(bundle.manifest)) as unknown,
        payloadHash: input.expectedPayloadHash,
        manifestHash: input.expectedManifestHash,
        status: 'approved',
        ...(prior?.release ? { supersedesReleaseId: prior.release.id } : {}),
        approvedBy: userId(ctx),
        approvedAt: ctx.now(),
        approvalBasis: input.basis,
      }),
    );
    return { rule, release, alreadyInstalled: false };
  });
}
export async function initializeLegacyPayrollRules(ctx: Context) {
  requirePayrollRuleAdmin(ctx);
  const state = await installedPayrollRules(ctx);
  const legacy = state.available.filter((bundle) => bundle.manifest.parameters['legacySnapshotSchema'] === 1);
  if (legacy.length !== 1 || !legacy[0]) ruleError('互換導入に対応する旧制度資料がありません');
  const bundle = legacy[0];
  const result = await install(ctx, {
    packageCode: bundle.manifest.packageCode,
    expectedPayloadHash: payloadHash(bundle),
    expectedManifestHash: manifestHash(bundle.manifest),
    sourcesReviewed: true,
    basis: '既存の制度資料準備操作による検証済み互換版の導入',
  });
  return command(result.rule);
}
export const payrollRuleCatalogAction = defineAction({
  name: 'workforce.payroll_rule_catalog',
  description: label('給与制度の配布・承認版一覧', 'Payroll rule release catalog'),
  input: z.object({}).strict(),
  output: payrollRuleCatalog,
  permission: { roles: [P] },
  siteAccess: false,
  mutates: false,
  handler: async (ctx) => {
    requirePayrollRuleAdmin(ctx);
    const state = await installedPayrollRules(ctx);
    return {
      country: state.provider.country,
      currency: state.provider.currency,
      supportedTaxYears: [...new Set(activePayrollRules(state.installed).map((rule) => rule.bundle.taxYear))].sort(
        (a, b) => a - b,
      ),
      bundles: state.available.map((bundle) => summary(state, bundle)),
    };
  },
});
export const previewPayrollRuleAction = defineAction({
  name: 'workforce.preview_payroll_rule',
  description: label('給与制度の導入内容を確認', 'Preview payroll rule installation'),
  input: previewPayrollRuleInput,
  output: payrollRulePreview,
  permission: { roles: [P] },
  siteAccess: false,
  mutates: false,
  handler: (ctx, input) => previewPayrollRule(ctx, input.packageCode),
});
export const installPayrollRuleAction = defineAction({
  name: 'workforce.install_payroll_rule',
  description: label('確認済みの給与制度版を導入', 'Install a reviewed payroll rule release'),
  input: installPayrollRuleInput,
  output: installPayrollRuleResult,
  permission: { roles: [P] },
  siteAccess: false,
  handler: async (ctx, input) => {
    const result = await install(ctx, input);
    return {
      id: result.release.id,
      version: result.release.version,
      status: 'approved' as const,
      alreadyInstalled: result.alreadyInstalled,
    };
  },
});
