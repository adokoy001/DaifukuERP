// tax.summarize (spec AC-7): per-rate tax summary for a document's lines, using the company's rates and settings.
// This is what sales/purchase documents call on validate/submit (or taxSummaryFor directly, in-process).
import { Decimal, ROUNDING_MODES, defineAction, label } from '@daifuku/kernel';
import { z } from 'zod';
import { ROUNDING_UNITS } from '../services/settings.ts';
import { taxSummaryFor, type DocumentTaxSummary } from '../summary.ts';
import { localDate, taxCategorySchema } from './resolve.ts';

const decimalString = z
  .string()
  .refine((s) => Decimal.isDecimalString(s), 'must be a decimal string like "1234" or "12.50"');

const groupSchema = z.object({
  category: taxCategorySchema,
  code: z.string(),
  label: z.string(),
  rate: z.string(),
  taxable: z.string(),
  tax: z.string(),
  gross: z.string(),
  lineCount: z.number().int(),
});

export const summarizeOutputSchema = z.object({
  date: localDate,
  priceIncludesTax: z.boolean(),
  rounding: z.object({ mode: z.enum(ROUNDING_MODES), unit: z.enum(ROUNDING_UNITS), scale: z.number().int() }),
  groups: z.array(groupSchema),
  totals: z.object({ taxable: z.string(), tax: z.string(), gross: z.string() }),
});

/** Decimal -> string for the action boundary (ADR-0010: JSON carries decimal strings). */
export function summaryToJson(s: DocumentTaxSummary): z.input<typeof summarizeOutputSchema> {
  return {
    date: s.date,
    priceIncludesTax: s.priceIncludesTax,
    rounding: s.rounding,
    groups: s.groups.map((g) => ({
      category: g.category,
      code: g.code,
      label: g.label,
      rate: g.rate.toString(),
      taxable: g.taxable.toString(),
      tax: g.tax.toString(),
      gross: g.gross.toString(),
      lineCount: g.lineCount,
    })),
    totals: { taxable: s.totals.taxable.toString(), tax: s.totals.tax.toString(), gross: s.totals.gross.toString() },
  };
}

export const summarizeAction = defineAction({
  name: 'tax.summarize',
  description: label(
    '明細（金額・税区分）を税率ごとに集計し、税額を税率ごとに1回だけ丸めて返します（適格請求書の端数処理、国税庁 Q&A 問57）。丸め方は会社設定 tax.rounding、税込/税抜は tax.priceIncludesTax（入力で上書き可）。',
    'Group document lines (amount, category) by tax rate and round the tax once per rate (qualified-invoice rule, NTA Q&A 57). Rounding mode from company setting tax.rounding; tax-inclusive from tax.priceIncludesTax unless overridden.',
  ),
  input: z.object({
    date: localDate,
    priceIncludesTax: z.boolean().optional(),
    lines: z.array(z.object({ amount: decimalString, category: taxCategorySchema })).max(10000),
  }),
  output: summarizeOutputSchema,
  permission: { entity: 'tax_rate', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, input) => summaryToJson(await taxSummaryFor(ctx, input)),
});
