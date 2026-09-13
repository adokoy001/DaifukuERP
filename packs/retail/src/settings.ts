// The pack's own company setting (docs/specs/pack-retail.md AC-5; ADR-0013 L1): the account codes of the month-end
// 三分法 transfer, and the defaults the pack writes for settings the modules declare.
import { getSetting, label, repo, StateError, type Context, type SettingDef } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import {
  ALLOW_NEGATIVE_STOCK_KEY,
  AUTO_ISSUE_ON_SALES_KEY,
  AUTO_RECEIPT_ON_PURCHASE_KEY,
} from '@daifuku/mod-inventory';
import { TAX_PRICE_INCLUDES_TAX_KEY } from '@daifuku/mod-tax';
import { z } from 'zod';

export const CLOSING_ACCOUNTS_KEY = 'retail.closing_accounts';

const code = z.string().min(1).max(20);

export const closingAccountsSchema = z.object({
  /** 商品 (asset): holds the month-end inventory. */
  inventory: code,
  /** 期末商品棚卸高 (expense, credited): reduces the cost of sales by the closing inventory. */
  closingStock: code,
  /** 期首商品棚卸高 (expense, debited): the previous closing inventory transferred back into the cost of sales. */
  openingStock: code,
});
export type ClosingAccountCodes = z.output<typeof closingAccountsSchema>;
export const CLOSING_ACCOUNTS_DEFAULT: ClosingAccountCodes = {
  inventory: '1400',
  closingStock: '5100',
  openingStock: '5050',
};

export const CLOSING_ACCOUNTS_SETTING: SettingDef<ClosingAccountCodes> = {
  key: CLOSING_ACCOUNTS_KEY,
  label: label('月次締め（三分法）の勘定科目', 'Month-close accounts (periodic inventory)'),
  description: label(
    '科目コード: inventory=商品, closingStock=期末商品棚卸高, openingStock=期首商品棚卸高',
    'Account codes: inventory, closingStock (closing inventory), openingStock (opening inventory)',
  ),
  schema: closingAccountsSchema,
};

/** Company setting defaults applied by pack.apply (only for keys the company has not set; `force` overwrites). */
export const RETAIL_SETTING_DEFAULTS = {
  [TAX_PRICE_INCLUDES_TAX_KEY]: true,
  [ALLOW_NEGATIVE_STOCK_KEY]: false,
  [AUTO_ISSUE_ON_SALES_KEY]: true,
  [AUTO_RECEIPT_ON_PURCHASE_KEY]: true,
  [CLOSING_ACCOUNTS_KEY]: CLOSING_ACCOUNTS_DEFAULT,
} as const;

export const ACCOUNTS_HINT = `Apply the retail pack (its seed creates 5050/5100/6990; l10n/jp seeds 1400) or change ${CLOSING_ACCOUNTS_KEY}.`;

export interface ClosingAccountIds {
  inventory: string;
  closingStock: string;
  openingStock: string;
}

/** Account ids for the codes in `retail.closing_accounts`; INVALID_STATE naming every missing code. */
export async function resolveClosingAccounts(ctx: Context): Promise<ClosingAccountIds> {
  const codes = await getSetting(ctx, CLOSING_ACCOUNTS_KEY, closingAccountsSchema, CLOSING_ACCOUNTS_DEFAULT);
  const wanted = [...new Set(Object.values(codes))];
  const found = await repo(ctx, Account).list({ where: { code: { $in: wanted } }, limit: wanted.length });
  const byCode = new Map(found.items.map((a) => [a.code, a.id]));
  const roles = ['inventory', 'closingStock', 'openingStock'] as const;
  const missing = roles.filter((r) => !byCode.has(codes[r]));
  if (missing.length > 0) {
    throw new StateError(
      `account code(s) ${missing.map((r) => `${codes[r]} (${r})`).join(', ')} do not exist`,
      ACCOUNTS_HINT,
      { setting: CLOSING_ACCOUNTS_KEY, missing: Object.fromEntries(missing.map((r) => [r, codes[r]])) },
    );
  }
  const id = (r: (typeof roles)[number]) => byCode.get(codes[r]) ?? '';
  return { inventory: id('inventory'), closingStock: id('closingStock'), openingStock: id('openingStock') };
}
