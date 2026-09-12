import { repo, saveLines, todayLocal, type Context } from '@daifuku/kernel';
import { addDays, type JobDef } from '@daifuku/mod-industry-operations';
import { resolveDefaultWarehouse, StockEntry, StockEntryLine } from '@daifuku/mod-inventory';
import { Partner } from '@daifuku/mod-partner';
import { Product } from '@daifuku/mod-product';
import type { IndustryProfile } from './profile.ts';
import { productCode } from './seed.ts';
export const sampleReference = (name: string): string => `DEMO-${name.toUpperCase()}-001`;
export const WHOLESALE_RECEIPT_NOTE = '業界デモ卸売: 入庫下書き（架空評価単価500円、利用者確認後に確定）';
async function receiptDraft(ctx: Context, productId: string, date: string): Promise<void> {
  if (await repo(ctx, StockEntry).count({ note: WHOLESALE_RECEIPT_NOTE })) return;
  const warehouse = await resolveDefaultWarehouse(ctx);
  const stock = await repo(ctx, StockEntry).create({ type: 'receipt', date, warehouseId: warehouse.id, note: WHOLESALE_RECEIPT_NOTE });
  await saveLines(ctx, StockEntry, stock.id, { [StockEntryLine.name]: [{ productId, quantity: '100', unitCost: '500' }] });
}
export async function sampleIndustry(ctx: Context, profile: IndustryProfile, Job: JobDef): Promise<void> {
  const partners = repo(ctx, Partner), code = `IND-${profile.job.name.toUpperCase().slice(0, 16)}`;
  const found = (await partners.list({ where: { code }, limit: 1 })).items[0];
  const partner = found ?? await partners.create({ code, name: `${profile.job.label.ja}の取引先（架空）`, isCustomer: true });
  const product = (await repo(ctx, Product).list({ where: { code: productCode(profile) }, limit: 1 })).items[0];
  if (!product) throw new Error('業界の品目 seed を先に実行してください。');
  const date = todayLocal(ctx.now());
  if (profile.job.productKind === 'goods') await receiptDraft(ctx, product.id, date);
  if (await repo(ctx, Job).count({ reference: sampleReference(profile.job.name) })) return;
  await repo(ctx, Job).create({ reference: sampleReference(profile.job.name), title: `${profile.productName}の履行（サンプル）`, partnerId: partner.id, productId: product.id, date, plannedDate: addDays(date, 2), orderedQuantity: profile.orderedQuantity, unitPrice: profile.unitPrice, taxCategory: 'standard', ...profile.sample(date) });
}
