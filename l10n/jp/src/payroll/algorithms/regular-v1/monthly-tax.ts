import { Decimal } from '@daifuku/kernel';
import type { JapanPayrollRules } from '../../schema.ts';
const D = Decimal.from;
export const positive = (value: Decimal): Decimal => (value.isNegative() ? D(0) : value);
export function monthlyWithholding(
  rules: JapanPayrollRules,
  taxablePay: Decimal,
  socialPremium: Decimal,
  dependents: number,
) {
  const a = positive(taxablePay.minus(socialPremium));
  const rule = rules.data.monthlyTax,
    salary = rule.salary.find((row) => row.to === null || a.lte(row.to));
  if (!salary) throw new Error('Incomplete versioned monthly tax table');
  const salaryDeduction = a.times(salary.rate).plus(salary.fixed).roundUp(0);
  const basicDeduction = D(rule.basic.find(([upper]) => a.lte(upper))?.[1] ?? 0);
  const dependentDeduction = D(rule.dependent).times(dependents),
    b = positive(a.minus(salaryDeduction).minus(basicDeduction).minus(dependentDeduction));
  const band = rule.tax.find((row) => row.to === null || b.lte(row.to));
  if (!band) throw new Error('Incomplete versioned monthly tax bands');
  const incomeTax = positive(b.times(band.rate).minus(band.offset))
    .div(rule.taxRoundUnit)
    .roundHalfUp(0)
    .times(rule.taxRoundUnit);
  return {
    taxablePay,
    socialPremium,
    afterSocialPremium: a,
    salaryDeduction,
    basicDeduction,
    dependentDeduction,
    taxableIncome: b,
    incomeTax,
    method: rules.data.monthlyMethod,
  };
}
