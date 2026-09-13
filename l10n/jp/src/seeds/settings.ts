// Default company settings for Japan (spec AC-2; ADR-0013 L1). Written only when the key is unset, so an operator's
// choice survives re-seeding. Values: 切捨て・請求書単位 (docs/domain/japan-tax.md#rounding, 国税庁 Q&A 問57) and 税抜入力.
import { getCompany, setSetting, type Context } from '@daifuku/kernel';
import {
  TAX_PRICE_INCLUDES_TAX_KEY,
  TAX_ROUNDING_KEY,
  seedTaxRates,
  taxPriceIncludesTaxSchema,
  taxRoundingSchema,
  type TaxRounding,
} from '@daifuku/mod-tax';
import type { z } from 'zod';

export interface DefaultSetting<T = unknown> {
  key: string;
  schema: z.ZodType<T>;
  value: T;
}

export const JP_TAX_ROUNDING_DEFAULT: TaxRounding = { mode: 'down', unit: 'invoice' };
export const JP_PRICE_INCLUDES_TAX_DEFAULT = false;

export const JP_DEFAULT_SETTINGS: readonly DefaultSetting[] = [
  { key: TAX_ROUNDING_KEY, schema: taxRoundingSchema, value: JP_TAX_ROUNDING_DEFAULT },
  { key: TAX_PRICE_INCLUDES_TAX_KEY, schema: taxPriceIncludesTaxSchema, value: JP_PRICE_INCLUDES_TAX_DEFAULT },
];

/** Sets each default only when the company has no value for the key. Returns the keys written. */
export async function seedDefaultSettings(
  ctx: Context,
  defaults: readonly DefaultSetting[] = JP_DEFAULT_SETTINGS,
): Promise<string[]> {
  const company = await getCompany(ctx);
  const written: string[] = [];
  for (const d of defaults) {
    if (company.settings[d.key] !== undefined) continue;
    await setSetting(ctx, d.key, d.schema, d.value);
    written.push(d.key);
  }
  return written;
}

/** Tax rates are owned by modules/tax; the country pack only makes sure they exist (spec AC-2). */
export async function seedTaxRatesIfMissing(ctx: Context): Promise<void> {
  await seedTaxRates(ctx);
}
