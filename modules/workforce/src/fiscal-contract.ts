// Shared JSON wire contract: verified facts are explicit; yen amounts are decimal strings.
import { z } from 'zod';
const id = z.uuid(),
  date = z.iso.date(),
  year = z.literal(2026),
  version = z.number().int().min(1),
  editVersion = z.number().int().min(0);
export const fiscalMoney = z.string().regex(/^\d{1,12}$/),
  fiscalMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const reason = z.string().trim().min(1).max(1000),
  membership = z.enum(['enrolled', 'not_enrolled', 'exempt']);
export const payrollConditionData = z
  .object({
    validFrom: date,
    validTo: date,
    birthDate: date,
    taxCategory: z.literal('ko'),
    resident: z.literal(true),
    declarationReceived: z.literal(true),
    sourceDependentCount: z.number().int().min(0).max(20),
    healthMembership: membership,
    healthBranch: z.string().regex(/^(0[1-9]|[1-3][0-9]|4[0-7])$/),
    healthStandardMonthly: fiscalMoney.nullable(),
    pensionMembership: membership,
    pensionStandardMonthly: fiscalMoney.nullable(),
    employmentMembership: z.enum(['enrolled', 'not_enrolled']),
    employmentCategory: z.enum(['general', 'agriculture_sake', 'construction']),
    residentTaxAmount: fiscalMoney,
    residentTaxBasis: reason,
    membershipBasis: reason,
    verified: z.literal(true),
    basis: reason,
  })
  .strict();
export const savePayrollConditionInput = payrollConditionData
  .extend({ conditionId: id.optional(), employeeId: id, expectedVersion: editVersion })
  .strict();
export const supersedePayrollConditionInput = savePayrollConditionInput.extend({ conditionId: id }).strict();
export const fiscalAllowance = z
  .object({ name: z.string().trim().min(1).max(100), amount: fiscalMoney, basis: reason })
  .strict();
export const statutoryPayrollInput = z
  .object({
    employeeId: id,
    period: fiscalMonth,
    expectedVersion: editVersion,
    attendanceCompleteConfirmed: z.literal(true),
    paymentDate: date,
    insurancePeriod: fiscalMonth,
    taxableAllowances: z.array(fiscalAllowance).max(30),
    nonTaxableAllowances: z.array(fiscalAllowance).max(30),
    otherDeduction: z.object({ amount: fiscalMoney, basis: reason }).strict(),
  })
  .strict();
export const payrollTaxEvidenceInput = z
  .object({ payrollId: id, paymentDate: date, taxablePay: fiscalMoney, basis: reason, verified: z.literal(true) })
  .strict();
const relative = z
  .object({
    claimDependentDeduction: z.boolean(),
    code: z.string().trim().min(1).max(80),
    birthDate: date,
    income: fiscalMoney,
    cohabitingElderlyParent: z.boolean(),
    disability: z.enum(['none', 'ordinary', 'special', 'cohabiting_special']),
    resident: z.literal(true),
    sharedLivelihoodConfirmed: z.literal(true),
    eligibilityConfirmed: z.literal(true),
  })
  .strict();
const spouse = z
  .object({
    birthDate: date,
    income: fiscalMoney,
    disability: z.enum(['none', 'ordinary', 'special', 'cohabiting_special']),
    sharedLivelihoodConfirmed: z.literal(true),
    eligibilityConfirmed: z.literal(true),
    specialDeductionNotDuplicated: z.literal(true),
  })
  .strict();
