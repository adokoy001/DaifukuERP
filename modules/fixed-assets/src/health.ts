// Setup health check fixed_assets.depreciation_rules (docs/specs/fixed-assets.md AC-30; docs/specs/setup-health.md).
// warn: no usable rule set for the company (country pack missing, invalid, other country or currency), or rules not
// verified against the primary sources while the company has assets (or the caller cannot count them); ok otherwise.
import { getCompany, label, PermissionDenied, repo, type HealthCheckDef } from '@daifuku/kernel';
import { FixedAsset } from './entities/fixed-asset.ts';
import { checkRules, registeredRules, rulesConfirmation } from './rules.ts';

const HREF = '/finance/depreciation';

export const depreciationRulesHealthCheck: HealthCheckDef = {
  id: 'fixed_assets.depreciation_rules',
  label: label('減価償却の規則（償却率表）', 'Depreciation rules (rate tables)'),
  order: 60,
  run: async (ctx) => {
    const company = await getCompany(ctx);
    const found = checkRules(registeredRules(), company);
    if (!found.ok)
      return {
        status: 'warn',
        detail: label(
          `会社（${company.country}・${company.currency}）に使える償却規則がありません（${found.reason}）。国別パック（日本は l10n-jp）を入れてください。`,
          `No depreciation rules usable for this company (${company.country}, ${company.currency}; ${found.reason}). Install the country pack (Japan: l10n-jp).`,
        ),
        href: HREF,
      };
    const rules = found.rules;
    const confirmation = await rulesConfirmation(ctx, rules);
    if (rules.verifiedOn)
      return {
        status: 'ok',
        detail: label(
          `規則 ${rules.id} は ${rules.verifiedOn} に一次資料と照合済みです。`,
          `Rule set ${rules.id} was verified against the primary sources on ${rules.verifiedOn}.`,
        ),
        href: HREF,
      };
    if (confirmation.confirmedOn)
      return {
        status: 'ok',
        detail: label(
          `規則 ${rules.id} は会社の担当者が ${confirmation.confirmedOn} に照合しました（設定 fixed_assets.rules_confirmation）。`,
          `Rule set ${rules.id} was confirmed by the company on ${confirmation.confirmedOn} (setting fixed_assets.rules_confirmation).`,
        ),
        href: HREF,
      };
    let assets: number | null = null;
    try {
      assets = await repo(ctx, FixedAsset).count();
    } catch (error) {
      if (!(error instanceof PermissionDenied)) throw error;
    }
    if (assets === 0)
      return {
        status: 'ok',
        detail: label(
          '固定資産は未登録です（償却率表は一次資料と未照合）。',
          'No fixed assets are registered yet (the rate tables are not verified against the primary sources).',
        ),
        href: HREF,
      };
    return {
      status: 'warn',
      detail: label(
        `償却率表（${rules.id}）が一次資料と未照合です。照合して設定 fixed_assets.rules_confirmation に記録するまで償却の転記はできません。`,
        `The rate tables (${rules.id}) are not verified against the primary sources. Depreciation cannot be posted until a person compares them and records it in setting fixed_assets.rules_confirmation.`,
      ),
      href: HREF,
    };
  },
};
