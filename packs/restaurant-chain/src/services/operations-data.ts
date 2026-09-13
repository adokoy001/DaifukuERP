import { MAX_REPORT_ROWS, repo, ValidationError, type Context, type Infer } from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantDayPlan } from '../entities/day-plan.ts';
import { RestaurantStore } from '../entities/store.ts';
import { dayCount } from './operation-dates.ts';
import type { OperationsInput, OperationsRange } from './operations-contract.ts';
export type Closing = Infer<typeof RestaurantClosing>;
export type Store = Infer<typeof RestaurantStore>;
export type DayPlan = Infer<typeof RestaurantDayPlan>;
export interface OperationsData {
  stores: Store[];
  closings: Closing[];
  plans: DayPlan[];
}
export async function allPages<T>(fetch: (offset: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
  const result: T[] = [];
  for (;;) {
    const page = await fetch(result.length);
    if (page.total > MAX_REPORT_ROWS)
      throw new ValidationError('対象が多すぎます。店舗・期間を絞ってください', [
        { path: 'from', message: `maximum ${MAX_REPORT_ROWS} source records` },
      ]);
    result.push(...page.items);
    if (!page.items.length || result.length >= page.total) return result;
  }
}
export async function operationsData(
  ctx: Context,
  input: OperationsInput,
  range: OperationsRange,
): Promise<OperationsData> {
  if (input.storeId) await repo(ctx, RestaurantStore).get(input.storeId);
  const stores = await allPages((offset) =>
    repo(ctx, RestaurantStore).list({
      ...(input.storeId ? { where: { id: input.storeId } } : {}),
      orderBy: [{ field: 'code', dir: 'asc' }],
      limit: 500,
      offset,
    }),
  );
  if (stores.length * dayCount(range.from, range.to) > MAX_REPORT_ROWS)
    throw new ValidationError('営業日ボードが大きすぎます。店舗・期間を絞ってください', [
      { path: 'from', message: `maximum ${MAX_REPORT_ROWS} store-days` },
    ]);
  const store = input.storeId ? { storeId: input.storeId } : {};
  const closings = await allPages((offset) =>
    repo(ctx, RestaurantClosing).list({
      where: {
        ...store,
        $or: [
          { $and: [{ date: { $gte: range.previousFrom } }, { date: { $lte: range.to } }] },
          {
            docstatus: 2,
            $and: [{ cancelledDate: { $gte: range.previousFrom } }, { cancelledDate: { $lte: range.to } }],
          },
        ],
      },
      orderBy: [{ field: 'id', dir: 'asc' }],
      limit: 500,
      offset,
    }),
  );
  const plans = await allPages((offset) =>
    repo(ctx, RestaurantDayPlan).list({
      where: { ...store, docstatus: 1, $and: [{ date: { $gte: range.from } }, { date: { $lte: range.to } }] },
      orderBy: [{ field: 'id', dir: 'asc' }],
      limit: 500,
      offset,
    }),
  );
  return { stores, closings, plans };
}
