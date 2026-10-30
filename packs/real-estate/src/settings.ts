// Settings of the real-estate pack (docs/specs/pack-real-estate.md AC-5; ADR-0013 L1).
// `real_estate.accounts` is the pack's own setting (declared in the pack hooks); the defaults for the module settings the
// pack changes (sales.accounts, contract.*, tax.price_includes_tax) are in pack.ts `settings` and applied by pack:apply.
import { getSetting, label, type Context, type SettingDef } from '@daifuku/kernel';
import { CONTRACT_AUTO_SUBMIT_KEY, CONTRACT_DEFAULT_PRORATION_KEY } from '@daifuku/mod-contract';
import { loadPaymentAccountCodes } from '@daifuku/mod-payment';
import { SALES_ACCOUNTS_KEY } from '@daifuku/mod-sales';
import { TAX_PRICE_INCLUDES_TAX_KEY } from '@daifuku/mod-tax';
import { z } from 'zod';

export const REAL_ESTATE_ACCOUNTS_KEY = 'real_estate.accounts';

const code = z.string().min(1).max(20);

export const realEstateAccountsSchema = z.object({
  /** 預り金: credited when a deposit (敷金) is received, debited when it is returned. */
  deposit: code,
  /** 賃貸料収入: informational in v1 — invoices post to `sales.accounts.revenue`, which the pack sets to the same code. */
  rentRevenue: code,
  /** 普通預金 used for deposit receipts/returns when the action gets no accountId; falls back to payment.accounts.bank. */
  bank: code.optional(),
  /** 雑収入: credited with the part of a returned deposit kept for 原状回復 when return_deposit gets no deductionAccountId. */
  deduction: code,
});
export type RealEstateAccounts = z.output<typeof realEstateAccountsSchema>;

export const REAL_ESTATE_ACCOUNTS_DEFAULT: RealEstateAccounts = {
  deposit: '2500',
  rentRevenue: '4200',
  bank: '1100',
  deduction: '4100',
};

export const REAL_ESTATE_ACCOUNTS_SETTING: SettingDef<RealEstateAccounts> = {
  key: REAL_ESTATE_ACCOUNTS_KEY,
  label: label('賃貸管理の勘定科目', 'Rental accounts'),
  description: label(
    '敷金の預り・返還と賃貸料の仕訳に使う勘定科目',
    'Accounts used by security deposit receipts / returns and rent',
  ),
  schema: realEstateAccountsSchema,
  default: REAL_ESTATE_ACCOUNTS_DEFAULT,
  fields: {
    deposit: {
      label: label('預り金（敷金）', 'Security deposits held'),
      widget: 'account-code',
    },
    rentRevenue: {
      label: label('賃貸料収入', 'Rent revenue'),
      description: label(
        '参考。請求書の転記先は売上転記の勘定科目の売上高',
        'Informational; invoices post to the revenue account of the sales posting accounts',
      ),
      widget: 'account-code',
    },
    bank: {
      label: label('敷金の入出金口座', 'Deposit bank account'),
      description: label('省略時は入出金の勘定科目の普通預金', 'Defaults to the bank account of the payment accounts'),
      widget: 'account-code',
    },
    deduction: {
      label: label('敷金から控除した原状回復費', 'Deposit deductions'),
      description: label('返還時に控除した額の計上先', 'Where the amount kept from a returned deposit is posted'),
      widget: 'account-code',
    },
  },
};

/** Company setting defaults written by pack:apply (only for keys the company has not set). */
export const PACK_SETTING_DEFAULTS: Readonly<Record<string, unknown>> = {
  [SALES_ACCOUNTS_KEY]: { receivable: '1300', revenue: '4200', taxPayable: '2200' },
  [CONTRACT_DEFAULT_PRORATION_KEY]: 'daily',
  [CONTRACT_AUTO_SUBMIT_KEY]: false,
  [TAX_PRICE_INCLUDES_TAX_KEY]: false,
  [REAL_ESTATE_ACCOUNTS_KEY]: REAL_ESTATE_ACCOUNTS_DEFAULT,
};

export function loadRealEstateAccounts(ctx: Context): Promise<RealEstateAccounts> {
  return getSetting(ctx, REAL_ESTATE_ACCOUNTS_KEY, realEstateAccountsSchema, REAL_ESTATE_ACCOUNTS_DEFAULT);
}

/** Cash/bank account code for deposits: real_estate.accounts.bank, else payment.accounts.bank (spec AC-4). */
export async function depositBankCode(ctx: Context): Promise<string> {
  const accounts = await loadRealEstateAccounts(ctx);
  return accounts.bank ?? (await loadPaymentAccountCodes(ctx)).bank;
}
