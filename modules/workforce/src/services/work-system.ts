import { StateError, ValidationError } from '@daifuku/kernel';
import type { WorkSystemInput } from '../work-system-contract.ts';
import { addDays, dateMs, periodBounds, weekStart } from './time.ts';
export function legalPeriodMs(weeklyMinutes: number, days: number): number {
  return Number((BigInt(weeklyMinutes) * 60000n * BigInt(days)) / 7n);
}
export function validateWorkSystem(input: WorkSystemInput): void {
  const starts = periodBounds(input.startsOn.slice(0, 7)),
    ends = periodBounds(input.endsOn.slice(0, 7));
  const months =
    (Number(input.endsOn.slice(0, 4)) - Number(input.startsOn.slice(0, 4))) * 12 +
    Number(input.endsOn.slice(5, 7)) -
    Number(input.startsOn.slice(5, 7)) +
    1;
  if (
    input.startsOn !== starts.start ||
    input.endsOn !== ends.end ||
    months < 1 ||
    months > (input.mode === 'flex' ? 3 : 1)
  )
    throw new ValidationError('勤務制度の期間が未対応です', [
      { path: 'startsOn', message: '通常・1か月変形は暦月1か月、フレックスは連続した暦月1～3か月を指定してください。' },
    ]);
  const days = (dateMs(input.endsOn) - dateMs(input.startsOn)) / 86400000 + 1,
    sorted = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  if (
    sorted.length !== days ||
    sorted.some(
      (day, index) =>
        day.date !== addDays(input.startsOn, index) ||
        day.endMinute < day.startMinute ||
        day.scheduledMinutes > day.endMinute - day.startMinute ||
        (day.statutoryHoliday && day.scheduledMinutes > 0),
    )
  )
    throw new ValidationError('日別所定の予定が不正です', [
      { path: 'days', message: '全暦日を重複なく指定し、予定は開始・終了内、法定休日の所定は0分にしてください。' },
    ]);
  if (input.mode === 'ordinary' && sorted.some((day) => day.scheduledMinutes > 480))
    throw new ValidationError('通常勤務の所定時間が日8時間を超えます', [
      { path: 'days', message: '通常勤務は1日480分以内です。' },
    ]);
  for (const week of new Set(sorted.map((day) => weekStart(day.date, 1)))) {
    const weekdays = sorted.filter((day) => weekStart(day.date, 1) === week);
    if (weekdays.length === 7 && !weekdays.some((day) => day.statutoryHoliday))
      throw new ValidationError('法定休日が未指定です', [
        {
          path: 'days',
          message: '各週に少なくとも1日の法定休日を事前に指定してください。4週4休の例外運用は対象外です。',
        },
      ]);
    if (input.mode === 'ordinary' && weekdays.reduce((sum, day) => sum + day.scheduledMinutes, 0) > input.weeklyMinutes)
      throw new ValidationError('通常勤務の週所定が40時間を超えます', [
        { path: 'days', message: '通常勤務は各週2400分以内です。' },
      ]);
  }
  const planned = sorted.reduce((sum, day) => sum + day.scheduledMinutes, 0);
  if (
    input.agreedTotalMinutes * 60000 > legalPeriodMs(input.weeklyMinutes, days) ||
    planned !== input.agreedTotalMinutes
  )
    throw new ValidationError('清算期間の総所定時間が不正です', [
      { path: 'agreedTotalMinutes', message: '日別所定の合計を指定し、週40時間×暦日数÷7以内にしてください。' },
    ]);
  if (input.mode === 'flex' && (!input.employeeChoiceConfirmed || (months > 1 && !input.filingConfirmed)))
    throw new StateError(
      'フレックスの必要条件が未確認です',
      '始業・終業の本人選択を確認し、1か月を超える清算期間では労使協定の届出を確認してください。',
    );
}
