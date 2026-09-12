import { StateError, type Context } from '@daifuku/kernel';
import { allRows, D } from './common.ts';
import { WorkforceAttendance, WorkforceLeaveRequest } from './entities/index.ts';
import { addDays, jstDate } from './services/time.ts';

export async function assertNoFullLeave(ctx: Context, employeeId: string, date: string): Promise<void> {
  const leaves = await allRows(ctx, WorkforceLeaveRequest, { employeeId, leaveDate: date, status: 'approved' });
  if (leaves.reduce((sum, row) => sum.plus(row.days), D(0)).gte(1)) throw new StateError('Full-day paid leave overlaps attendance', 'Cancel or correct the full day or both half-day leave approvals before attendance approval.');
}
export async function assertNoWorkOverlap(ctx: Context, employeeId: string, id: string, start: Date, end: Date): Promise<void> {
  const rows = await allRows(ctx, WorkforceAttendance, { employeeId, id: { $ne: id }, $and: [{ workDate: { $gte: addDays(jstDate(start), -1) } }, { workDate: { $lte: jstDate(end) } }] });
  if (rows.some((other) => other.clockIn < end && (!other.clockOut || other.clockOut > start))) throw new StateError('Attendance overlaps another shift', 'Correct the adjacent attendance first; the same work time cannot be counted twice.');
}
