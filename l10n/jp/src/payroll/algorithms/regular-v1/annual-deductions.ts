import { Decimal, ValidationError } from '@daifuku/kernel';
import type { YearEndDeclaration } from '@daifuku/mod-workforce';
import type { JapanPayrollRules, JapanPayrollData } from '../../schema.ts';
import { attainedAge } from './social-insurance.ts';
const D = Decimal.from;
const age = (rules: JapanPayrollRules, birth: string) =>
  attainedAge(birth, rules.manifest.applicability.yearEndFactsOn);
const min = (amount: Decimal, cap: number): Decimal => (amount.gt(cap) ? D(cap) : amount);
function invalid(path: string, message: string): never {
  throw new ValidationError('Year-end declaration is inconsistent', [{ path, message }]);
}
export function annualBasic(rules: JapanPayrollRules, income: Decimal): Decimal {
  return D(rules.data.annualTax.basic.find(([upper]) => income.lte(upper))?.[1] ?? 0);
}
function disability(rules: JapanPayrollRules, kind: keyof JapanPayrollData['deductions']['disability']): Decimal {
  const rule = rules.data.deductions;
  return D(rule.disability[kind]);
}
function spouseDeduction(rules: JapanPayrollRules, input: YearEndDeclaration, income: Decimal): Decimal {
  const rule = rules.data.deductions;
  const spouse = input.spouse;
  const column = rule.spouseTaxpayerBands.findIndex((upper) => income.lte(upper));
  if (!spouse || column < 0) return D(0);
  const amount = D(spouse.income);
  if (amount.lte(rule.dependentIncomeLimit))
    return D((age(rules, spouse.birthDate) >= rule.elderlyAge ? rule.spouseElderly : rule.spouseOrdinary)[column] ?? 0);
  return D(rule.spouseSpecial.find((row) => amount.lte(row[0]))?.[column + 1] ?? 0);
}

function relativeDeduction(rules: JapanPayrollRules, relative: YearEndDeclaration['relatives'][number]): Decimal {
  const rule = rules.data.deductions;
  const years = age(rules, relative.birthDate);
  const income = D(relative.income);
  if (income.lte(rule.dependentIncomeLimit))
    return D(
      years < rule.dependentMinimumAge
        ? 0
        : years < rule.specificAgeFrom
          ? rule.relativeOrdinary
          : years <= rule.specificAgeTo
            ? rule.relativeSpecific
            : years < rule.elderlyAge
              ? rule.relativeOrdinary
              : relative.cohabitingElderlyParent
                ? rule.relativeCohabitingElderly
                : rule.relativeElderly,
    );
  if (years < rule.specificAgeFrom || years > rule.specificAgeTo) return D(0);
  return D(rule.relativeSpecial.find((row) => income.lte(row[0]))?.[1] ?? 0);
}

