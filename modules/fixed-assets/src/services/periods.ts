// Default period of the depreciation preview (docs/specs/fixed-assets.md AC-11; D14). Pure.
import type { LocalDate } from '@daifuku/kernel';

export interface PeriodLike {
  id: string;
  code: string;
  startDate: LocalDate;
  endDate: LocalDate;
  isClosed: boolean;
}

/**
 * The last period that ended before today; else the period containing today; else the earliest (future) period.
 * Null when the company has no period at all.
 */
export function defaultPeriod<P extends PeriodLike>(periods: readonly P[], today: LocalDate): P | null {
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const ended = sorted.filter((p) => p.endDate < today);
  return ended[ended.length - 1] ?? sorted.find((p) => p.startDate <= today && today <= p.endDate) ?? sorted[0] ?? null;
}

/** The last period that ended before today (the inbox item looks at this one only), or null. */
export function lastEndedPeriod<P extends PeriodLike>(periods: readonly P[], today: LocalDate): P | null {
  const ended = [...periods].filter((p) => p.endDate < today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return ended[ended.length - 1] ?? null;
}
