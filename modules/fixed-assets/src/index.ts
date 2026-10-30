// @daifuku/mod-fixed-assets public API (docs/specs/fixed-assets.md). Importing this module registers the fixed asset
// register, depreciation runs, disposals, their hooks, actions, settings and the setup-health check. A country pack
// registers the statutory data at FIXED_ASSET_RULES_OVERRIDE (`() => DepreciationRuleSet | null`); l10n/jp imports
// only the types and the key from here.
import type { Infer, InsertInput } from '@daifuku/kernel';
import type { DepreciationRun, DepreciationRunLine } from './entities/depreciation-run.ts';
import type { FixedAssetDisposal } from './entities/disposal.ts';
import type { FixedAsset } from './entities/fixed-asset.ts';

export { FixedAssetsModule } from './module.ts';
export {
  FixedAsset,
  ASSET_STATUSES,
  ASSET_CLASS_LABELS,
  ASSET_STATUS_LABELS,
  METHOD_LABELS,
  PROPERTY_TAX_CLASS_LABELS,
  type AssetStatus,
} from './entities/fixed-asset.ts';
export { DepreciationRun, DepreciationRunLine } from './entities/depreciation-run.ts';
export { FixedAssetDisposal, DISPOSAL_KINDS, type DisposalKind } from './entities/disposal.ts';

export {
  FIXED_ASSET_RULES_OVERRIDE,
  ASSET_CLASSES,
  ASSET_KINDS,
  DEPRECIATION_METHODS,
  PROPERTY_TAX_CLASSES,
  RULES_HINT,
  RULES_UNVERIFIED_HINT,
  assetKindOf,
  checkRules,
  confirmationState,
  defaultPropertyTaxClass,
  depreciationRuleSetSchema,
  memorandumFor,
  methodAllowed,
  selectRate,
  type AssetClass,
  type AssetKind,
  type DepreciationMethod,
  type DepreciationRuleSet,
  type DepreciationRulesFn,
  type FixedAssetRulesOverrideKey,
  type PropertyTaxClass,
  type Rate,
  type RateRow,
  type RulesLookup,
} from './rules.ts';

export {
  allocate,
  allocatedThrough,
  closingBookValue,
  disposalDepreciation,
  monthIndex,
  monthStart,
  periodDue,
  walkYears,
  yearAmount,
  type FiscalYearLike,
  type OpeningValues,
  type PeriodDue,
  type WalkAsset,
  type YearAmount,
  type YearAmountInput,
  type YearState,
} from './services/schedule.ts';
export { defaultPeriod, lastEndedPeriod, type PeriodLike } from './services/periods.ts';
export { disposalJournalLines, imbalance, runJournalLines, type JournalLineSpec } from './services/posting.ts';
export {
  propertyTaxRows,
  UNSET_MUNICIPALITY_LABEL,
  type PropertyTaxAsset,
  type PropertyTaxRow,
} from './services/property-tax.ts';
export { MAX_RUN_ASSETS, SKIP_REASONS, type SkipReason } from './services/plan.ts';

export {
  previewDepreciationAction,
  runDepreciationAction,
  previewOutput,
  runOutput,
  type DepreciationPreview,
} from './actions/depreciation.ts';
export {
  assertPeriodRunnable,
  assertPlanRunnable,
  blockersOf,
  BLOCKERS,
  FUTURE_PERIOD_HINT,
  LATER_YEAR_HINT,
  OVER_LIMIT_HINT,
  TWELVE_MONTH_HINT,
  type Blocker,
} from './services/run-checks.ts';
export {
  depreciationScheduleAction,
  propertyTaxSummaryAction,
  depreciationRulesAction,
  SCHEDULE_COLUMNS,
  PROPERTY_TAX_COLUMNS,
} from './actions/reports.ts';
export { todoAction } from './actions/todo.ts';
export { depreciationRulesHealthCheck } from './health.ts';
export { ALWAYS_EDITABLE, FROZEN_HINT, IN_USE_HINT, depreciationStartOf } from './hooks/asset.ts';
export { USE_SCREEN_HINT, CANCEL_ORDER_HINT, DISPOSED_CANCEL_HINT, CORRECTION_YEAR_HINT } from './hooks/run.ts';
export { DISPOSED_HINT, LATER_RUN_HINT } from './hooks/disposal.ts';
export {
  FIXED_ASSET_ACCOUNTS_KEY,
  FIXED_ASSET_ACCOUNTS_DEFAULT,
  FIXED_ASSET_SETTING_DEFS,
  RULES_CONFIRMATION_KEY,
  RULES_CONFIRMATION_DEFAULT,
  fixedAssetAccountsSchema,
  rulesConfirmationSchema,
  type FixedAssetAccountCodes,
  type RulesConfirmation,
} from './settings.ts';

export type FixedAssetRow = Infer<typeof FixedAsset>;
export type FixedAssetInsert = InsertInput<typeof FixedAsset>;
export type DepreciationRunRow = Infer<typeof DepreciationRun>;
export type DepreciationRunLineRow = Infer<typeof DepreciationRunLine>;
export type FixedAssetDisposalRow = Infer<typeof FixedAssetDisposal>;
