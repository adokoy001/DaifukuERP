import { v7 as uuidv7, validate as uuidValidate } from 'uuid';

/** Time-ordered UUID (v7). Sorts by creation time, which keeps B-tree inserts sequential. */
export function newId(): string {
  return uuidv7();
}

export function isUuid(s: string): boolean {
  return uuidValidate(s);
}

/** Business dates are `YYYY-MM-DD` strings with no timezone (docs/conventions/money-and-dates.md). */
export type LocalDate = string;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(s: string): boolean {
  if (!LOCAL_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayLocal(now: Date, timeZone = 'Asia/Tokyo'): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