export const yearEndDeclarationData = z
  .object({
    taxYear: year,
    resident: z.literal(true),
    mainEmployer: z.literal(true),
    factsConfirmed: z.literal(true),
    otherIncome: fiscalMoney,
    spouse: spouse.nullable(),
    relatives: z.array(relative).max(30),
    taxpayerDisability: z.enum(['none', 'ordinary', 'special']),
    widow: z.boolean(),
    singleParent: z.boolean(),
    student: z.boolean(),
    studentNonSalaryIncome: fiscalMoney,
    incomeAdjustmentEligible: z.boolean(),
    lifeNew: fiscalMoney,
    lifeOld: fiscalMoney,
    nursingLife: fiscalMoney,
    pensionLifeNew: fiscalMoney,
    pensionLifeOld: fiscalMoney,
    earthquakePremium: fiscalMoney,
    oldLongTermPremium: fiscalMoney,
    distinctEarthquakeContractsConfirmed: z.literal(true),
    personalSocialPremium: fiscalMoney,
    smallEnterpriseContributions: fiscalMoney,
    housingTaxCredit: fiscalMoney,
    housingEligibilityConfirmed: z.literal(true),
    previousEmployers: z
      .array(
        z
          .object({
            name: reason,
            taxablePay: fiscalMoney,
            socialPremium: fiscalMoney,
            incomeTax: fiscalMoney,
            evidence: reason,
          })
          .strict(),
      )
      .max(10),
    unpaidMonths: z.array(z.object({ period: fiscalMonth, reason }).strict()).max(12),
    evidence: reason,
  })
  .strict();
export const submitYearEndDeclarationInput = yearEndDeclarationData.extend({ expectedVersion: editVersion }).strict();
export const reviewYearEndDeclarationInput = z
  .object({ declarationId: id, expectedVersion: version, decision: z.enum(['accept', 'return']), reason })
  .strict();
export const calculateYearEndInput = z
  .object({
    employeeId: id,
    taxYear: year,
    expectedVersion: editVersion,
    adjustedOn: date,
    annualPayrollCompleteConfirmed: z.literal(true),
  })
  .strict();
export const confirmYearEndInput = z
  .object({ adjustmentId: id, expectedVersion: version, calculationConfirmed: z.literal(true), reason })
  .strict();
export const cancelYearEndInput = z.object({ adjustmentId: id, expectedVersion: version, reason }).strict();
export const settleYearEndInput = z
  .object({ adjustmentId: id, expectedVersion: version, settledOn: date, reference: reason })
  .strict();
export const fiscalBoardInput = z.object({ taxYear: year }).strict();
export const fiscalConditionSummary = payrollConditionData.extend({ id, employeeId: id, version });
export const declarationSummary = z.object({
  id,
  employeeId: id,
  taxYear: year,
  status: z.enum(['submitted', 'accepted', 'returned']),
  declaration: yearEndDeclarationData,
  reviewReason: z.string().nullable(),
  version,
});
export const adjustmentSummary = z.object({
  id,
  employeeId: id,
  taxYear: year,
  status: z.enum(['draft', 'confirmed', 'cancelled']),
  adjustedOn: date,
  taxablePay: fiscalMoney,
  annualTax: fiscalMoney,
  withheldTax: fiscalMoney,
  refund: fiscalMoney,
  additionalTax: fiscalMoney,
  calculation: z.record(z.string(), z.unknown()),
  settledOn: date.nullable(),
  settlementReference: z.string().nullable(),
  version,
});
export const fiscalBoardOutput = z.object({
  taxYear: year,
  employees: z.array(z.object({ id, name: z.string(), code: z.string(), siteId: id })),
  rules: z.array(z.object({ id, code: z.string(), taxYear: year, sources: z.array(z.string()) })),
  conditions: z.array(fiscalConditionSummary),
  declarations: z.array(declarationSummary),
  adjustments: z.array(adjustmentSummary),
  taxEvidence: z.array(
    z.object({
      id,
      payrollId: id,
      paymentDate: date,
      taxablePay: fiscalMoney,
      socialPremium: fiscalMoney,
      incomeTax: fiscalMoney,
      basis: z.string(),
    }),
  ),
});
export const myFiscalOutput = z.object({
  taxYear: year,
  employeeId: id.nullable(),
  declaration: declarationSummary.nullable(),
  adjustments: z.array(adjustmentSummary),
});
export type PayrollConditionInput = z.infer<typeof payrollConditionData>;
export type StatutoryPayrollInput = z.infer<typeof statutoryPayrollInput>;
export type YearEndDeclaration = z.infer<typeof yearEndDeclarationData>;
export type FiscalBoard = z.infer<typeof fiscalBoardOutput>;
export type MyFiscal = z.infer<typeof myFiscalOutput>;
