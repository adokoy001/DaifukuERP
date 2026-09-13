// サンプル品目のシード（AC-9）: 物品・サービス・軽減税率の飲食料品を各1件、code で冪等。
import { StateError, repo, type Context, type InsertInput } from '@daifuku/kernel';
import { Product } from '../entities/product.ts';
import { findUomByCode, seedUoms } from './uoms.ts';

interface SampleProduct extends Omit<InsertInput<typeof Product>, 'uomId'> {
  code: string;
  uomCode: string;
}

export const SAMPLE_PRODUCTS: readonly SampleProduct[] = [
  {
    code: 'SAMPLE-GOODS',
    name: 'サンプル商品',
    nameKana: 'サンプルショウヒン',
    kind: 'goods',
    taxCategory: 'standard',
    uomCode: 'H87',
    salePrice: '1000',
    purchasePrice: '600',
    description: '標準税率の物品のサンプル。',
  },
  {
    code: 'SAMPLE-SERVICE',
    name: '保守サービス',
    nameKana: 'ホシュサービス',
    kind: 'service',
    taxCategory: 'standard',
    uomCode: 'HUR',
    salePrice: '8000',
    isPurchased: false,
    description: '時間単位で販売するサービスのサンプル。',
  },
  {
    code: 'SAMPLE-FOOD',
    name: '米（軽減税率）',
    nameKana: 'コメ',
    kind: 'goods',
    taxCategory: 'reduced',
    uomCode: 'KGM',
    salePrice: '500',
    purchasePrice: '300',
    description: '軽減税率（飲食料品）の物品のサンプル。',
  },
];

/** Idempotent: creates each sample product that does not exist yet (matched by code). Seeds the standard units first. */
export async function seedProducts(ctx: Context): Promise<void> {
  await seedUoms(ctx);
  const r = repo(ctx, Product);
  for (const { uomCode, ...fields } of SAMPLE_PRODUCTS) {
    const existing = await r.list({ where: { code: fields.code }, limit: 1 });
    if (existing.items.length > 0) continue;
    const uom = await findUomByCode(ctx, uomCode);
    if (!uom)
      throw new StateError(
        `product seed: uom ${uomCode} is missing after seedUoms`,
        'Check that STANDARD_UOMS contains every uomCode used by SAMPLE_PRODUCTS.',
      );
    await r.create({ ...fields, uomId: uom.id });
  }
}
