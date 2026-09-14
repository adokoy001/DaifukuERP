// Time intervals use integer milliseconds. Convert to Decimal only when pricing; never truncate punches to minutes.
import { Decimal, StateError, ValidationError } from '@daifuku/kernel';
const DAY_MS = 86400000;
const JST_MS = 9 * 3600000;
export interface BreakInterval {
  start: string;
  end: string;
}
export function jstDate(value: Date): string {
  return new Date(value.getTime() + JST_MS).toISOString().slice(0, 10);
}
export function dateMs(date: string): number {
  return new Date(`${date}T00:00:00+09:00`).getTime();
}
export function addDays(date: string, days: number): string {
  return jstDate(new Date(dateMs(date) + days * DAY_MS));
}
export function periodBounds(period: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    throw new ValidationError('Invalid payroll month', [{ path: 'period', message: 'Use YYYY-MM.' }]);
  const start = `${period}-01`;
  const value = new Date(`${start}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return { start, end: addDays(value.toISOString().slice(0, 10), -1) };
}
export function weekStart(date: string, day: number): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday - day + 7) % 7));
}
function intersection(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}
export function measureWork(
  clockIn: Date,
  clockOut: Date,
  breaks: readonly BreakInterval[],
  nightStart: number,
  nightEnd: number,
) {
  const start = clockIn.getTime();
  const end = clockOut.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > DAY_MS)
    throw new ValidationError('Invalid working interval', [
      { path: 'clockOut', message: 'End must follow start within 24 hours.' },
    ]);
  const intervals = breaks
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  let breakMs = 0;
  let previousEnd = start;
  for (const interval of intervals) {
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.start < start ||
      interval.end > end ||
      interval.end <= interval.start ||
      interval.start < previousEnd
    )
      throw new ValidationError('Invalid or overlapping break', [
        { path: 'breaks', message: 'Breaks must be nonoverlapping intervals inside the shift.' },
      ]);
    breakMs += interval.end - interval.start;
    previousEnd = interval.end;
  }
  let nightMs = 0;
  for (let midnight = dateMs(addDays(jstDate(clockIn), -1)); midnight <= end; midnight += DAY_MS) {
    const nightA = midnight + nightStart * 60000;
    const nightB = midnight + (nightEnd <= nightStart ? DAY_MS : 0) + nightEnd * 60000;
    nightMs += intersection(start, end, nightA, nightB);
    for (const interval of intervals) nightMs -= intersection(interval.start, interval.end, nightA, nightB);
  }
  return { workedMs: end - start - breakMs, breakMs, nightMs };
}
export function minutesDisplay(ms: number): number {
  return Decimal.from(ms).div(60000).toNumberUnsafe();
}
export function assertBreaks(
  measured: { workedMs: number; breakMs: number },
  policy: { breakAfterMinutes: number; breakMinutes: number; longBreakAfterMinutes: number; longBreakMinutes: number },
): void {
  const required =
    measured.workedMs > policy.longBreakAfterMinutes * 60000
      ? policy.longBreakMinutes
      : measured.workedMs > policy.breakAfterMinutes * 60000
        ? policy.breakMinutes
        : 0;
  if (measured.breakMs < required * 60000)
    throw new ValidationError('Required break was not recorded', [
      {
        path: 'breaks',
        message: `Record and review at least ${required} minutes of actual breaks; punches themselves are preserved.`,
      },
    ]);
}
export function assertPayrollCalendarDay(clockIn: Date, clockOut: Date): void {
  if (jstDate(clockIn) !== jstDate(new Date(clockOut.getTime() - 1)))
    throw new StateError(
      '暦日ごとの休日区分に未対応の勤務があります',
      '日付をまたぐ勤務の打刻・訂正は保存できます。給与の自動確定は行わず、暦日別の休日区分に対応した給与計算で確認してください。',
    );
}
