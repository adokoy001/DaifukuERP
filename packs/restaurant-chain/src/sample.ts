import { repo, saveLines, StateError, submitDocument, type Context } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { Warehouse } from '@daifuku/mod-inventory';
import { Partner } from '@daifuku/mod-partner';
import { Product, Uom } from '@daifuku/mod-product';
import { RestaurantStore } from './entities/store.ts';
import { RestaurantRecipe } from './entities/recipe.ts';
import { RecipeIngredient } from './entities/recipe-ingredient.ts';
import { WALK_IN_CODE } from './seed.ts';

export const SAMPLE_PRODUCTS = [
  { code: 'RC-RICE', name: '米（材料）', kind: 'goods', taxCategory: 'reduced', purchasePrice: '500', isSold: false },
  { code: 'RC-CHICKEN', name: '鶏肉（材料）', kind: 'goods', taxCategory: 'reduced', purchasePrice: '1000', isSold: false },
  { code: 'RC-CURRY', name: 'チキンカレー（メニュー）', kind: 'service', salePrice: '1100', isPurchased: false },
] as const;

async function sampleProducts(ctx: Context): Promise<Map<string, string>> {
  let kg = (await repo(ctx, Uom).list({ where: { code: 'RC-KG' }, limit: 1 })).items[0];
  kg ??= await repo(ctx, Uom).create({ code: 'RC-KG', name: 'キログラム', symbol: 'kg' });
  const ids = new Map<string, string>();
  for (const p of SAMPLE_PRODUCTS) {
    const existing = (await repo(ctx, Product).list({ where: { code: p.code }, limit: 1 })).items[0];
    const product = existing ?? await repo(ctx, Product).create({ ...p, ...(p.kind === 'goods' ? { uomId: kg.id } : {}) });
    ids.set(p.code, product.id);
  }
  return ids;
}
async function sampleStores(ctx: Context): Promise<void> {
  const account = (await repo(ctx, Account).list({ where: { code: '1000' }, limit: 1 })).items[0];
  const partner = (await repo(ctx, Partner).list({ where: { code: WALK_IN_CODE }, limit: 1 })).items[0];
  if (!account || !partner) throw new StateError('先に日本の勘定科目と飲食店テンプレートを初期化してください', 'Apply the Japan module and restaurant seed first.');
  for (const [code, name] of [['RC-A', '青葉店'], ['RC-B', '港店']] as const) {
    if (await repo(ctx, RestaurantStore).count({ code })) continue;
    const warehouse = (await repo(ctx, Warehouse).list({ where: { code }, limit: 1 })).items[0]
      ?? await repo(ctx, Warehouse).create({ code, name: `${name} 厨房` });
    await repo(ctx, RestaurantStore).create({ code, name, warehouseId: warehouse.id, partnerId: partner.id, cashAccountId: account.id });
  }
}
/** Repeat application preserves existing masters, recipe versions and stock balances. */
export async function sampleRestaurantChain(ctx: Context): Promise<void> {
  const ids = await sampleProducts(ctx);
  await sampleStores(ctx);
  if (await repo(ctx, RestaurantRecipe).count({ code: 'RC-CURRY-V1' })) return;
  const curry = ids.get('RC-CURRY'), rice = ids.get('RC-RICE'), chicken = ids.get('RC-CHICKEN');
  if (!curry || !rice || !chicken) throw new TypeError('Restaurant sample product missing');
  const recipe = await repo(ctx, RestaurantRecipe).create({ code: 'RC-CURRY-V1', name: 'チキンカレー v1', productId: curry, unitPrice: '1100', note: '1食につき米0.2 kg・鶏肉0.1 kg。持帰り税込単価1080円の例は明細で変更します。' });
  await saveLines(ctx, RestaurantRecipe, recipe.id, { [RecipeIngredient.name]: [
    { productId: rice, quantity: '0.2' },
    { productId: chicken, quantity: '0.1' },
  ] });
  await submitDocument(ctx, RestaurantRecipe, recipe.id);
}
