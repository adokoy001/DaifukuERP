import { repo, type Context } from '@daifuku/kernel';
import { Product, Uom } from '@daifuku/mod-product';
import type { IndustryProfile } from './profile.ts';
export const productCode = (profile: IndustryProfile): string => `IND-${profile.job.name.toUpperCase()}`;
export async function seedIndustry(ctx: Context, profile: IndustryProfile): Promise<void> {
  const units = repo(ctx, Uom), products = repo(ctx, Product);
  const found = (await units.list({ where: { code: profile.job.unitCode }, limit: 1 })).items[0];
  const unit = found ?? await units.create({ code: profile.job.unitCode, name: profile.unitName });
  if (!await products.count({ code: productCode(profile) })) await products.create({ code: productCode(profile), name: profile.productName, kind: profile.job.productKind, uomId: unit.id, salePrice: profile.unitPrice, taxCategory: 'standard', isPurchased: profile.job.productKind === 'goods', description: '架空の練習品目。実取引の料金・税区分は契約に応じて確認してください。' });
}
