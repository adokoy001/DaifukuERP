import { repo, StateError, ValidationError, withLock, type Context, type HookArgs, type Infer } from '@daifuku/kernel';
import { allRows } from './common.ts';
import type { WorkforceEmployee, WorkforceSite } from './entities/index.ts';
import { WorkforceShiftAssignment, WorkforceShiftAvailability } from './entities/index.ts';
import { jstDate } from './services/time.ts';
/** Called under the existing employee lock: preserve self/site visibility and published commitments. */
export async function assertShiftEmploymentChange(
  ctx: Context,
  previous: Infer<typeof WorkforceEmployee>,
  row: Infer<typeof WorkforceEmployee>,
): Promise<void> {
  if (previous.siteId !== row.siteId) {
    const scope = { employeeId: row.id, siteId: { $ne: row.siteId } };
    if (
      (await repo(ctx, WorkforceShiftAvailability).count(scope)) ||
      (await repo(ctx, WorkforceShiftAssignment).count(scope))
    )
      throw new StateError(
        '勤務希望・公開シフトの履歴を保全するため、この拠点変更はできません',
        '既存履歴の所属拠点を保持してください。履歴付きの異動は専用の移行機能が必要です。',
      );
  }
  if (
    previous.active &&
    !row.active &&
    (await repo(ctx, WorkforceShiftAssignment).count({
      employeeId: row.id,
      active: true,
      date: { $gte: jstDate(ctx.now()) },
    }))
  )
    throw new StateError('今後の公開シフトが残っています', '計画を改訂または取り消してから社員を無効にしてください。');
  if (previous.hiredOn !== row.hiredOn || previous.terminatedOn !== row.terminatedOn) {
    const assigned = await allRows(ctx, WorkforceShiftAssignment, { employeeId: row.id, active: true });
    if (assigned.some((day) => day.date < row.hiredOn || (row.terminatedOn && day.date > row.terminatedOn)))
      throw new ValidationError('雇用期間から公開勤務を除外できません', [
        { path: 'terminatedOn', message: '公開計画を改訂・取消してから雇用期間を変更してください。' },
      ]);
  }
}

/** Share the snapshot lock so a site cannot disappear between validation and publication. */
export async function guardShiftSite(ctx: Context, args: HookArgs): Promise<void> {
  await withLock(ctx, 'workforce:policies', async () => {
    const row = args.row as unknown as Infer<typeof WorkforceSite>;
    if (
      args.previous?.['active'] &&
      !row.active &&
      (await repo(ctx, WorkforceShiftAssignment).count({
        siteId: row.id,
        active: true,
        date: { $gte: jstDate(ctx.now()) },
      }))
    )
      throw new StateError(
        'この拠点には今後の公開シフトが残っています',
        '公開計画を改訂または取り消してから拠点を無効にしてください。',
      );
  });
}
