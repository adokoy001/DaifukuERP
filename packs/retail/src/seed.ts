// Idempotent masters (docs/specs/pack-retail.md AC-6): the 三分法 accounts the month close posts to, and the walk-in customer
// every register closing bills. Existing codes are left untouched (no overwrite, no audit churn); `force` re-runs safely.
// Accounts go through l10n/jp's seedChartOfAccounts with the pack's own chart (same idempotent code path as the JP chart).
import { repo, type Context } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { seedChartOfAccounts, type SeedAccount } from '@daifuku/l10n-jp';

export const COGS_SUBTYPE = '売上原価';

/** No taxCategoryDefault: inventory transfers and shrinkage are not taxable purchases (tax_period_summary skips them). */
export const RETAIL_ACCOUNTS: readonly SeedAccount[] = [
  { code: '5050', name: '期首商品棚卸高', type: 'expense', subtype: COGS_SUBTYPE },
  { code: '5100', name: '期末商品棚卸高', type: 'expense', subtype: COGS_SUBTYPE },
  { code: '6990', name: '棚卸減耗損', type: 'expense', subtype: '販売費及び一般管理費' },
];

export const WALK_IN_CODE = 'WALKIN';

export const RETAIL_KINDS = ['walk_in', 'card_company', 'wholesaler'] as const;
export type RetailKind = (typeof RETAIL_KINDS)[number];

export async function seedRetail(ctx: Context): Promise<void> {
  await seedChartOfAccounts(ctx, RETAIL_ACCOUNTS);
  const partners = repo(ctx, Partner);
  if ((await partners.count({ code: WALK_IN_CODE })) > 0) return;
  await partners.create({ code: WALK_IN_CODE, name: '店頭客', isCustomer: true, notes: 'レジ締めの売上請求書の相手（retail pack）', ext: { retailKind: 'walk_in' satisfies RetailKind } });
}
