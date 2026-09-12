import type { WorkSystemInput } from '../api/fiscal.ts';
export type WorkSystemDay = WorkSystemInput['days'][number];
export function monthDays(from: string, to: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || from > to) return [];
  const start = new Date(from + '-01T00:00:00Z'), end = new Date(to + '-01T00:00:00Z'); end.setUTCMonth(end.getUTCMonth() + 1);
  const days: string[] = [];
  while (start < end && days.length < 93) { days.push(start.toISOString().slice(0, 10)); start.setUTCDate(start.getUTCDate() + 1); }
  return days.length <= 92 ? days : [];
}
export function weekdayTemplate(dates: string[]): WorkSystemDay[] {
  return dates.map((date) => { const weekday = new Date(date + 'T00:00:00Z').getUTCDay(); return { date, startMinute: 540, endMinute: 1080, scheduledMinutes: weekday > 0 && weekday < 6 ? 480 : 0, statutoryHoliday: weekday === 0 }; });
}
export const timeInput = (minute: number) => !Number.isFinite(minute) ? '' : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const timeMinute = (value: string) => { const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN; };
