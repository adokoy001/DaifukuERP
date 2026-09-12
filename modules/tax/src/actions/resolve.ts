// tax.resolve (spec AC-6): the company's rate for a category on a date.
import { defineAction, isLocalDate, label } from '@daifuku/kernel';
import { z } from 'zod';
import { TAX_CATEGORIES } from '../services/categories.ts';
import { resolveRateFor } from '../summary.ts';

export const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
export const taxCategorySchema = z.enum(TAX_CATEGORIES);

export const resolveAction = defineAction({
  name: 'tax.resolve',
  description: label(
    '税区分と日付から、その日に有効な税率（コード・率・表示名）を返します。免税/非課税/不課税は常に率 0。',
    'Return the tax rate (code, rate, label) valid on the date for a tax category. exempt/non_taxable/out_of_scope always resolve to 0.',
  ),
  input: z.object({ category: taxCategorySchema, date: localDate }),
  output: z.object({ category: taxCategorySchema, code: z.string(), rate: z.string(), label: z.string() }),
  permission: { entity: 'tax_rate', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, { category, date }) => {
    const r = await resolveRateFor(ctx, category, date);
    return { category: r.category, code: r.code, rate: r.rate.toString(), label: r.label };
  },
});
