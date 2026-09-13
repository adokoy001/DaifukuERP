import { ValidationError } from '@daifuku/kernel';
const DAY_MS = 86400000;
const JST_MS = 9 * 3600000;
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
