import { Decimal, ValidationError } from '@daifuku/kernel';
import type { PayrollConditionInput } from '@daifuku/mod-workforce';
import type { JapanPayrollRules, JapanPayrollParameters } from '../../schema.ts';
import { addDays, periodBounds } from './dates.ts';
const D = Decimal.from;
export function attainedAge(birthDate: string, on: string): number {
  const tomorrow = addDays(on, 1);
  return (
    Number(tomorrow.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (tomorrow.slice(5) < birthDate.slice(5) ? 1 : 0)
  );
}
export function payrollInsuranceRound(parameters: JapanPayrollParameters, amount: Decimal): Decimal {
  const floor = amount.roundDown(0);
  return amount.minus(floor).gt(parameters.insurance.roundingThreshold) ? floor.plus(1) : floor;
}
function fail(path: string, message: string): never {
  throw new ValidationError('Payroll insurance conditions require correction', [{ path, message }]);
}
export function validateCondition(rules: JapanPayrollRules, input: PayrollConditionInput): void {
  if (input.validFrom > input.validTo || input.birthDate > input.validFrom)
    fail('validFrom', 'Check the effective interval and birth date.');
  for (const [membership, standard, grades, path] of [
    [input.healthMembership, input.healthStandardMonthly, rules.data.healthGrades, 'healthStandardMonthly'],
    [input.pensionMembership, input.pensionStandardMonthly, rules.data.pensionGrades, 'pensionStandardMonthly'],
  ] as const) {
    if (membership === 'enrolled' && (standard === null || !grades.includes(standard)))
      fail(path, 'Enter the verified standard remuneration grade; do not substitute actual salary.');
    if (membership !== 'enrolled' && standard !== null)
      fail(path, 'Use null for explicitly exempt or non-enrolled insurance.');
  }
}
export function socialInsurance(
  rules: JapanPayrollRules,
  condition: PayrollConditionInput,
  insurancePeriod: string,
  wageCutoff: string,
  wage: Decimal,
) {
  validateCondition(rules, condition);
  const parameters = rules.manifest.parameters;
  const healthTable = rules.data.health.find((row) => row.from <= insurancePeriod && row.to >= insurancePeriod),
    nursingTable = rules.data.nursing.find((row) => row.from <= insurancePeriod && row.to >= insurancePeriod);
  const employmentTable = rules.data.employment.find((row) => row.from <= wageCutoff && row.to >= wageCutoff);
  if (!healthTable || !nursingTable || !employmentTable)
    fail('insurancePeriod', 'The insurance month and wage cutoff must be covered by the selected rules version.');
  const healthPercent = healthTable.percentages[Number(condition.healthBranch) - 1];
  if (!healthPercent) fail('healthBranch', 'Select a Kyokai Kenpo prefecture.');
  const age = attainedAge(condition.birthDate, periodBounds(insurancePeriod).end),
    nursing = age >= parameters.insurance.nursingAgeFrom && age < parameters.insurance.nursingAgeToExclusive;
  const monthEnd = periodBounds(insurancePeriod).end,
    birthdayAge =
      Number(monthEnd.slice(0, 4)) -
      Number(condition.birthDate.slice(0, 4)) -
      (monthEnd.slice(5) < condition.birthDate.slice(5) ? 1 : 0);
  if (condition.healthMembership === 'enrolled' && birthdayAge >= parameters.insurance.healthAgeToExclusive)
    fail(
      'healthMembership',
      'Later-stage elderly insurance is outside this calculation; verify the actual membership.',
    );
  if (condition.pensionMembership === 'enrolled' && age >= parameters.insurance.pensionAgeToExclusive)
    fail('pensionMembership', 'The declared age is outside ordinary pension enrollment in this rules version.');
  const healthBase = condition.healthMembership === 'enrolled' ? D(condition.healthStandardMonthly ?? '0') : D(0);
  const health = payrollInsuranceRound(
    parameters,
    healthBase.times(healthPercent).div(parameters.insurance.employeePercentDivisor),
  );
  // The public table gives health including nursing as one amount; allocate the rounded difference.
  const combinedHealth = payrollInsuranceRound(
    parameters,
    healthBase
      .times(D(healthPercent).plus(nursing ? nursingTable.percent : 0))
      .div(parameters.insurance.employeePercentDivisor),
  );
  const childSupport =
    insurancePeriod >= rules.data.childSupportFrom
      ? payrollInsuranceRound(
          parameters,
          healthBase.times(rules.data.childSupportPercent).div(parameters.insurance.employeePercentDivisor),
        )
      : D(0);
  const pension =
    condition.pensionMembership === 'enrolled'
      ? payrollInsuranceRound(
          parameters,
          D(condition.pensionStandardMonthly ?? '0')
            .times(rules.data.pensionPercent)
            .div(parameters.insurance.employeePercentDivisor),
        )
      : D(0);
  const employment =
    condition.employmentMembership === 'enrolled'
      ? payrollInsuranceRound(parameters, wage.times(employmentTable[condition.employmentCategory]))
      : D(0);
  return {
    health,
    nursing: combinedHealth.minus(health),
    childSupport,
    pension,
    employment,
    total: combinedHealth.plus(childSupport).plus(pension).plus(employment),
    insurancePeriod,
    wageCutoff,
    attainedAge: age,
    healthPercent,
    nursingPercent: nursing ? nursingTable.percent : '0',
    childSupportPercent: insurancePeriod >= rules.data.childSupportFrom ? rules.data.childSupportPercent : '0',
    pensionPercent: rules.data.pensionPercent,
    employmentRate: employmentTable[condition.employmentCategory],
    rounding: rules.data.insuranceRounding,
  };
}
