// Company settings owned by purchase (ADR-0013 L1): which accounts the bill posts to, by account code. The Japanese
// chart of accounts is seeded by l10n/jp; the codes here are the conventional ones (仕入高 5000, 仮払消費税 1500, 買掛金 2100).
import { getSetting, label, repo, StateError, type Context, type SettingDef } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { z } from 'zod';
import type { PostingAccounts } from './services/posting.ts';

export const PURCHASE_ACCOUNTS_KEY = 'purchase.accounts';

export const purchaseAccountsSchema = z.object({
  /** 仕入高: product lines. */
  purchases: z.string().min(1).max(20).default('5000'),
  /** 買掛金: the credit side of every bill. */
  payable: z.string().min(1).max(20).default('2100'),
  /** 仮払消費税: deductible input tax. */
  taxReceivable: z.string().min(1).max(20).default('1500'),
});
export type PurchaseAccountCodes = z.output<typeof purchaseAccountsSchema>;
export const PURCHASE_ACCOUNTS_DEFAULT: PurchaseAccountCodes = {
  purchases: '5000',
  payable: '2100',
  taxReceivable: '1500',
};

export const PURCHASE_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: PURCHASE_ACCOUNTS_KEY,
    label: label('仕入の転記科目', 'Purchase posting accounts'),
    description: label(
      '仕入請求書の確定（submit）で仕訳に使う勘定科目',
      'Accounts the journal entry of a submitted purchase invoice posts to',
    ),
    schema: purchaseAccountsSchema,
    default: PURCHASE_ACCOUNTS_DEFAULT,
    order: 10,
    fields: {
      purchases: {
        label: label('仕入高', 'Purchases'),
        description: label('品目の明細', 'Product lines'),
        widget: 'account-code',
      },
      payable: { label: label('買掛金', 'Accounts payable'), widget: 'account-code' },
      taxReceivable: { label: label('仮払消費税', 'Input tax'), widget: 'account-code' },
    },
  },
];

export async function loadPurchaseAccountCodes(ctx: Context): Promise<PurchaseAccountCodes> {
  return getSetting(ctx, PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema, PURCHASE_ACCOUNTS_DEFAULT);
}

/** Account ids for posting. A missing account is INVALID_STATE with the code to create (or the setting to change). */
export async function resolvePostingAccounts(ctx: Context): Promise<PostingAccounts> {
  const codes = await loadPurchaseAccountCodes(ctx);
  const wanted = [codes.purchases, codes.payable, codes.taxReceivable];
  const found = await repo(ctx, Account).list({ where: { code: { $in: wanted } }, limit: wanted.length });
  const byCode = new Map(found.items.map((a) => [a.code, a.id]));
  const idOf = (role: keyof PurchaseAccountCodes): string => {
    const id = byCode.get(codes[role]);
    if (!id) {
      throw new StateError(
        `account ${codes[role]} (${PURCHASE_ACCOUNTS_KEY}.${role}) does not exist in this company`,
        `Create the account with code ${codes[role]} or point setting ${PURCHASE_ACCOUNTS_KEY}.${role} at an existing account code.`,
        { setting: PURCHASE_ACCOUNTS_KEY, role, code: codes[role] },
      );
    }
    return id;
  };
  return { purchases: idOf('purchases'), payable: idOf('payable'), taxReceivable: idOf('taxReceivable') };
}
