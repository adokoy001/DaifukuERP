import { Decimal, ValidationError } from '@daifuku/kernel';
import type { YearEndDeclaration } from '../fiscal-contract.ts';
import { annualBasic, declarationDeductions, qualifiesIncomeAdjustment } from './annual-deductions.ts';
import { ANNUAL_TAX_2026 as rule } from './fiscal-data.ts';
import { positive } from './monthly-tax.ts';
const D = Decimal.from;
export { annualBasic };
export function annualSalaryIncome(pay: Decimal): Decimal {
  if (pay.gt(rule.salaryLimit))
    throw new ValidationError('Annual salary exceeds the year-end adjustment limit', [
      {
        path: 'taxablePay',
        message: 'Salary above 20 million yen requires a tax return instead of this year-end workflow.',
      },
    ]);
  const band = rule.salary.find((row) => pay.lte(row.to));
  if (!band) throw new Error('Incomplete versioned annual salary table');
  const amount = band.classed ? pay.div(rule.salaryClassUnit).roundDown(0).times(rule.salaryClassUnit) : pay;
  return amount.times(band.rate).plus(band.offset).roundDown(0);
}
export function annualAdjustment(
  input: YearEndDeclaration,
  taxablePay: Decimal,
  socialPremium: Decimal,
  withheldTax: Decimal,
) {
  const salaryBeforeAdjustment = annualSalaryIncome(taxablePay);
  if (input.incomeAdjustmentEligible && !qualifiesIncomeAdjustment(input))
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
  const deductions = declarationDeductions(input, totalIncome, socialPremium),
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
    method: '2026-december-amendment',
    facts: input,
  };
}
