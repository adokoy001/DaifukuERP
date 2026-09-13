// Company settings owned by the tax module (spec AC-5; ADR-0013 L1). Keys, zod schemas and defaults are exported
// so sales/purchase can read them through kernel getSetting without redeclaring the shape.
import { ROUNDING_MODES, label, type SettingDef } from '@daifuku/kernel';
import { z } from 'zod';

export const TAX_ROUNDING_KEY = 'tax.rounding';
/** Spec AC-5 names this `tax.priceIncludesTax`; kernel registry.registerSetting requires snake_case keys, so the stored key is snake_case. */
export const TAX_PRICE_INCLUDES_TAX_KEY = 'tax.price_includes_tax';

export const ROUNDING_UNITS = ['invoice'] as const;
export type RoundingUnit = (typeof ROUNDING_UNITS)[number];

/** `mode`: 四捨五入 / 切捨て / 切上げ. `unit`: where the once-per-rate rounding happens (Q&A 問57 / 問67). */
export const taxRoundingSchema = z.object({
  mode: z.enum(ROUNDING_MODES).default('down'),
  unit: z.enum(ROUNDING_UNITS).default('invoice'),
});
export type TaxRounding = z.output<typeof taxRoundingSchema>;
export const TAX_ROUNDING_DEFAULT: TaxRounding = { mode: 'down', unit: 'invoice' };

/** Whether unit prices / line amounts entered on documents are 税込 by default (No.6375: 税込/税抜経理は選択). */
export const taxPriceIncludesTaxSchema = z.boolean();
export const TAX_PRICE_INCLUDES_TAX_DEFAULT = false;

export const taxSettingsSchema = z.object({
  rounding: taxRoundingSchema,
  priceIncludesTax: taxPriceIncludesTaxSchema,
});
export type TaxSettings = z.output<typeof taxSettingsSchema>;
export const TAX_SETTINGS_DEFAULT: TaxSettings = {
  rounding: TAX_ROUNDING_DEFAULT,
  priceIncludesTax: TAX_PRICE_INCLUDES_TAX_DEFAULT,
};

/** Declarations for registry.registerSetting (generic settings UI / meta). */
export const TAX_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: TAX_ROUNDING_KEY,
    label: label('消費税の端数処理', 'Tax rounding'),
    description: label(
      '税率ごとに1回丸める。mode: 四捨五入/切捨て/切上げ、unit: 請求書単位（納品書単位は未対応）',
      'Rounded once per rate. mode: half_up/down/up; unit: invoice (delivery-note rounding is not supported)',
    ),
    schema: taxRoundingSchema,
  },
  {
    key: TAX_PRICE_INCLUDES_TAX_KEY,
    label: label('税込入力', 'Prices include tax'),
    description: label('伝票の金額を税込で入力するか', 'Whether document amounts are entered tax-inclusive'),
    schema: taxPriceIncludesTaxSchema,
    default: TAX_PRICE_INCLUDES_TAX_DEFAULT,
  },
];
