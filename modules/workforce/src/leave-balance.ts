import { Decimal, repo, type Context } from '@daifuku/kernel';
import { WorkforceLeaveGrant, WorkforceLeaveUsage } from './entities/index.ts';
import { allRows, D } from './common.ts';
export async function availableGrants(ctx: Context, employeeId: string, date: string) {
  const grants = await allRows(
    ctx,
    WorkforceLeaveGrant,
    { employeeId, validFrom: { $lte: date }, expiresOn: { $gte: date } },
    [{ field: 'expiresOn' }, { field: 'id' }],
  );
  const usage = await allRows(ctx, WorkforceLeaveUsage, { employeeId });
  return grants.map((grant) => ({
    grant,
    available: grant.days.minus(Decimal.sum(usage.filter((row) => row.grantId === grant.id).map((row) => row.days))),
  }));
}
export async function leaveBalance(ctx: Context, employeeId: string, date: string): Promise<Decimal> {
  return Decimal.sum((await availableGrants(ctx, employeeId, date)).map((row) => row.available));
}
export async function usedForRequest(ctx: Context, requestId: string) {
  return (await repo(ctx, WorkforceLeaveUsage).list({ where: { requestId, kind: 'consume' }, limit: 500 })).items;
}
export function leaveDays(portion: string): Decimal {
  return D(portion === 'full' ? '1' : '0.5');
}