function life(rules: JapanPayrollRules, premium: string, old = false, child = false): Decimal {
  const rule = rules.data.deductions;
  const a = D(premium);
  const unit = old ? rule.life.oldUnit : child ? rule.life.childUnit : rule.life.modernUnit;
  const parameters = rules.manifest.parameters.life;
  return (
    a.lte(unit)
      ? a
      : a.lte(D(unit).times(parameters.secondBandMultiple))
        ? a.div(parameters.secondDivisor).plus(D(unit).div(parameters.secondOffsetDivisor))
        : a.lte(D(unit).times(parameters.thirdBandMultiple))
          ? a.div(parameters.thirdDivisor).plus(unit)
          : D(unit).times(parameters.capMultiple)
  ).roundUp(0);
}
function combinedLife(rules: JapanPayrollRules, newPremium: string, oldPremium: string, child = false): Decimal {
  const rule = rules.data.deductions;
  const modern = life(rules, newPremium, false, child);
  const old = life(rules, oldPremium, true);
  const combined = min(modern.plus(old), child ? rule.life.childCombinedCap : rule.life.modernCombinedCap);
  return old.gt(combined) ? old : combined;
}
function insuranceDeduction(rules: JapanPayrollRules, input: YearEndDeclaration) {
  const rule = rules.data.deductions;
  const child = input.relatives.some(
    (person) =>
      age(rules, person.birthDate) < rule.childLifeAgeLimit && D(person.income).lte(rule.dependentIncomeLimit),
  );
  const general = combinedLife(rules, input.lifeNew, input.lifeOld, child);
  const nursing = life(rules, input.nursingLife);
  const pension = combinedLife(rules, input.pensionLifeNew, input.pensionLifeOld);
  const earthquake = min(D(input.earthquakePremium), rule.earthquake.cap);
  const old = D(input.oldLongTermPremium);
  const oldDeduction = old.lte(rule.earthquake.oldFirst)
    ? old
    : old.lte(rule.earthquake.oldSecond)
      ? old.div(rules.manifest.parameters.oldEarthquakeDivisor).plus(rule.earthquake.oldOffset).roundUp(0)
      : D(rule.earthquake.oldCap);
  return {
    generalLife: general,
    nursingLife: nursing,
    pensionLife: pension,
    life: min(general.plus(nursing).plus(pension), rule.life.totalCap),
    earthquake: min(earthquake.plus(oldDeduction), rule.earthquake.cap),
    under23Dependent: child,
  };
}
export function declarationDeductions(
  rules: JapanPayrollRules,
  input: YearEndDeclaration,
  income: Decimal,
  payrollSocial: Decimal,
) {
  const rule = rules.data.deductions;
  if (new Set(input.relatives.map((row) => row.code)).size !== input.relatives.length)
    invalid('relatives', 'Each relative must be declared once.');
  if ((input.widow && input.singleParent) || ((input.widow || input.singleParent) && input.spouse))
    invalid('singleParent', 'Widow and single-parent status cannot overlap or apply with a spouse.');
  if ((input.widow || input.singleParent) && income.gt(rule.singleIncomeLimit))
    invalid(
      'singleParent',
      `This deduction requires total income of no more than ${rule.singleIncomeLimit} yen and confirmed eligibility.`,
    );
  if (
    input.student &&
    (income.gt(rule.studentIncomeLimit) || D(input.studentNonSalaryIncome).gt(rule.studentNonWorkLimit))
  )
    invalid(
      'student',
      `Student deduction requires income <=${rule.studentIncomeLimit} and non-work income <=${rule.studentNonWorkLimit} yen.`,
    );
  if (
    input.relatives.some(
      (row) =>
        row.birthDate > rules.manifest.applicability.yearEndFactsOn ||
        (row.cohabitingElderlyParent && age(rules, row.birthDate) < rule.elderlyAge),
    ) ||
    (input.spouse && input.spouse.birthDate > rules.manifest.applicability.yearEndFactsOn)
  )
    invalid('relatives', 'Check the year-end birth dates and elderly-parent classification.');
  const relatives = input.relatives
    .filter((row) => row.claimDependentDeduction)
    .reduce((sum, row) => sum.plus(relativeDeduction(rules, row)), D(0));
  const disabledRelatives = input.relatives
    .filter((row) => row.claimDependentDeduction && D(row.income).lte(rule.dependentIncomeLimit))
    .reduce((sum, row) => sum.plus(disability(rules, row.disability)), D(0));
  const spouseDisability =
    input.spouse && D(input.spouse.income).lte(rule.dependentIncomeLimit)
      ? disability(rules, input.spouse.disability)
      : D(0);
  const insurance = insuranceDeduction(rules, input);
  const social = payrollSocial.plus(input.personalSocialPremium);
  const amounts = {
    basic: annualBasic(rules, income),
    spouse: spouseDeduction(rules, input, income),
    relatives,
    disability: disability(rules, input.taxpayerDisability).plus(disabledRelatives).plus(spouseDisability),
    widowOrSingleParent: D(input.singleParent ? rule.singleParent : input.widow ? rule.widow : 0),
    student: D(input.student ? rule.student : 0),
    social,
    smallEnterprise: D(input.smallEnterpriseContributions),
    life: insurance.life,
    earthquake: insurance.earthquake,
  };
  return { ...amounts, insurance, total: Object.values(amounts).reduce((sum, amount) => sum.plus(amount), D(0)) };
}
export function qualifiesIncomeAdjustment(rules: JapanPayrollRules, input: YearEndDeclaration): boolean {
  const rule = rules.data.deductions;
  return (
    input.taxpayerDisability === 'special' ||
    !!(
      input.spouse &&
      D(input.spouse.income).lte(rule.dependentIncomeLimit) &&
      ['special', 'cohabiting_special'].includes(input.spouse.disability)
    ) ||
    input.relatives.some(
      (row) =>
        D(row.income).lte(rule.dependentIncomeLimit) &&
        (age(rules, row.birthDate) < rule.childLifeAgeLimit ||
          ['special', 'cohabiting_special'].includes(row.disability)),
    )
  );
}
