// @daifuku/mod-tax public API. Importing this module registers the tax_rate entity, actions, hooks and settings.
// sales/purchase: call taxSummaryFor(ctx, { date, lines }) on validate/submit; read settings with the exported keys/schemas.
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { TaxRate } from './entities/tax-rate.ts';

export { TaxModule } from './module.ts';
export { TaxRate } from './entities/tax-rate.ts';
export { resolveAction, taxCategorySchema } from './actions/resolve.ts';
export { summarizeAction, summarizeOutputSchema, summaryToJson } from './actions/summarize.ts';
export { getSettingsAction, setSettingsAction } from './actions/settings.ts';
export { TAX_CATEGORIES, TAX_CATEGORY_LABELS, ZERO_RATE_CATEGORIES, isTaxCategory, isZeroRateCategory, type TaxCategory } from './services/categories.ts';
export {
  resolveRate,
  computeLineTax,
  summarizeTax,
  taxScaleForCurrency,
  type RateRow,
  type ResolvedRate,
  type LineTaxInput,
  type LineTax,
  type SummarizeOptions,
  type TaxGroup,
  type TaxTotals,
  type TaxSummary,
} from './services/compute.ts';
export {
  TAX_ROUNDING_KEY,
  TAX_PRICE_INCLUDES_TAX_KEY,
  ROUNDING_UNITS,
  taxRoundingSchema,
  taxPriceIncludesTaxSchema,
  taxSettingsSchema,
  TAX_ROUNDING_DEFAULT,
  TAX_PRICE_INCLUDES_TAX_DEFAULT,
  TAX_SETTINGS_DEFAULT,
  TAX_SETTING_DEFS,
  type RoundingUnit,
  type TaxRounding,
  type TaxSettings,
} from './services/settings.ts';
export { taxSummaryFor, resolveRateFor, loadTaxRates, loadTaxSettings, type DocumentTaxLine, type DocumentTaxInput, type DocumentTaxGroup, type DocumentTaxSummary } from './summary.ts';
export { SEED_TAX_RATES, seedTaxRates } from './seeds/rates.ts';

export type TaxRateRow = Infer<typeof TaxRate>;
export type TaxRateInsert = InsertInput<typeof TaxRate>;
export type TaxRateUpdate = UpdateInput<typeof TaxRate>;
