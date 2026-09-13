import { Decimal, ValidationError } from '@daifuku/kernel';
import type { YearEndDeclaration } from '@daifuku/mod-workforce';
import type { JapanPayrollRules } from '../../schema.ts';
import { annualBasic, declarationDeductions, qualifiesIncomeAdjustment } from './annual-deductions.ts';
import { positive } from './monthly-tax.ts';
const D = Decimal.from;
export { annualBasic };
export function annualSalaryIncome(rules: JapanPayrollRules, pay: Decimal): Decimal {
  const rule = rules.data.annualTax;
  if (pay.gt(rule.salaryLimit))
    throw new ValidationError('Annual salary exceeds the year-end adjustment limit', [
      {
        path: 'taxablePay',
        message: `Salary above ${rule.salaryLimit} yen requires a tax return instead of this year-end workflow.`,
      },
    ]);
  const band = rule.salary.find((row) => pay.lte(row.to));
  if (!band) throw new Error('Incomplete versioned annual salary table');
  const amount = band.classed ? pay.div(rule.salaryClassUnit).roundDown(0).times(rule.salaryClassUnit) : pay;
  return amount.times(band.rate).plus(band.offset).roundDown(0);
}
export function annualAdjustment(
  rules: JapanPayrollRules,
  input: YearEndDeclaration,
  taxablePay: Decimal,
  socialPremium: Decimal,
  withheldTax: Decimal,
) {
  const rule = rules.data.annualTax;
  if (input.taxYear !== rules.manifest.taxYear)
    throw new ValidationError('Year-end declaration does not match the selected tax year', [
      { path: 'taxYear', message: 'Select the installed rules for the declaration tax year.' },
    ]);
  const salaryBeforeAdjustment = annualSalaryIncome(rules, taxablePay);
  if (input.incomeAdjustmentEligible && !qualifiesIncomeAdjustment(rules, input))
    throw new ValidationError('Income adjustment eligibility is not supported by the declaration', [
      {
        path: 'incomeAdjustmentEligible',
        message: 'Declare the qualifying child or special disability and verify eligibility.',
      },
    ]);
  const incomeAdjustment =
    input.incomeAdjustmentEligible && taxablePay.gt(rule.incomeAdjustment.above)
      ? (taxablePay.gt(rule.incomeAdjustment.cap) ? D(rule.incomeAdjustment.cap) : taxablePay)
          .minus(rule.incomeAdjustment.above)
          .times(rule.incomeAdjustment.rate)
          .roundUp(0)
      : D(0);
  const salaryIncome = salaryBeforeAdjustment.minus(incomeAdjustment),
    totalIncome = salaryIncome.plus(input.otherIncome);
  const deductions = declarationDeductions(rules, input, totalIncome, socialPremium),
    taxableIncome = positive(salaryIncome.minus(deductions.total))
      .div(rule.taxableRoundUnit)
      .roundDown(0)
      .times(rule.taxableRoundUnit);
  const band = rule.tax.find((row) => taxableIncome.lte(row.to));
  if (!band)
    throw new ValidationError('Taxable income exceeds the annual adjustment table', [
      { path: 'taxablePay', message: 'Use a tax return for this income amount.' },
    ]);
  const beforeCredit = positive(taxableIncome.times(band.rate).minus(band.offset));
  const afterCredit = positive(beforeCredit.minus(input.housingTaxCredit)),
    annualTax = afterCredit
      .times(rule.reconstructionFactor)
      .div(rule.taxRoundUnit)
      .roundDown(0)
      .times(rule.taxRoundUnit);
  return {
    taxablePay,
    socialPremium,
    withheldTax,
    salaryBeforeAdjustment,
    incomeAdjustment,
    salaryIncome,
    totalIncome,
    deductions,
    taxableIncome,
    beforeCredit,
    housingTaxCredit: D(input.housingTaxCredit),
    afterCredit,
    annualTax,
    refund: positive(withheldTax.minus(annualTax)),
    additionalTax: positive(annualTax.minus(withheldTax)),
    method: rules.data.annualMethod,
    facts: input,
  };
}
