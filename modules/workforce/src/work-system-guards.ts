import { StateError, type Context, type Infer } from '@daifuku/kernel';
import { WorkforceWorkSystemPeriod, type WorkforceEmployee } from './entities/index.ts';
import { allRows } from './common.ts';
export async function assertWorkSystemEmploymentChange(
  ctx: Context,
  row: Infer<typeof WorkforceEmployee>,
): Promise<void> {
  const periods = await allRows(ctx, WorkforceWorkSystemPeriod, { employeeId: row.id, status: 'confirmed' });
  if (periods.some((period) => row.hiredOn > period.startsOn || (row.terminatedOn && row.terminatedOn < period.endsOn)))
    throw new StateError(
      '確定した勤務制度の清算期間を在籍期間から外せません',
      '開始前の制度は理由付きで取り消してから変更してください。期間途中の入退社計算はこの版の対象外です。',
    );
}
