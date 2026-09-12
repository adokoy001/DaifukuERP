import { registry, repo, StateError, ValidationError, withLock, type Context, type HookArgs } from '@daifuku/kernel';
import { assertJpySettlement } from '@daifuku/mod-accounting';
import { RestaurantDayPlan } from '../entities/day-plan.ts';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantStore } from '../entities/store.ts';
import { dayLock } from '../services/closing-validation.ts';
import { decimal } from '../services/load.ts';
import { today } from '../services/operation-dates.ts';
async function mutableDay(ctx: Context, row: Record<string, unknown>): Promise<void> {
  if (String(row.date) < today(ctx)) throw new StateError('過去日の営業予定・目標は変更できません', 'Plan today or a future day; historical targets are fixed.');
  if (await repo(ctx, RestaurantClosing).count({ storeId: String(row.storeId), date: String(row.date), docstatus: { $in: [1, 2] } })) throw new StateError('確定実績がある日の予定・目標は変更できません', 'Historical targets cannot be rewritten after posting.');
}
async function submit(ctx: Context, { row }: HookArgs): Promise<void> {
  await withLock(ctx, dayLock(String(row.storeId), String(row.date)), async () => {
    await mutableDay(ctx, row);
    if (await repo(ctx, RestaurantDayPlan).count({ storeId: String(row.storeId), date: String(row.date), docstatus: 1 })) throw new StateError('この日の営業予定は確定済みです', 'Cancel and amend the existing future plan.');
  });
  const store = await repo(ctx, RestaurantStore).lock(String(row.storeId), 'read');
  if (!store.isActive) throw new StateError('営業停止中の店舗です', 'Activate the store before planning.');
  const target = decimal(row.grossSalesTarget);
  await assertJpySettlement(ctx, target, 'grossSalesTarget');
  if (!row.expectedOpen && !target.isZero()) throw new ValidationError('休業予定の売上目標はゼロにしてください', [{ path: 'grossSalesTarget', message: 'closed days require zero target' }]);
}
export function registerDayPlanHooks(): void {
  registry.registerHook(RestaurantDayPlan.name, 'before_submit', submit);
  registry.registerHook(RestaurantDayPlan.name, 'before_cancel', async (ctx, { row }) => withLock(ctx, dayLock(String(row.storeId), String(row.date)), () => mutableDay(ctx, row)));
}
