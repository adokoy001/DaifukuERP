import { Decimal, ValidationError } from '@daifuku/kernel';
import type { PayrollConditionInput } from '../fiscal-contract.ts';
import { addDays, periodBounds } from './time.ts';
import { FISCAL_DATA, HEALTH_GRADES, PENSION_GRADES } from './fiscal-data.ts';
const D = Decimal.from;
export function attainedAge(birthDate: string, on: string): number {
  const tomorrow = addDays(on, 1);
  return Number(tomorrow.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (tomorrow.slice(5) < birthDate.slice(5) ? 1 : 0);
}
export function payrollInsuranceRound(amount: Decimal): Decimal { const floor = amount.roundDown(0); return amount.minus(floor).gt('0.5') ? floor.plus(1) : floor; }
function fail(path: string, message: string): never { throw new ValidationError('Payroll insurance conditions require correction', [{ path, message }]); }
export function validateCondition(input: PayrollConditionInput): void {
  if (input.validFrom > input.validTo || input.birthDate > input.validFrom) fail('validFrom', 'Check the effective interval and birth date.');
  for (const [membership, standard, grades, path] of [[input.healthMembership, input.healthStandardMonthly, HEALTH_GRADES, 'healthStandardMonthly'], [input.pensionMembership, input.pensionStandardMonthly, PENSION_GRADES, 'pensionStandardMonthly']] as const) {
    if (membership === 'enrolled' && (standard === null || !grades.includes(standard))) fail(path, 'Enter the verified standard remuneration grade; do not substitute actual salary.');
    if (membership !== 'enrolled' && standard !== null) fail(path, 'Use null for explicitly exempt or non-enrolled insurance.');
  }
}
export function socialInsurance(condition: PayrollConditionInput, insurancePeriod: string, wageCutoff: string, wage: Decimal) {
  validateCondition(condition);
  const healthTable = FISCAL_DATA.health.find((row) => row.from <= insurancePeriod && row.to >= insurancePeriod), nursingTable = FISCAL_DATA.nursing.find((row) => row.from <= insurancePeriod && row.to >= insurancePeriod);
  const employmentTable = FISCAL_DATA.employment.find((row) => row.from <= wageCutoff && row.to >= wageCutoff);
  if (!healthTable || !nursingTable || !employmentTable) fail('insurancePeriod', 'This rules version covers insurance December 2025–December 2026 and regular payments in 2026.');
  const healthPercent = healthTable.percentages[Number(condition.healthBranch) - 1];
  if (!healthPercent) fail('healthBranch', 'Select a Kyokai Kenpo prefecture.');
  const age = attainedAge(condition.birthDate, periodBounds(insurancePeriod).end), nursing = age >= 40 && age < 65;
  const monthEnd = periodBounds(insurancePeriod).end, birthdayAge = Number(monthEnd.slice(0, 4)) - Number(condition.birthDate.slice(0, 4)) - (monthEnd.slice(5) < condition.birthDate.slice(5) ? 1 : 0);
  if (condition.healthMembership === 'enrolled' && birthdayAge >= 75) fail('healthMembership', 'Later-stage elderly insurance is outside this calculation; verify the actual membership.');
  if (condition.pensionMembership === 'enrolled' && age >= 70) fail('pensionMembership', 'Ordinary pension enrollment at age 70 or over is unsupported.');
  const healthBase = condition.healthMembership === 'enrolled' ? D(condition.healthStandardMonthly ?? '0') : D(0);
  const health = payrollInsuranceRound(healthBase.times(healthPercent).div(200));
  // The public table gives health including nursing as one amount; allocate the rounded difference.
  const combinedHealth = payrollInsuranceRound(healthBase.times(D(healthPercent).plus(nursing ? nursingTable.percent : 0)).div(200));
  const childSupport = insurancePeriod >= FISCAL_DATA.childSupportFrom ? payrollInsuranceRound(healthBase.times(FISCAL_DATA.childSupportPercent).div(200)) : D(0);
  const pension = condition.pensionMembership === 'enrolled' ? payrollInsuranceRound(D(condition.pensionStandardMonthly ?? '0').times(FISCAL_DATA.pensionPercent).div(200)) : D(0);
  const employment = condition.employmentMembership === 'enrolled' ? payrollInsuranceRound(wage.times(employmentTable[condition.employmentCategory])) : D(0);
  return { health, nursing: combinedHealth.minus(health), childSupport, pension, employment, total: combinedHealth.plus(childSupport).plus(pension).plus(employment), insurancePeriod, wageCutoff, attainedAge: age, healthPercent, nursingPercent: nursing ? nursingTable.percent : '0', childSupportPercent: insurancePeriod >= FISCAL_DATA.childSupportFrom ? FISCAL_DATA.childSupportPercent : '0', pensionPercent: FISCAL_DATA.pensionPercent, employmentRate: employmentTable[condition.employmentCategory], rounding: FISCAL_DATA.insuranceRounding };
}
