import { Decimal, StateError } from '@daifuku/kernel';
import type { WorkSystemInput } from '../work-system-contract.ts';
import type { PayInput } from './pay-types.ts';
import { addDays, dateMs, periodBounds, weekStart } from './time.ts';
import { legalPeriodMs } from './work-system.ts';
export interface TimeClassification {
  overtimeMs: number;
  regularSupplementMs: number;
  workSystem: string;
}
export function workSystemOn(systems: readonly WorkSystemInput[], date: string): WorkSystemInput | undefined {
  const found = systems.filter((system) => system.startsOn <= date && system.endsOn >= date);
  if (found.length > 1)
    throw new StateError('勤務制度の確定期間が重複しています', '社員ごとに一意の確定制度を整備してください。');
  return found[0];
}
export function leaveMinutes(input: PayInput, date: string, fallback: number): number {
  const system = workSystemOn(input.workSystems ?? [], date);
  return system?.mode === 'flex'
    ? system.standardDayMinutes
    : system?.mode === 'monthly_variable'
      ? (system.days.find((day) => day.date === date)?.scheduledMinutes ?? fallback)
      : fallback;
}
function add(result: Map<string, TimeClassification>, date: string, extra: number, supplement = 0): void {
  const prior = result.get(date) ?? { overtimeMs: 0, regularSupplementMs: 0, workSystem: 'flex' };
  result.set(date, {
    ...prior,
    overtimeMs: prior.overtimeMs + extra,
    regularSupplementMs: prior.regularSupplementMs + supplement,
  });
}
function dailyWeekly(input: PayInput, result: Map<string, TimeClassification>): void {
  const weeks = new Map<string, number>();
  const modes = new Map<string, Set<string>>();
  const systems = input.workSystems ?? [];
  for (const day of [...input.days].sort((a, b) => a.date.localeCompare(b.date))) {
    const system = workSystemOn(systems, day.date);
    const mode = system?.mode ?? 'ordinary';
    const week = weekStart(day.date, day.policy.weekStartsOn);
    const kinds = modes.get(week) ?? new Set<string>();
    if (day.workedMs > 0) kinds.add(mode === 'flex' ? 'flex' : 'fixed');
    modes.set(week, kinds);
    if (kinds.size > 1)
      throw new StateError(
        '週途中の通常・変形とフレックスの切替には対応していません',
        'この境界週は別途確認した給与計算が必要です。',
      );
    const scheduled =
      system?.mode === 'monthly_variable'
        ? (system.days.find((row) => row.date === day.date)?.scheduledMinutes ?? 0)
        : 0;
    if (
      system?.days.find((row) => row.date === day.date)?.statutoryHoliday !== undefined &&
      system.days.find((row) => row.date === day.date)?.statutoryHoliday !== (day.dayKind === 'statutory_holiday') &&
      day.workedMs > 0
    )
      throw new StateError(
        '事前の法定休日と承認勤怠の休日区分が一致しません',
        '勤務制度と実際の休日勤務を確認して勤怠を訂正してください。',
      );
    const holiday = day.dayKind === 'statutory_holiday';
    const candidate =
      holiday || mode === 'flex'
        ? 0
        : Math.min(day.workedMs, Math.max(day.policy.dailyLimitMinutes, scheduled) * 60000);
    const daily = holiday || mode === 'flex' ? 0 : day.workedMs - candidate;
    const plannedWeek = systems
      .filter((row) => row.mode === 'monthly_variable')
      .flatMap((row) => row.days)
      .filter((row) => row.date >= week && row.date <= addDays(week, 6))
      .reduce((sum, row) => sum + row.scheduledMinutes, 0);
    const limit = Math.max(day.policy.weeklyLimitMinutes, mode === 'monthly_variable' ? plannedWeek : 0) * 60000;
    const weekly = Math.max(0, candidate - Math.max(0, limit - (weeks.get(week) ?? 0)));
    weeks.set(week, (weeks.get(week) ?? 0) + candidate);
    result.set(day.date, { overtimeMs: daily + weekly, regularSupplementMs: 0, workSystem: mode });
  }
}
function periodCosts(input: PayInput, system: WorkSystemInput, result: Map<string, TimeClassification>): void {
  if (system.mode === 'ordinary') return;
  const days = input.days
    .filter((day) => day.date >= system.startsOn && day.date <= system.endsOn && day.dayKind !== 'statutory_holiday')
    .sort((a, b) => a.date.localeCompare(b.date));
  const length = (dateMs(system.endsOn) - dateMs(system.startsOn)) / 86400000 + 1;
  const multiple = system.startsOn.slice(0, 7) !== system.endsOn.slice(0, 7);
  if (system.mode === 'flex') {
    const months = new Map<string, number>();
    for (const day of days) {
      const month = day.date.slice(0, 7);
      const bounds = periodBounds(month);
      const count = (dateMs(bounds.end) - dateMs(bounds.start)) / 86400000 + 1;
      const limit = legalPeriodMs(multiple ? 3000 : system.weeklyMinutes, count);
      const before = months.get(month) ?? 0;
      const after = before + day.workedMs;
      add(result, day.date, Math.max(0, after - limit) - Math.max(0, before - limit));
      months.set(month, after);
    }
  }
  if (system.endsOn > periodBounds(input.period).end) return;
  const worked = days.reduce((sum, day) => sum + day.workedMs, 0);
  const already = days.reduce((sum, day) => sum + (result.get(day.date)?.overtimeMs ?? 0), 0);
  const extra = Math.max(0, worked - legalPeriodMs(system.weeklyMinutes, length) - already);
  add(result, system.endsOn, extra);
  // Paid leave is credited against agreed flex hours, but never becomes statutory actual-work overtime.
  const leave = [...input.leaves, ...(input.boundaryLeaves ?? [])]
    .filter((row) => row.date >= system.startsOn && row.date <= system.endsOn)
    .reduce(
      (sum, row) =>
        sum +
        leaveMinutes(input, row.date, system.standardDayMinutes) *
          30000 *
          Number(Decimal.from(row.days).times(2).toString()),
      0,
    );
  const supplement = Math.max(0, worked + leave - system.agreedTotalMinutes * 60000 - already - extra);
  add(result, system.endsOn, 0, supplement);
}
export function classifyWorkTime(input: PayInput): Map<string, TimeClassification> {
  const result = new Map<string, TimeClassification>();
  dailyWeekly(input, result);
  for (const system of input.workSystems ?? []) periodCosts(input, system, result);
  return result;
}
