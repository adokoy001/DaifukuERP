import type { WorkSystemInput } from '../src/work-system-contract.ts';
import { addDays, periodBounds } from '../src/services/time.ts';
export function workSystem(
  employeeId: string,
  startsOn = '2026-10-01',
  endsOn = '2026-10-31',
  mode: WorkSystemInput['mode'] = 'monthly_variable',
): WorkSystemInput {
  const days: WorkSystemInput['days'] = [];
  for (let date = startsOn; date <= endsOn; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const scheduledMinutes = weekday > 0 && weekday < 6 ? 480 : 0;
    days.push({
      date,
      scheduledMinutes,
      startMinute: scheduledMinutes ? 540 : 0,
      endMinute: scheduledMinutes ? 1080 : 0,
      statutoryHoliday: weekday === 0,
    });
  }
  return {
    employeeId,
    startsOn,
    endsOn,
    mode,
    weeklyMinutes: 2400,
    standardDayMinutes: 480,
    agreedTotalMinutes: days.reduce((sum, day) => sum + day.scheduledMinutes, 0),
    days,
    agreementReference: '労使協定と就業規則を確認',
    agreementConfirmed: true,
    employeeChoiceConfirmed: mode === 'flex',
    filingConfirmed: mode === 'flex',
    basis: '事前所定と清算期間の合意',
  };
}
export function workingDates(period: string): string[] {
  const bounds = periodBounds(period);
  const dates: string[] = [];
  for (let date = bounds.start; date <= bounds.end; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday > 0 && weekday < 6) dates.push(date);
  }
  return dates;
}
