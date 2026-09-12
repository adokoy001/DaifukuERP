import { Decimal, ValidationError } from '@daifuku/kernel';
import type { YearEndDeclaration } from '../fiscal-contract.ts';
import { ANNUAL_TAX_2026, DEDUCTIONS_2026 as rule } from './fiscal-data.ts';
import { attainedAge } from './social-insurance.ts';
const D = Decimal.from, age = (birth: string) => attainedAge(birth, '2026-12-31');
const min = (amount: Decimal, cap: number): Decimal => amount.gt(cap) ? D(cap) : amount;
function invalid(path: string, message: string): never { throw new ValidationError('Year-end declaration is inconsistent', [{ path, message }]); }
export function annualBasic(income: Decimal): Decimal { return D(ANNUAL_TAX_2026.basic.find(([upper]) => income.lte(upper))?.[1] ?? 0); }
function disability(kind: keyof typeof rule.disability): Decimal { return D(rule.disability[kind]); }
function spouseDeduction(input: YearEndDeclaration, income: Decimal): Decimal {
  const spouse = input.spouse, column = rule.spouseTaxpayerBands.findIndex((upper) => income.lte(upper));
  if (!spouse || column < 0) return D(0);
  const amount = D(spouse.income);
  if (amount.lte(rule.dependentIncomeLimit)) return D((age(spouse.birthDate) >= rule.elderlyAge ? rule.spouseElderly : rule.spouseOrdinary)[column] ?? 0);
  return D(rule.spouseSpecial.find((row) => amount.lte(row[0]))?.[column + 1] ?? 0);
}

function relativeDeduction(relative: YearEndDeclaration['relatives'][number]): Decimal {
  const years = age(relative.birthDate), income = D(relative.income);
  if (income.lte(rule.dependentIncomeLimit)) return D(years < rule.dependentMinimumAge ? 0 : years < rule.specificAgeFrom ? rule.relativeOrdinary : years <= rule.specificAgeTo ? rule.relativeSpecific : years < rule.elderlyAge ? rule.relativeOrdinary : relative.cohabitingElderlyParent ? rule.relativeCohabitingElderly : rule.relativeElderly);
  if (years < rule.specificAgeFrom || years > rule.specificAgeTo) return D(0);
  return D(rule.relativeSpecial.find((row) => income.lte(row[0]))?.[1] ?? 0);
}

function life(premium: string, old = false, child = false): Decimal {
  const a = D(premium), unit = old ? rule.life.oldUnit : child ? rule.life.childUnit : rule.life.modernUnit;
  return (a.lte(unit) ? a : a.lte(unit * 2) ? a.div(2).plus(unit / 2) : a.lte(unit * 4) ? a.div(4).plus(unit) : D(unit * 2)).roundUp(0);
}
function combinedLife(newPremium: string, oldPremium: string, child = false): Decimal {
  const modern = life(newPremium, false, child), old = life(oldPremium, true), combined = min(modern.plus(old), child ? rule.life.childCombinedCap : rule.life.modernCombinedCap);
  return old.gt(combined) ? old : combined;
}
function insuranceDeduction(input: YearEndDeclaration) {
  const child = input.relatives.some((person) => age(person.birthDate) < rule.childLifeAgeLimit && D(person.income).lte(rule.dependentIncomeLimit));
  const general = combinedLife(input.lifeNew, input.lifeOld, child), nursing = life(input.nursingLife), pension = combinedLife(input.pensionLifeNew, input.pensionLifeOld);
  const earthquake = min(D(input.earthquakePremium), rule.earthquake.cap), old = D(input.oldLongTermPremium);
  const oldDeduction = old.lte(rule.earthquake.oldFirst) ? old : old.lte(rule.earthquake.oldSecond) ? old.div(2).plus(rule.earthquake.oldOffset).roundUp(0) : D(rule.earthquake.oldCap);
  return { generalLife: general, nursingLife: nursing, pensionLife: pension, life: min(general.plus(nursing).plus(pension), rule.life.totalCap), earthquake: min(earthquake.plus(oldDeduction), rule.earthquake.cap), under23Dependent: child };
}
export function declarationDeductions(input: YearEndDeclaration, income: Decimal, payrollSocial: Decimal) {
  if (new Set(input.relatives.map((row) => row.code)).size !== input.relatives.length) invalid('relatives', 'Each relative must be declared once.');
  if ((input.widow && input.singleParent) || ((input.widow || input.singleParent) && input.spouse)) invalid('singleParent', 'Widow and single-parent status cannot overlap or apply with a spouse.');
  if ((input.widow || input.singleParent) && income.gt(rule.singleIncomeLimit)) invalid('singleParent', 'This deduction requires total income of no more than 5 million yen and confirmed eligibility.');
  if (input.student && (income.gt(rule.studentIncomeLimit) || D(input.studentNonSalaryIncome).gt(rule.studentNonWorkLimit))) invalid('student', '2026 student deduction requires income <=890,000 and non-work income <=100,000 yen.');
  if (input.relatives.some((row) => row.birthDate > '2026-12-31' || (row.cohabitingElderlyParent && age(row.birthDate) < rule.elderlyAge)) || (input.spouse && input.spouse.birthDate > '2026-12-31')) invalid('relatives', 'Check the year-end birth dates and elderly-parent classification.');
  const relatives = input.relatives.filter((row) => row.claimDependentDeduction).reduce((sum, row) => sum.plus(relativeDeduction(row)), D(0));
  const disabledRelatives = input.relatives.filter((row) => row.claimDependentDeduction && D(row.income).lte(rule.dependentIncomeLimit)).reduce((sum, row) => sum.plus(disability(row.disability)), D(0));
  const spouseDisability = input.spouse && D(input.spouse.income).lte(rule.dependentIncomeLimit) ? disability(input.spouse.disability) : D(0);
  const insurance = insuranceDeduction(input), social = payrollSocial.plus(input.personalSocialPremium);
  const amounts = { basic: annualBasic(income), spouse: spouseDeduction(input, income), relatives, disability: disability(input.taxpayerDisability).plus(disabledRelatives).plus(spouseDisability), widowOrSingleParent: D(input.singleParent ? rule.singleParent : input.widow ? rule.widow : 0), student: D(input.student ? rule.student : 0), social, smallEnterprise: D(input.smallEnterpriseContributions), life: insurance.life, earthquake: insurance.earthquake };
  return { ...amounts, insurance, total: Object.values(amounts).reduce((sum, amount) => sum.plus(amount), D(0)) };
}
export function qualifiesIncomeAdjustment(input: YearEndDeclaration): boolean {
  return input.taxpayerDisability === 'special' || !!(input.spouse && D(input.spouse.income).lte(rule.dependentIncomeLimit) && ['special', 'cohabiting_special'].includes(input.spouse.disability)) || input.relatives.some((row) => D(row.income).lte(rule.dependentIncomeLimit) && (age(row.birthDate) < rule.childLifeAgeLimit || ['special', 'cohabiting_special'].includes(row.disability)));
}
