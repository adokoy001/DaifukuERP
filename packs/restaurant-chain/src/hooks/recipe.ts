import { DOCSTATUS, registry, repo, StateError, ValidationError, type Context, type HookArgs } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { RecipeIngredient } from '../entities/recipe-ingredient.ts';
import { RestaurantRecipe } from '../entities/recipe.ts';
import { RestaurantClosingLine } from '../entities/closing-line.ts';
import { ingredients, merged } from '../services/load.ts';

export async function assertIngredient(ctx: Context, productId: unknown): Promise<void> {
  if (typeof productId !== 'string') return;
  const product = await repo(ctx, Product).get(productId);
  if (product.kind !== 'goods') throw new ValidationError('材料には物品の品目を選んでください', [{ path: 'productId', message: 'ingredient must be goods' }]);
}
export async function submittedRecipe(ctx: Context, recipeId: string) {
  const recipe = await repo(ctx, RestaurantRecipe).lock(recipeId, 'read');
  if (recipe.docstatus !== DOCSTATUS.submitted) throw new StateError('レシピを先に確定してください', 'Submit the recipe before entering menu sales.');
  return recipe;
}
async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const product = await repo(ctx, Product).get(String(row.productId));
  if (product.kind !== 'service') throw new ValidationError('メニューの販売品目はサービスにしてください', [{ path: 'productId', message: 'menu product must be service; ingredients are issued separately' }]);
  const lines = await ingredients(ctx, String(row.id));
  if (!lines.length) throw new ValidationError('1食分の材料を入力してください', [{ path: 'lines', message: 'at least one ingredient required' }]);
  for (const line of lines) await assertIngredient(ctx, line.productId);
}
export function registerRecipeHooks(): void {
  registry.registerHook(RestaurantRecipe.name, 'before_submit', beforeSubmit);
  registry.registerHook(RecipeIngredient.name, 'before_validate', (ctx, { row, previous }) => assertIngredient(ctx, merged(row, previous, 'productId')));
  registry.registerHook(RestaurantRecipe.name, 'before_cancel', async (ctx, { row }) => {
    if (await repo(ctx, RestaurantClosingLine).count({ recipeId: String(row.id) })) throw new StateError('使用済みレシピは取消できません', 'Create a new recipe revision for future sales.');
  });
}
