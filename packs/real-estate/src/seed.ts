// Idempotent masters (spec AC-6): the revenue accounts and the rental products. Codes that already exist are left alone
// (no overwrite, no audit churn), so pack:apply --force re-runs safely. 預り金 2500 / 雑収入 4100 / 普通預金 1100 come from
// the l10n/jp chart of accounts. 4210 礼金・更新料収入 is created but not posted to in v1: sales posts every invoice line
// to sales.accounts.revenue (4200), key money included (docs/domain/scenario-real-estate.md ひっかけ 3).
import { repo, type Context } from '@daifuku/kernel';
import { Account, type AccountInsert } from '@daifuku/mod-accounting';
import { Product, type TaxCategory } from '@daifuku/mod-product';

export const SEED_ACCOUNTS: readonly AccountInsert[] = [
  { code: '4200', name: '賃貸料収入', type: 'revenue', subtype: '売上' },
  { code: '4210', name: '礼金・更新料収入', type: 'revenue', subtype: '売上' },
];

export const SEED_PRODUCTS: readonly { code: string; name: string; kind: 'service'; taxCategory: TaxCategory; description: string }[] = [
  { code: 'RENT', name: '家賃', kind: 'service', taxCategory: 'non_taxable', description: '住宅の家賃（非課税）。事務所・店舗・駐車場には RENT_TAXABLE' },
  { code: 'RENT_TAXABLE', name: '家賃（課税）', kind: 'service', taxCategory: 'standard', description: '事務所・店舗の家賃、駐車場代（課税）' },
  { code: 'KEY_MONEY', name: '礼金', kind: 'service', taxCategory: 'non_taxable', description: '住宅の礼金（非課税）。real_estate.move_in は部屋の用途から税区分を決める' },
];

async function seedMissing<T extends { code: string }>(codes: readonly T[], existing: () => Promise<{ code: string | null }[]>, create: (row: T) => Promise<unknown>): Promise<void> {
  const present = new Set((await existing()).map((r) => r.code));
  for (const row of codes) if (!present.has(row.code)) await create(row);
}

export async function seedRealEstate(ctx: Context): Promise<void> {
  const accounts = repo(ctx, Account);
  await seedMissing(
    SEED_ACCOUNTS,
    async () => (await accounts.list({ where: { code: { $in: SEED_ACCOUNTS.map((a) => a.code) } }, limit: SEED_ACCOUNTS.length })).items,
    (a) => accounts.create(a),
  );
  const products = repo(ctx, Product);
  await seedMissing(
    SEED_PRODUCTS,
    async () => (await products.list({ where: { code: { $in: SEED_PRODUCTS.map((p) => p.code) } }, limit: SEED_PRODUCTS.length })).items,
    (p) => products.create(p),
  );
}
