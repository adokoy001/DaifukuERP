// Demo data (docs/specs/pack-retail.md AC-6 / AC-9): the four products of 「まめや」 and its wholesaler S1. Runs once per company
// (pack.apply with sample); codes that already exist are skipped so a forced re-run is safe. Sale prices are tax-inclusive
// (register prices), purchase prices tax-exclusive (the wholesaler's bill). JAN values use the in-store prefix 20 (fictional).
import { repo, type Context } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { Product } from '@daifuku/mod-product';
import type { RetailKind } from './seed.ts';

export const SAMPLE_SUPPLIER_CODE = 'S1';

export const SAMPLE_PRODUCTS = [
  {
    code: 'P1',
    name: '弁当',
    taxCategory: 'reduced',
    salePrice: '540',
    purchasePrice: '300',
    ext: { jan: '2000000000015', supplierCode: 'S1-BENTO', shelf: 'A-01' },
  },
  {
    code: 'P2',
    name: 'お茶',
    taxCategory: 'reduced',
    salePrice: '162',
    purchasePrice: '80',
    ext: { jan: '2000000000022', supplierCode: 'S1-TEA', shelf: 'A-02' },
  },
  {
    code: 'P3',
    name: '雑貨',
    taxCategory: 'standard',
    salePrice: '1100',
    purchasePrice: '600',
    ext: { jan: '2000000000039', supplierCode: 'S1-GOODS', shelf: 'B-01' },
  },
  {
    code: 'P4',
    name: '文具',
    taxCategory: 'standard',
    salePrice: '330',
    purchasePrice: '150',
    ext: { jan: '2000000000046', supplierCode: 'S1-PEN', shelf: 'B-02' },
  },
] as const;

export async function sampleRetail(ctx: Context): Promise<void> {
  const products = repo(ctx, Product);
  const present = new Set(
    (
      await products.list({
        where: { code: { $in: SAMPLE_PRODUCTS.map((p) => p.code) } },
        limit: SAMPLE_PRODUCTS.length,
      })
    ).items.map((p) => p.code),
  );
  for (const p of SAMPLE_PRODUCTS) {
    if (!present.has(p.code)) await products.create({ ...p, kind: 'goods', ext: { ...p.ext } });
  }
  const partners = repo(ctx, Partner);
  if ((await partners.count({ code: SAMPLE_SUPPLIER_CODE })) > 0) return;
  await partners.create({
    code: SAMPLE_SUPPLIER_CODE,
    name: '卸売商事',
    isSupplier: true,
    taxStatus: 'registered',
    ext: { retailKind: 'wholesaler' satisfies RetailKind },
  });
}
