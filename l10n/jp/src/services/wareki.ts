// 和暦 (spec AC-5). Internal dates are always Gregorian `YYYY-MM-DD`; conversion is display-only
// (docs/conventions/money-and-dates.md, docs/domain/japan-tax.md#商習慣: 令和 = 2019-05-01〜).
// Era start dates (元号法 / 各改元政令, 確認 2026-09-10):
//   明治 1868-01-25 (慶応4年1月1日に遡って改元; 明治元年9月8日 行政官布告)
//   大正 1912-07-30, 昭和 1926-12-25, 平成 1989-01-08 (昭和64年政令第1号), 令和 2019-05-01 (平成31年政令第143号)
//   https://www.kantei.go.jp/jp/singi/gengou/ (首相官邸 元号について, 確認 2026-09-10)
// Extensible: pass your own table (e.g. a future era) as the second argument; rows must be ordered by `start`.
import { ValidationError, isLocalDate, type LocalDate } from '@daifuku/kernel';

export interface Era {
  name: string;
  /** Gregorian first day of year 1 (元年). */
  start: LocalDate;
}

export const ERAS: readonly Era[] = [
  { name: '明治', start: '1868-01-25' },
  { name: '大正', start: '1912-07-30' },
  { name: '昭和', start: '1926-12-25' },
  { name: '平成', start: '1989-01-08' },
  { name: '令和', start: '2019-05-01' },
];

export interface WarekiParts {
  era: string;
  /** 1 = 元年. */
  year: number;
  month: number;
  day: number;
}

function assertLocalDate(date: string): void {
  if (!isLocalDate(date))
    throw new ValidationError(`invalid date "${date}"`, [{ path: 'date', message: 'must be YYYY-MM-DD' }]);
}

/** Splits a Gregorian date into era / year-in-era / month / day. Dates before the first era are rejected. */
export function toWarekiParts(date: LocalDate, eras: readonly Era[] = ERAS): WarekiParts {
  assertLocalDate(date);
  let era: Era | undefined;
  for (const e of eras) {
    if (date >= e.start) era = e;
  }
  if (!era) {
    throw new ValidationError(
      `no era is defined for ${date}`,
      [{ path: 'date', message: `before ${eras[0]?.start ?? '(empty era table)'}` }],
      'Extend the era table (l10n/jp/src/services/wareki.ts ERAS) or format the date as Gregorian.',
    );
  }
  const [y, m, d] = date.split('-').map(Number);
  return { era: era.name, year: (y ?? 0) - Number(era.start.slice(0, 4)) + 1, month: m ?? 0, day: d ?? 0 };
}

/** '2026-09-11' → '令和8年9月11日'; year 1 is written 元年 (official usage). */
export function toWareki(date: LocalDate, eras: readonly Era[] = ERAS): string {
  const p = toWarekiParts(date, eras);
  const year = p.year === 1 ? '元' : String(p.year);
  return `${p.era}${year}年${p.month}月${p.day}日`;
}

/** '2026-09-11' → '2026年9月11日' (西暦; no zero padding, as commonly printed on Japanese documents). */
export function formatDateJa(date: LocalDate): string {
  assertLocalDate(date);
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}
