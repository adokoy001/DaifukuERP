import { repo, StateError, type Context } from '@daifuku/kernel';
import { WorkforcePeriodLock } from './entities/index.ts';
/** Same Repository scope as other workforce rows. This projection contains no wage amounts. */
export async function assertWorkforcePeriodOpen(ctx: Context, employeeId: string, date: string): Promise<void> {
  const closed = await repo(ctx, WorkforcePeriodLock).count({ employeeId, active: true, periodStart: { $lte: date }, periodEnd: { $gte: date } });
  if (closed) throw new StateError('Payroll period is finalized', 'A different payroll reviewer must cancel the payslip with a reason before correcting this period.');
}
