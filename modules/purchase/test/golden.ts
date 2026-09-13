// Parsed golden file for AC-7, shared by the unit and DB tests (a test file must not import another test file).
import { ROUNDING_MODES } from '@daifuku/kernel';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const goldenSchema = z.object({
  description: z.string(),
  bill: z.object({
    priceIncludesTax: z.boolean(),
    rate: z.string(),
    rounding: z.object({ mode: z.enum(ROUNDING_MODES), scale: z.number().int() }),
    lines: z.array(
      z.object({
        amount: z.string(),
        category: z.enum(['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope']),
      }),
    ),
  }),
  cases: z.array(
    z.object({
      name: z.string(),
      date: z.string(),
      supplierTaxStatus: z.enum(['registered', 'exempt']),
      creditRatio: z.string(),
      expected: z.object({
        subtotal: z.string(),
        taxTotal: z.string(),
        deductibleTax: z.string(),
        nonDeductibleTax: z.string(),
        total: z.string(),
        journal: z.array(
          z.object({ account: z.string(), debit: z.string(), credit: z.string(), memo: z.string().nullable() }),
        ),
        byAccount: z.record(z.string(), z.string()),
      }),
    }),
  ),
});
export const golden = goldenSchema.parse(
  JSON.parse(readFileSync(new URL('./golden/exempt-supplier.json', import.meta.url), 'utf8')),
);
