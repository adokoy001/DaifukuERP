// tax.get_settings / tax.set_settings (spec AC-5): typed access to the company's tax settings.
import { defineAction, label, setSetting } from '@daifuku/kernel';
import { z } from 'zod';
import {
  TAX_PRICE_INCLUDES_TAX_KEY,
  TAX_ROUNDING_KEY,
  taxPriceIncludesTaxSchema,
  taxRoundingSchema,
  taxSettingsSchema,
} from '../services/settings.ts';
import { loadTaxSettings } from '../summary.ts';

export const getSettingsAction = defineAction({
  name: 'tax.get_settings',
  description: label(
    '会社の消費税設定（端数処理・税込入力）を返します。未設定なら既定値。',
    'Return the company tax settings (rounding, price-includes-tax); defaults when unset.',
  ),
  input: z.object({}),
  output: taxSettingsSchema,
  permission: { entity: 'tax_rate', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx) => loadTaxSettings(ctx),
});

export const setSettingsAction = defineAction({
  name: 'tax.set_settings',
  description: label(
    '会社の消費税設定を更新します（admin または settings ロール）。指定したキーだけ更新し、更新後の全設定を返します。',
    'Update the company tax settings (admin or settings role). Only the given keys change; returns the full settings afterwards.',
  ),
  input: z.object({
    rounding: taxRoundingSchema.optional(),
    priceIncludesTax: taxPriceIncludesTaxSchema.optional(),
  }),
  output: taxSettingsSchema,
  permission: { roles: ['settings'] },
  tx: 'required',
  mutates: true,
  handler: async (ctx, input) => {
    if (input.rounding !== undefined) await setSetting(ctx, TAX_ROUNDING_KEY, taxRoundingSchema, input.rounding);
    if (input.priceIncludesTax !== undefined)
      await setSetting(ctx, TAX_PRICE_INCLUDES_TAX_KEY, taxPriceIncludesTaxSchema, input.priceIncludesTax);
    return loadTaxSettings(ctx);
  },
});
