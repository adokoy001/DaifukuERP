import { z } from 'zod';
export type { PayrollRuleManifest } from './port.ts';

const date = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const range = z
  .object({ from: date, to: date })
  .strict()
  .refine((r) => r.from <= r.to, 'Invalid date range');
const monthRange = z
  .object({ from: month, to: month })
  .strict()
  .refine((r) => r.from <= r.to, 'Invalid month range');
export const payrollRuleManifest = z
  .object({
    manifestSchema: z.literal(1),
    packageCode: z.string().min(1).max(160),
    revision: z.int().min(1),
    country: z.string().length(2),
    currency: z.string().length(3),
    regime: z.string().min(1),
    taxYear: z.int().min(1900).max(9999),
    dataSchema: z.string().min(1),
    algorithmVersion: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()),
    applicability: z
      .object({
        paymentDates: range,
        insuranceMonths: monthRange,
        wageCutoffDates: range,
        adjustmentDates: range,
        yearEndFactsOn: date,
        requiredFinalPaymentFrom: date,
      })
      .strict(),
    supersedesPackageCode: z.string().min(1).optional(),
  })
  .strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const payrollRuleSummary = z.object({
  packageCode: z.string(),
  code: z.string(),
  taxYear: z.int(),
  verifiedOn: date,
  status: z.enum(['available', 'legacy', 'approved', 'superseded']),
  payloadHash: hash,
  manifestHash: hash,
  manifest: payrollRuleManifest,
  sources: z.array(z.string()),
  ruleId: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvalBasis: z.string().nullable(),
});
export const payrollRuleCatalog = z.object({
  country: z.string(),
  currency: z.string(),
  supportedTaxYears: z.array(z.int()),
  bundles: z.array(payrollRuleSummary),
});
export const payrollRulePreview = payrollRuleSummary.extend({
  canInstall: z.boolean(),
  issues: z.array(z.string()),
  changes: z.array(z.string()),
  affectedDrafts: z.object({ payroll: z.int(), yearEnd: z.int() }),
});
export const previewPayrollRuleInput = z.object({ packageCode: z.string().min(1).max(160) }).strict();
export const installPayrollRuleInput = previewPayrollRuleInput
  .extend({
    expectedManifestHash: hash,
    expectedPayloadHash: hash,
    sourcesReviewed: z.literal(true),
    basis: z.string().trim().min(5).max(2000),
  })
  .strict();
export const installPayrollRuleResult = z.object({
  id: z.string(),
  version: z.int(),
  status: z.literal('approved'),
  alreadyInstalled: z.boolean(),
});
export type PayrollRuleSummary = z.infer<typeof payrollRuleSummary>;
export type PayrollRuleCatalog = z.infer<typeof payrollRuleCatalog>;
export type PayrollRulePreview = z.infer<typeof payrollRulePreview>;
