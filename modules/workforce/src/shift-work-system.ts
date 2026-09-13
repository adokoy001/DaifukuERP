import type { Context, Infer } from '@daifuku/kernel';
import { allRows } from './common.ts';
import { WorkforceShiftAssignment, WorkforceWorkSystemPeriod } from './entities/index.ts';
import { workSystemData } from './work-system-contract.ts';
import type { ShiftPeriodBudget, ShiftWorkRule } from './scheduling/types.ts';
import { addDays, dateMs, periodBounds, weekStart } from './services/time.ts';
import { legalPeriodMs } from './services/work-system.ts';
export async function shiftWorkSystems(ctx: Context, employeeIds: string[], start: string) {
  const end = addDays(start, 6),
    rows = await allRows(ctx, WorkforceWorkSystemPeriod, {
      employeeId: { $in: employeeIds },
      status: 'confirmed',
      startsOn: { $lte: end },
      endsOn: { $gte: start },
    });
  const workRules: ShiftWorkRule[] = [],
    periodBudgets: ShiftPeriodBudget[] = [],
    assignments: Infer<typeof WorkforceShiftAssignment>[] = [];
  for (const row of rows) {
    const system = workSystemData.strip().parse(row),
      published = await allRows(ctx, WorkforceShiftAssignment, {
        employeeId: row.employeeId,
        active: true,
        date: { $gte: row.startsOn, $lte: row.endsOn },
      });
    assignments.push(...published);
    const outside = published.filter((item) => item.date < start || item.date > end);
    const used = (from: string, to: string) =>
      outside
        .filter((item) => item.date >= from && item.date <= to)
        .reduce((sum, item) => sum + item.endMinute - item.startMinute - item.breakMinutes, 0);
    periodBudgets.push({
      employeeId: row.employeeId,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      remainingMinutes: row.agreedTotalMinutes - used(row.startsOn, row.endsOn),
    });
    for (const day of system.days.filter((item) => item.date >= start && item.date <= end)) {
      const week = weekStart(day.date, 1),
        planned = rows
          .filter((other) => other.employeeId === row.employeeId && other.mode === 'monthly_variable')
          .flatMap((other) => workSystemData.strip().parse(other).days)
          .filter((item) => item.date >= week && item.date <= addDays(week, 6))
          .reduce((sum, item) => sum + item.scheduledMinutes, 0);
      workRules.push({
        employeeId: row.employeeId,
        date: day.date,
        mode: row.mode,
        dailyLimitMinutes: row.mode === 'flex' ? 960 : day.scheduledMinutes,
        weeklyLimitMinutes:
          row.mode === 'flex' ? 5760 : row.mode === 'monthly_variable' ? Math.max(2400, planned) : 2400,
        startMinute: day.startMinute,
        endMinute: day.endMinute,
        statutoryHoliday: day.statutoryHoliday,
      });
    }
    if (row.mode === 'flex' && row.startsOn.slice(0, 7) !== row.endsOn.slice(0, 7)) {
      const months = new Set(
        system.days.filter((day) => day.date >= start && day.date <= end).map((day) => day.date.slice(0, 7)),
      );
      for (const month of months) {
        const bounds = periodBounds(month),
          count = (dateMs(bounds.end) - dateMs(bounds.start)) / 86400000 + 1;
        periodBudgets.push({
          employeeId: row.employeeId,
          startsOn: bounds.start,
          endsOn: bounds.end,
          remainingMinutes: Math.floor(legalPeriodMs(3000, count) / 60000) - used(bounds.start, bounds.end),
        });
      }
    }
  }
  return {
    workRules,
    periodBudgets,
    rows,
    assignments: [...new Map(assignments.map((row) => [row.id, row])).values()],
  };
}
