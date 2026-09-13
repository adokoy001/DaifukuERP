// product.resolve_price（AC-8）: 販売/購買側の単価・税区分・単位を返す。価格表・数量割引は Phase 3（スコープ外）。
import { StateError, defineAction, label, repo } from '@daifuku/kernel';
import { z } from 'zod';
import { Product, TAX_CATEGORIES } from '../entities/product.ts';

export const PRICE_SIDES = ['sale', 'purchase'] as const;
export type PriceSide = (typeof PRICE_SIDES)[number];

export const resolvePriceInput = z.object({
  productId: z.uuid(),
  side: z.enum(PRICE_SIDES),
});

export const resolvePriceOutput = z.object({
  /** Decimal string; null when the product has no price on that side. */
  price: z.string().nullable(),
  taxCategory: z.enum(TAX_CATEGORIES),
  uomId: z.uuid(),
});

export const resolvePrice = defineAction({
  name: 'product.resolve_price',
  description: label(
    '品目の販売または仕入の単価・税区分・単位を返します。伝票の明細行を作るときに使います。単価未設定なら price は null です。',
    'Return the sale or purchase unit price, tax category and unit of measure of a product. Use it when adding a document line. price is null when the product has no price on that side.',
  ),
  input: resolvePriceInput,
  output: resolvePriceOutput,
  permission: { entity: 'product', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, { productId, side }) => {
    const p = await repo(ctx, Product).get(productId);
    // uomId is kept non-null by the before_validate hook; a null here means the row bypassed it.
    if (!p.uomId)
      throw new StateError(
        `product ${productId} has no unit of measure`,
        'Update the product with a uomId, then retry.',
      );
    const price = side === 'sale' ? p.salePrice : p.purchasePrice;
    return { price: price ? price.toString() : null, taxCategory: p.taxCategory, uomId: p.uomId };
  },
});
