import { StateError, type Context } from '@daifuku/kernel';
import { allRows, D } from './common.ts';
import { WorkforceAttendance, WorkforceLeaveRequest } from './entities/index.ts';
import { addDays, dateMs, jstDate, type BreakInterval } from './services/time.ts';

/** Exact elapsed work inside a JST calendar date; an end at midnight belongs only to the previous date. */
function worksOnDate(start: Date, end: Date, breaks: readonly BreakInterval[], date: string): boolean {
  const from = Math.max(start.getTime(), dateMs(date)),
    to = Math.min(end.getTime(), dateMs(addDays(date, 1)));
  if (to <= from) return false;
  const breakMs = breaks.reduce(
    (sum, interval) =>
      sum +
      Math.max(0, Math.min(to, new Date(interval.end).getTime()) - Math.max(from, new Date(interval.start).getTime())),
    0,
  );
  return to - from > breakMs;
}
export async function assertNoFullLeave(
  ctx: Context,
  employeeId: string,
  start: Date,
  end: Date,
  breaks: readonly BreakInterval[],
): Promise<void> {
  const leaves = await allRows(ctx, WorkforceLeaveRequest, {
    employeeId,
    leaveDate: { $gte: jstDate(start), $lte: jstDate(new Date(end.getTime() - 1)) },
    status: 'approved',
  });
  const days = new Map<string, ReturnType<typeof D>>();
  for (const row of leaves) days.set(row.leaveDate, (days.get(row.leaveDate) ?? D(0)).plus(row.days));
  if ([...days].some(([date, total]) => total.gte(1) && worksOnDate(start, end, breaks, date)))
    throw new StateError(
      'Full-day paid leave overlaps attendance',
      'Cancel or correct the full day or both half-day leave approvals before attendance approval.',
    );
}
export async function assertNoAttendanceOnLeaveDate(ctx: Context, employeeId: string, date: string): Promise<void> {
  // Completed shifts span at most 24 hours; older unclosed shifts still need to be reviewed.
  const rows = await allRows(ctx, WorkforceAttendance, {
    employeeId,
    workDate: { $lte: date },
    $or: [{ workDate: { $gte: addDays(date, -1) } }, { clockOut: null }],
  });
  const overlaps = rows.some((row) => {
    const end = row.clockOut ?? ctx.now(),
      breaks = row.breaks as BreakInterval[];
    const actualBreaks = row.breakStartedAt
      ? [...breaks, { start: row.breakStartedAt.toISOString(), end: end.toISOString() }]
      : breaks;
    return worksOnDate(row.clockIn, end, actualBreaks, date);
  });
  if (overlaps)
    throw new StateError(
      'Full-day leave conflicts with recorded attendance',
      'Resolve the recorded attendance before approving a full day off.',
    );
}
export async function assertNoWorkOverlap(
  ctx: Context,
  employeeId: string,
  id: string,
  start: Date,
  end: Date,
): Promise<void> {
  const rows = await allRows(ctx, WorkforceAttendance, {
    employeeId,
    id: { $ne: id },
    $and: [{ workDate: { $gte: addDays(jstDate(start), -1) } }, { workDate: { $lte: jstDate(end) } }],
  });
  if (rows.some((other) => other.clockIn < end && (!other.clockOut || other.clockOut > start)))
    throw new StateError(
      'Attendance overlaps another shift',
      'Correct the adjacent attendance first; the same work time cannot be counted twice.',
    );
}
