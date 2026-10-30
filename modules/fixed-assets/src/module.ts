// Module manifest of fixed_assets (docs/specs/fixed-assets.md; docs/conventions/layers.md). Depends on accounting
// (posting, fiscal calendar), tax (sale tax) and partner (buyer); imports them first so their entities are registered.
// Uses the existing `accounting` role; the country rules come from the override point fixed_assets.depreciation_rules.
import { defineModule, label, registry } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { PartnerModule } from '@daifuku/mod-partner';
import { TaxModule } from '@daifuku/mod-tax';
import { previewDepreciationAction, runDepreciationAction } from './actions/depreciation.ts';
import { depreciationRulesAction, depreciationScheduleAction, propertyTaxSummaryAction } from './actions/reports.ts';
import { todoAction } from './actions/todo.ts';
import { DepreciationRun, DepreciationRunLine } from './entities/depreciation-run.ts';
import { FixedAssetDisposal } from './entities/disposal.ts';
import { FixedAsset } from './entities/fixed-asset.ts';
import { depreciationRulesHealthCheck } from './health.ts';
import { registerAssetHooks } from './hooks/asset.ts';
import { registerDisposalHooks } from './hooks/disposal.ts';
import { registerRunHooks } from './hooks/run.ts';
import { FIXED_ASSET_SETTING_DEFS } from './settings.ts';

export const FixedAssetsModule = defineModule({
  name: 'fixed_assets',
  label: label('固定資産', 'Fixed assets'),
  depends: [AccountingModule.name, TaxModule.name, PartnerModule.name],
  entities: [FixedAsset, DepreciationRun, DepreciationRunLine, FixedAssetDisposal],
  actions: [
    previewDepreciationAction,
    runDepreciationAction,
    depreciationScheduleAction,
    propertyTaxSummaryAction,
    depreciationRulesAction,
    todoAction,
  ],
  hooks: () => {
    registerAssetHooks();
    registerRunHooks();
    registerDisposalHooks();
    for (const def of FIXED_ASSET_SETTING_DEFS) registry.registerSetting(def);
    registry.registerHealthCheck(depreciationRulesHealthCheck);
  },
  menus: [
    { label: label('固定資産台帳', 'Fixed asset register'), entity: FixedAsset.name, order: 80 },
    { label: label('除却・売却', 'Disposals'), entity: FixedAssetDisposal.name, order: 81 },
    { label: label('償却の実行', 'Depreciation run'), route: '/finance/depreciation', order: 82 },
    {
      label: label('減価償却明細表', 'Depreciation schedule'),
      route: `/r/${depreciationScheduleAction.name}`,
      order: 83,
    },
    {
      label: label('償却資産申告の集計', 'Property tax return aggregate'),
      route: `/r/${propertyTaxSummaryAction.name}`,
      order: 84,
    },
  ],
});
