import type { Decimal } from '@daifuku/kernel';
import type { PayrollConditionInput, YearEndDeclaration } from '../fiscal-contract.ts';

export const PAYROLL_RULE_PROVIDERS_OVERRIDE = 'workforce.country_payroll_rules';
export type { PayrollConditionInput, YearEndDeclaration };

export interface PayrollRuleRange {
  from: string;
  to: string;
}

export interface PayrollRuleManifest {
  manifestSchema: 1;
  packageCode: string;
  revision: number;
  country: string;
  currency: string;
  regime: string;
  taxYear: number;
  dataSchema: string;
  algorithmVersion: string;
  parameters: Readonly<Record<string, unknown>>;
  applicability: {
    paymentDates: PayrollRuleRange;
    insuranceMonths: PayrollRuleRange;
    wageCutoffDates: PayrollRuleRange;
    adjustmentDates: PayrollRuleRange;
    yearEndFactsOn: string;
    requiredFinalPaymentFrom: string;
  };
  supersedesPackageCode?: string | undefined;
}

/** Data is the installed database payload, never an implicit catalog replacement. */
export interface PayrollRuleBundle {
  code: string;
  taxYear: number;
  verifiedOn: string;
  data: unknown;
  sources: readonly string[];
  manifest: PayrollRuleManifest;
}

export interface MonthlyPayrollTax {
  taxablePay: Decimal;
  socialPremium: Decimal;
  afterSocialPremium: Decimal;
  salaryDeduction: Decimal;
  basicDeduction: Decimal;
  dependentDeduction: Decimal;
  taxableIncome: Decimal;
  incomeTax: Decimal;
  method: string;
}

export interface PayrollInsurance {
  health: Decimal;
  nursing: Decimal;
  childSupport: Decimal;
  pension: Decimal;
  employment: Decimal;
  total: Decimal;
  insurancePeriod: string;
  wageCutoff: string;
  attainedAge: number;
  healthPercent: string;
  nursingPercent: string;
  childSupportPercent: string;
  pensionPercent: string;
  employmentRate: string;
  rounding: string;
}

export interface AnnualPayrollDeductions {
  basic: Decimal;
  spouse: Decimal;
  relatives: Decimal;
  disability: Decimal;
  widowOrSingleParent: Decimal;
  student: Decimal;
  social: Decimal;
  smallEnterprise: Decimal;
  life: Decimal;
  earthquake: Decimal;
  total: Decimal;
  insurance: {
    generalLife: Decimal;
    nursingLife: Decimal;
    pensionLife: Decimal;
    life: Decimal;
    earthquake: Decimal;
    under23Dependent: boolean;
  };
}

export interface AnnualPayrollTax {
  taxablePay: Decimal;
  socialPremium: Decimal;
  withheldTax: Decimal;
  salaryBeforeAdjustment: Decimal;
  incomeAdjustment: Decimal;
  salaryIncome: Decimal;
  totalIncome: Decimal;
  deductions: AnnualPayrollDeductions;
  taxableIncome: Decimal;
  beforeCredit: Decimal;
  housingTaxCredit: Decimal;
  afterCredit: Decimal;
  annualTax: Decimal;
  refund: Decimal;
  additionalTax: Decimal;
  method: string;
  facts: YearEndDeclaration;
}

/** Country-owned, synchronous pure algorithms. Installation and selection belong to workforce. */
export interface CountryPayrollProvider {
  readonly id: string;
  readonly country: string;
  readonly currency: string;
  bundles(): readonly PayrollRuleBundle[];
  validate(bundle: PayrollRuleBundle): void;
  validateCondition(bundle: PayrollRuleBundle, condition: PayrollConditionInput): void;
  monthly(bundle: PayrollRuleBundle, pay: Decimal, social: Decimal, dependents: number): MonthlyPayrollTax;
  insurance(
    bundle: PayrollRuleBundle,
    condition: PayrollConditionInput,
    insurancePeriod: string,
    wageCutoff: string,
    wage: Decimal,
  ): PayrollInsurance;
  annual(
    bundle: PayrollRuleBundle,
    declaration: YearEndDeclaration,
    pay: Decimal,
    social: Decimal,
    withheldTax: Decimal,
  ): AnnualPayrollTax;
}

export type PayrollRuleProviders = () => readonly CountryPayrollProvider[];
