import { Decimal, defineAction, isLocalDate, label, repo, StateError, submitDocument, withLock } from '@daifuku/kernel';
import { z } from 'zod';
import { RestaurantDayPlan } from '../entities/day-plan.ts';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantStore } from '../entities/store.ts';
import { assertPeriod, dates, today } from '../services/operation-dates.ts';
import { dayLock } from '../services/closing-validation.ts';
const date = z.string().refine(isLocalDate, 'YYYY-MM-DD');
const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const planDaysAction = defineAction({
  name: 'restaurant_chain.plan_days',
  description: label('店舗の営業予定・目標を一括登録', 'Plan store days and targets'),
  input: z.object({
    storeId: z.uuid().meta({ title: '店舗' }),
    from: date.meta({ title: '開始日' }),
    to: date.meta({ title: '終了日' }),
    openWeekdays: z.array(z.enum(weekdays)).meta({ title: '営業曜日' }),
    dailyGrossSalesTarget: z.string().regex(/^\d+$/).meta({ title: '営業日の税込売上目標' }),
  }),
  output: z.object({ created: z.number().int(), kept: z.number().int() }),
  permission: { entity: RestaurantDayPlan.name, op: 'submit' },
  handler: async (ctx, input) => {
    assertPeriod(input.from, input.to);
    if (input.from < today(ctx))
      throw new StateError('過去日を新たに計画できません', 'Choose today or a future start date.');
    await repo(ctx, RestaurantStore).get(input.storeId);
    const result = { created: 0, kept: 0 };
    for (const day of dates(input.from, input.to))
      await withLock(ctx, dayLock(input.storeId, day), async () => {
        const open = input.openWeekdays.includes(weekdays[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? 'sun');
        const target = Decimal.from(open ? input.dailyGrossSalesTarget : '0');
        const existing = await repo(ctx, RestaurantDayPlan).list({
          where: { storeId: input.storeId, date: day, docstatus: { $in: [0, 1] } },
          limit: 500,
        });
        if (existing.total) {
          if (
            existing.total !== 1 ||
            existing.items[0]?.docstatus !== 1 ||
            existing.items[0].expectedOpen !== open ||
            !existing.items[0].grossSalesTarget.eq(target)
          )
            throw new StateError(
              '既存予定と一括登録内容が異なります',
              'Review and explicitly amend the existing plan; bulk planning never overwrites it.',
            );
          result.kept++;
          return;
        }
        const row = await repo(ctx, RestaurantDayPlan).create({
          storeId: input.storeId,
          date: day,
          expectedOpen: open,
          grossSalesTarget: target,
        });
        await submitDocument(ctx, RestaurantDayPlan, row.id);
        result.created++;
      });
    return result;
  },
});
export const recordDayStatusAction = defineAction({
  name: 'restaurant_chain.record_day_status',
  description: label('売上ゼロ・臨時休業を記録', 'Record zero-sales or closed day'),
  input: z.object({
    storeId: z.uuid().meta({ title: '店舗' }),
    date: date.meta({ title: '営業日' }),
    dayStatus: z.enum(['no_sales', 'closed']).meta({ title: '営業実績区分' }),
    reason: z.string().trim().min(1).max(1000).meta({ title: '理由' }),
  }),
  output: z.unknown(),
  permission: { entity: RestaurantClosing.name, op: 'create' },
  storeAccess: true,
  handler: (ctx, input) =>
    repo(ctx, RestaurantClosing).create({
      storeId: input.storeId,
      date: input.date,
      dayStatus: input.dayStatus,
      note: input.reason,
      cashSalesCounted: '0',
    }),
});
