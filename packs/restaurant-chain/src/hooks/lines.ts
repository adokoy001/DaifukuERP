import { DOCSTATUS, isSavingLines, registry, repo, type Context, type HookArgs } from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantClosingLine } from '../entities/closing-line.ts';
import { RestaurantWasteLine } from '../entities/waste-line.ts';
import { servingCategory } from '../services/calculation.ts';
import { decimal, merged } from '../services/load.ts';
import { assertIngredient, submittedRecipe } from './recipe.ts';

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const recipeId = merged(row, previous, 'recipeId');
  if (typeof recipeId !== 'string') return;
  const recipe = await submittedRecipe(ctx, recipeId);
  const quantity = decimal(merged(row, previous, 'quantity') ?? '1', 'quantity');
  const changedRecipe = previous && row.recipeId !== undefined && row.recipeId !== previous.recipeId;
  const price = decimal((changedRecipe && row.unitPrice === undefined ? recipe.unitPrice : merged(row, previous, 'unitPrice')) ?? recipe.unitPrice, 'unitPrice');
  row.unitPrice = price;
  row.description = recipe.name;
  row.taxCategory = servingCategory(String(merged(row, previous, 'serviceMode') ?? 'dine_in'), recipe.alcohol);
  row.amount = quantity.times(price);
}
async function touch(ctx: Context, id: unknown): Promise<void> {
  if (typeof id !== 'string' || isSavingLines(ctx, RestaurantClosing.name, id)) return;
  const parent = await repo(ctx, RestaurantClosing).get(id);
  if (parent.docstatus === DOCSTATUS.draft) await repo(ctx, RestaurantClosing).update(id, {});
}
export function registerClosingLineHooks(): void {
  registry.registerHook(RestaurantClosingLine.name, 'before_validate', beforeValidate);
  registry.registerHook(RestaurantWasteLine.name, 'before_validate', (ctx, { row, previous }) => assertIngredient(ctx, merged(row, previous, 'productId')));
  for (const entity of [RestaurantClosingLine, RestaurantWasteLine]) {
    registry.registerHook(entity.name, 'after_create', (ctx, { row }) => touch(ctx, row.closingId));
    registry.registerHook(entity.name, 'after_update', async (ctx, { row, previous }) => {
      await touch(ctx, row.closingId);
      if (previous?.closingId !== row.closingId) await touch(ctx, previous?.closingId);
    });
    registry.registerHook(entity.name, 'after_delete', (ctx, { row }) => touch(ctx, row.closingId));
  }
}
