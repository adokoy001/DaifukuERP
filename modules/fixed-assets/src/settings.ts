// Company settings owned by fixed_assets (docs/specs/fixed-assets.md AC-28, AC-35; ADR-0013 L1, ADR-0027).
// Accounts are stored by code like purchase.accounts; the Japanese chart (l10n/jp) seeds the defaults.
import { getSetting, label, repo, StateError, type Context, type SettingDef } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { z } from 'zod';

export const FIXED_ASSET_ACCOUNTS_KEY = 'fixed_assets.accounts';
export const RULES_CONFIRMATION_KEY = 'fixed_assets.rules_confirmation';

const code = (fallback: string) => z.string().min(1).max(20).default(fallback);

export const fixedAssetAccountsSchema = z.object({
  /** 減価償却累計額: default accumulated depreciation of tangible assets. */
  accumulated: code('1929'),
  /** 減価償却費. */
  expense: code('6700'),
  /** 固定資産売却益 (特別利益). */
  gainOnSale: code('8100'),
  /** 固定資産売却損 (特別損失). */
  lossOnSale: code('8200'),
  /** 固定資産除却損 (特別損失). */
  lossOnRetirement: code('8300'),
  /** 未収入金: default account of the sale proceeds. */
  proceeds: code('1910'),
  /** 仮受消費税: output tax on a sale. */
  outputTax: code('2200'),
});
export type FixedAssetAccountCodes = z.output<typeof fixedAssetAccountsSchema>;
export type FixedAssetAccountRole = keyof FixedAssetAccountCodes;
export const FIXED_ASSET_ACCOUNTS_DEFAULT: FixedAssetAccountCodes = {
  accumulated: '1929',
  expense: '6700',
  gainOnSale: '8100',
  lossOnSale: '8200',
  lossOnRetirement: '8300',
  proceeds: '1910',
  outputTax: '2200',
};

export const rulesConfirmationSchema = z.object({
  /** Id of the rule set (fixed_assets.depreciation_rules) a person compared with the primary sources. */
  ruleSetId: z.string().max(100).default(''),
  /** Date of that comparison (YYYY-MM-DD), empty when not confirmed. */
  confirmedOn: z
    .string()
    .max(10)
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .default(''),
});
export type RulesConfirmation = z.output<typeof rulesConfirmationSchema>;
export const RULES_CONFIRMATION_DEFAULT: RulesConfirmation = { ruleSetId: '', confirmedOn: '' };

export const FIXED_ASSET_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: FIXED_ASSET_ACCOUNTS_KEY,
    label: label('固定資産の転記科目', 'Fixed asset posting accounts'),
    description: label(
      '資産の登録時に空の科目を補い、償却・除却・売却の仕訳に使う勘定科目',
      'Accounts that fill empty asset accounts and that depreciation, retirement and sale entries post to',
    ),
    schema: fixedAssetAccountsSchema,
    default: FIXED_ASSET_ACCOUNTS_DEFAULT,
    category: 'accounting',
    order: 40,
    fields: {
      accumulated: { label: label('減価償却累計額', 'Accumulated depreciation'), widget: 'account-code' },
      expense: { label: label('減価償却費', 'Depreciation expense'), widget: 'account-code' },
      gainOnSale: { label: label('固定資産売却益', 'Gain on sale of fixed assets'), widget: 'account-code' },
      lossOnSale: { label: label('固定資産売却損', 'Loss on sale of fixed assets'), widget: 'account-code' },
      lossOnRetirement: {
        label: label('固定資産除却損', 'Loss on retirement of fixed assets'),
        widget: 'account-code',
      },
      proceeds: {
        label: label('売却代金（未収入金）', 'Sale proceeds (other receivables)'),
        widget: 'account-code',
      },
      outputTax: { label: label('仮受消費税', 'Output tax'), widget: 'account-code' },
    },
  },
  {
    key: RULES_CONFIRMATION_KEY,
    label: label('償却率表の照合記録', 'Depreciation rate table confirmation'),
    description: label(
      '国別パックの償却率表が一次資料と未照合のとき、担当者が耐用年数省令の別表と照合した規則集合の id と照合日を記録します。記録が現在の規則集合を指すまで償却・除却の転記はできません。',
      'When the country pack has not verified its rate tables, record the id of the rule set a person compared with the statutory tables and the date. Depreciation and disposal postings stay blocked until the record names the current rule set.',
    ),
    schema: rulesConfirmationSchema,
    default: RULES_CONFIRMATION_DEFAULT,
    category: 'accounting',
    order: 41,
    fields: {
      ruleSetId: { label: label('規則集合の id', 'Rule set id') },
      confirmedOn: { label: label('照合日（YYYY-MM-DD）', 'Confirmed on (YYYY-MM-DD)') },
    },
  },
];

export async function loadAccountCodes(ctx: Context): Promise<FixedAssetAccountCodes> {
  return getSetting(ctx, FIXED_ASSET_ACCOUNTS_KEY, fixedAssetAccountsSchema, FIXED_ASSET_ACCOUNTS_DEFAULT);
}

export interface AccountInfo {
  id: string;
  code: string;
  type: string;
  partnerRequired: boolean;
}

/** AC-28: account ids for the given roles; a missing code is INVALID_STATE naming the setting, role and code. */
export async function resolveAccounts<R extends FixedAssetAccountRole>(
  ctx: Context,
  roles: readonly R[],
): Promise<Record<R, AccountInfo>> {
  const codes = await loadAccountCodes(ctx);
  const wanted = [...new Set(roles.map((r) => codes[r]))];
  const found = await repo(ctx, Account).list({ where: { code: { $in: wanted } }, limit: wanted.length });
  const byCode = new Map(found.items.map((a) => [a.code, a]));
  const out = {} as Record<R, AccountInfo>;
  for (const role of roles) {
    const a = byCode.get(codes[role]);
    if (!a)
      throw new StateError(
        `account ${codes[role]} (${FIXED_ASSET_ACCOUNTS_KEY}.${role}) does not exist in this company`,
        `Create the account with code ${codes[role]} or point setting ${FIXED_ASSET_ACCOUNTS_KEY}.${role} at an existing account code.`,
        { setting: FIXED_ASSET_ACCOUNTS_KEY, role, code: codes[role] },
      );
    out[role] = { id: a.id, code: a.code, type: a.type, partnerRequired: a.partnerRequired };
  }
  return out;
}
