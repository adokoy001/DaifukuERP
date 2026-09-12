import { Decimal, StateError, ValidationError } from '@daifuku/kernel';
import type { PayInput, PayTerms } from './pay-types.ts';
export type { PayPolicy, PayTerms, PayDay, PayLeave, PayInput } from './pay-types.ts';
import { classifyWorkTime, leaveMinutes } from './work-system-pay.ts';
import { addDays, dateMs, periodBounds } from './time.ts';
const D = Decimal.from;
function termsOn(terms: readonly PayTerms[], date: string): PayTerms {
  const found = terms.filter((term) => term.validFrom <= date && term.validTo >= date);
  if (found.length !== 1) throw new StateError('Missing or overlapping pay terms', `Exactly one confirmed pay condition must cover ${date}.`);
  return found[0] as PayTerms;
}
function hourlyRate(term: PayTerms): Decimal { return term.payType === 'hourly' ? D(term.hourlyRate) : D(term.monthlySalary).times(60).div(term.monthlyBaseMinutes); }
function monthlyBase(input: PayInput): Decimal {
  const { start, end } = periodBounds(input.period);
  const monthDays = (dateMs(end) - dateMs(start)) / 86400000 + 1;
  let total = D(0);
  for (let date = input.employmentStart; date <= input.employmentEnd; date = addDays(date, 1)) {
    const term = termsOn(input.terms, date);
    if (term.payType === 'monthly') total = total.plus(term.monthlySalary);
  }
  return total.div(monthDays);
}
function validateDays(input: PayInput): void {
  const seen = new Set<string>(), weeks = new Set<number>();
  for (const day of input.days) {
    if (seen.has(day.date) || !Number.isSafeInteger(day.workedMs) || !Number.isSafeInteger(day.nightMs) || day.workedMs < 0 || day.nightMs < 0 || day.nightMs > day.workedMs) throw new ValidationError('Invalid or duplicate payroll attendance', [{ path: 'days', message: 'Use unique days with exact nonnegative milliseconds.' }]);
    seen.add(day.date); weeks.add(day.policy.weekStartsOn);
  }
  if (weeks.size > 1) throw new StateError('Workweek basis changes within payroll input', 'Use one consistent workweek origin across the payroll month and its boundary week.');
  for (const leave of input.leaves) if (D(leave.days).lte(0) || D(leave.days).gt(1)) throw new ValidationError('Invalid paid leave quantity', [{ path: 'leave', message: 'Use approved positive full or half days.' }]);
}
function attendanceCosts(input: PayInput) {
  const classified = classifyWorkTime(input);
  let overtimeMs = 0, base = D(0), premium = D(0), workedMs = 0;
  const details: Record<string, unknown>[] = [];
  for (const day of [...input.days].sort((a, b) => a.date.localeCompare(b.date))) {
    const policy = day.policy, classification = classified.get(day.date);
    const holidayMs = day.dayKind === 'statutory_holiday' ? day.workedMs : 0;
    if (day.date < input.employmentStart || day.date > input.employmentEnd) continue;
    const term = termsOn(input.terms, day.date), rate = hourlyRate(term), extraMs = classification?.overtimeMs ?? 0;
    const highMs = Math.max(0, overtimeMs + extraMs - policy.monthlyOvertimeThresholdMinutes * 60000) - Math.max(0, overtimeMs - policy.monthlyOvertimeThresholdMinutes * 60000);
    overtimeMs += extraMs; workedMs += day.workedMs;
    const baseMs = term.payType === 'hourly' ? day.workedMs : extraMs + holidayMs + (classification?.regularSupplementMs ?? 0);
    const baseAmount = rate.times(baseMs).div(3600000);
    const premiumAmount = rate.times(D(extraMs - highMs).times(policy.overtimePremiumRate).plus(D(highMs).times(policy.highOvertimePremiumRate)).plus(D(holidayMs).times(policy.holidayPremiumRate)).plus(D(day.nightMs).times(policy.nightPremiumRate))).div(3600000);
    base = base.plus(baseAmount); premium = premium.plus(premiumAmount);
    details.push({ date: day.date, termsId: term.id, policyId: policy.id, workedMs: day.workedMs, regularMs: Math.max(0, day.workedMs - extraMs - holidayMs), regularSupplementMs: classification?.regularSupplementMs ?? 0, workSystem: classification?.workSystem ?? 'ordinary', overtimeMs: extraMs, highOvertimeMs: highMs, holidayMs, nightMs: day.nightMs, hourlyBasis: rate.toString(), baseAmount: baseAmount.toString(), premiumAmount: premiumAmount.toString() });
  }
  return { base, premium, workedMs, overtimeMs, details };
}
/** Aggregates exact time first and rounds only monetary totals upward to whole JPY. */
export function calculatePay(input: PayInput) {
  validateDays(input);
  const work = attendanceCosts(input);
  let leavePay = D(0), paidLeaveDays = D(0);
  for (const leave of input.leaves) {
    if (leave.date < input.employmentStart || leave.date > input.employmentEnd) throw new StateError('Leave is outside the payroll employment interval', 'Check the employment and paid leave dates.');
    const term = termsOn(input.terms, leave.date);
    paidLeaveDays = paidLeaveDays.plus(leave.days);
    if (term.payType === 'hourly') leavePay = leavePay.plus(hourlyRate(term).times(leaveMinutes(input, leave.date, term.paidLeaveDayMinutes)).times(leave.days).div(60));
  }
  const monthly = monthlyBase(input), basePay = monthly.plus(work.base).plus(leavePay).roundUp(0), premiumPay = work.premium.roundUp(0);
  return { basePay, premiumPay, grossPay: basePay.plus(premiumPay), workedMs: work.workedMs, paidLeaveDays, details: work.details, monthlyBase: monthly.toString(), paidLeavePay: leavePay.toString(), overtimeMs: work.overtimeMs, rounding: 'Exact milliseconds; base and premium totals rounded up to whole JPY.', monthlyProration: 'Calendar days of the payroll month, clipped by effective terms and employment dates; absence adjustments require an explicit deduction.' };
}
