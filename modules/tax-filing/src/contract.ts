// Browser-safe preparation contract. No submission endpoint or personal-number fields.
import { z } from 'zod';
const id = z.uuid();
const date = z.iso.date();
const version = z.number().int().min(1);
const editVersion = z.number().int().min(0);
const reason = z.string().trim().min(1).max(2000);
const text = z.string().trim().max(200);
const amount = z.string().regex(/^-?\d{1,18}(?:\.\d{1,12})?$/);
export const filingKind = z.enum(['accounting', 'payroll']);
export const filingIssue = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  reference: z.string().nullable(),
});
export const filingMapping = z
  .object({ accountId: id, category: z.string().min(1).max(80), displayName: z.string().trim().min(1).max(100) })
  .strict();
export const accountingProfileData = z
  .object({
    countryProfile: z.string().min(1).max(80),
    entityType: z.literal('corporation'),
    accountingBasis: z.literal('tax_exclusive'),
    consolidation: z.literal('standalone'),
    legalName: z.string().trim().min(1).max(100),
    mappings: z.array(filingMapping).max(2000),
    basis: reason,
  })
  .strict();
export const saveAccountingProfileInput = accountingProfileData.extend({ expectedVersion: editVersion }).strict();
export const recipientFacts = z
  .object({
    employeeId: id,
    nameKana: text.nullable(),
    address: text.nullable(),
    birthDate: date.nullable(),
    municipalityCode: z
      .string()
      .regex(/^\d{6}$/)
      .nullable(),
    unpaidSalaryAmount: z
      .string()
      .regex(/^\d{1,15}$/)
      .nullable(),
    uncollectedTaxAmount: z
      .string()
      .regex(/^\d{1,15}$/)
      .nullable(),
    evidence: reason,
  })
  .strict();
export const payrollProfileData = z
  .object({
    countryProfile: z.string().min(1).max(80),
    taxYear: z.number().int(),
    legalName: text,
    payerAddress: text.nullable(),
    payerPhone: text.nullable(),
    recipients: z.array(recipientFacts).max(2000),
    basis: reason,
  })
  .strict();
export const savePayrollProfileInput = payrollProfileData.extend({ expectedVersion: editVersion }).strict();
export const prepareAccountingInput = z
  .object({
    fiscalYearId: id,
    idempotencyKey: id,
    previousId: id.optional(),
    incomeTransferNotPostedConfirmed: z.literal(true),
    taxClassificationReview: reason,
  })
  .strict();
export const preparePayrollInput = z
  .object({
    taxYear: z.number().int(),
    idempotencyKey: id,
    previousId: id.optional(),
    annualScopeConfirmed: z.literal(true),
  })
  .strict();
export const filingRefInput = z.object({ kind: filingKind, id }).strict();
export const confirmFilingInput = filingRefInput
  .extend({ expectedVersion: version, reason, warningsReviewed: z.literal(true) })
  .strict();
export const cancelFilingInput = filingRefInput.extend({ expectedVersion: version, reason }).strict();
export const exportFilingInput = filingRefInput.extend({ expectedVersion: version }).strict();
export const filingCommandOutput = z.object({ id, version });
export const filingBoardInput = z.object({ kind: filingKind }).strict();
export const statementRow = z.object({
  label: z.string(),
  amount: amount.nullable(),
  rowType: z.enum(['T', '1']),
  level: z.number().int(),
  code: z.string(),
});
export const filingStatement = z.object({ kind: z.enum(['BS', 'PL']), rows: z.array(statementRow) });
export const filingPayrollRow = z.object({
  employeeId: id,
  employeeCode: z.string(),
  employeeName: z.string(),
  facts: recipientFacts.nullable(),
  payrollCount: z.number().int(),
  taxablePay: amount.nullable(),
  socialPremium: amount.nullable(),
  withheldTax: amount.nullable(),
  adjustmentId: id.nullable(),
  annualTax: amount.nullable(),
  salaryIncome: amount.nullable(),
  deductionTotal: amount.nullable(),
  previousEmployerPay: amount.nullable(),
  refund: amount.nullable(),
  additionalTax: amount.nullable(),
  issues: z.array(filingIssue),
});
export const filingSummary = z.object({
  id,
  kind: filingKind,
  version,
  status: z.enum(['draft', 'confirmed', 'cancelled']),
  countryProfile: z.string(),
  from: date,
  to: date,
  taxYear: z.number().int().nullable(),
  fiscalYearId: id.nullable(),
  previousId: id.nullable(),
  sourceHash: z.string(),
  preparedBy: id,
  createdAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable(),
  confirmedBy: id.nullable(),
  reviewReason: z.string().nullable(),
  issues: z.array(filingIssue),
  totals: z.record(z.string(), amount.nullable()),
});
export const filingDetailOutput = filingSummary.extend({
  stale: z.boolean(),
  statements: z.array(filingStatement),
  payrollRows: z.array(filingPayrollRow),
  sourceCount: z.number().int(),
  sourceVersions: z.array(z.object({ entity: z.string(), id, version })),
  officialImport: z.boolean(),
  notice: z.string(),
  profile: z.record(z.string(), z.unknown()),
});
export const filingProfileOption = z.object({
  code: z.string(),
  name: z.string(),
  version: z.string(),
  from: date,
  to: date.nullable(),
  taxYears: z.array(z.number().int()),
  categories: z.array(z.object({ key: z.string(), label: z.string(), accountTypes: z.array(z.string()) })),
  sources: z.array(z.string()),
});
export const filingBoardOutput = z.object({
  kind: filingKind,
  profiles: z.array(filingProfileOption),
  accountingProfile: accountingProfileData.extend({ version }).nullable(),
  payrollProfile: payrollProfileData.extend({ version }).nullable(),
  years: z.array(z.object({ id, code: z.string(), from: date, to: date, closed: z.boolean() })),
  accounts: z.array(z.object({ id, code: z.string(), name: z.string(), type: z.string() })),
  employees: z.array(z.object({ id, code: z.string(), name: z.string() })),
  packs: z.array(filingSummary),
  truncated: z.boolean(),
});
export const filingExportOutput = z.object({
  sourceHash: z.string(),
  officialImport: z.boolean(),
  notice: z.string(),
  files: z.array(
    z.object({
      filename: z.string(),
      mediaType: z.string(),
      encoding: z.enum(['utf-8', 'shift_jis']),
      contentBase64: z.string(),
    }),
  ),
});
export type FilingKind = z.infer<typeof filingKind>;
export type AccountingProfile = z.infer<typeof accountingProfileData>;
export type PayrollProfile = z.infer<typeof payrollProfileData>;
export type FilingIssue = z.infer<typeof filingIssue>;
export type FilingStatement = z.infer<typeof filingStatement>;
export type FilingPayrollRow = z.infer<typeof filingPayrollRow>;
export type FilingSummary = z.infer<typeof filingSummary>;
export type FilingDetail = z.infer<typeof filingDetailOutput>;
export type FilingBoard = z.infer<typeof filingBoardOutput>;
export type FilingExport = z.infer<typeof filingExportOutput>;
export type FilingProfileOption = z.infer<typeof filingProfileOption>;
