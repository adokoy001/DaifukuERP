import { repo, type Context } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';

export const SERVICE_PRODUCTS = [
  { code: 'APP-REPAIR', name: '家電修理技術料', salePrice: '8000' },
  { code: 'APP-INSTALL', name: '家電設置作業料', salePrice: '15000' },
] as const;

export async function seedApplianceStore(ctx: Context): Promise<void> {
  const products = repo(ctx, Product);
  for (const value of SERVICE_PRODUCTS) {
    if (await products.count({ code: value.code })) continue;
    await products.create({ ...value, kind: 'service', taxCategory: 'standard', isPurchased: false });
  }
}
