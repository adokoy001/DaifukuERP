import { Decimal, repo, ValidationError, type Context } from '@daifuku/kernel';
import { RestaurantClosingLine } from '../entities/closing-line.ts';
import { RecipeIngredient } from '../entities/recipe-ingredient.ts';
import { RestaurantWasteLine } from '../entities/waste-line.ts';

function bounded<T>(page: { items: T[]; total: number }): T[] {
  if (page.total > 500) throw new ValidationError('日次締めの明細数が上限を超えています', [{ path: 'lines', message: 'at most 500 lines per group' }]);
  return page.items;
}
export async function closingLines(ctx: Context, closingId: string) {
  return bounded(await repo(ctx, RestaurantClosingLine).list({ where: { closingId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 500 }));
}
export async function ingredients(ctx: Context, recipeId: string) {
  return bounded(await repo(ctx, RecipeIngredient).list({ where: { recipeId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 500 }));
}
export async function wasteLines(ctx: Context, closingId: string) {
  return bounded(await repo(ctx, RestaurantWasteLine).list({ where: { closingId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 500 }));
}
export function decimal(value: unknown, path = 'amount'): Decimal {
  if (typeof value === 'string' && Decimal.isDecimalString(value)) return Decimal.from(value);
  if (value instanceof Decimal) return value;
  throw new ValidationError('数量または金額を確認してください', [{ path, message: 'must be a decimal string' }]);
}
export function merged(row: Record<string, unknown>, previous: Record<string, unknown> | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}
