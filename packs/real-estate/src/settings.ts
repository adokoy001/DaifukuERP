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

export const REAL_ESTATE_ACCOUNTS_DEFAULT: RealEstateAccounts = { deposit: '2500', rentRevenue: '4200', bank: '1100', deduction: '4100' };

export const REAL_ESTATE_ACCOUNTS_SETTING: SettingDef<RealEstateAccounts> = {
  key: REAL_ESTATE_ACCOUNTS_KEY,
  label: label('賃貸管理の勘定科目', 'Rental accounts'),
  description: label(
    '科目コード: deposit=預り金（敷金）, rentRevenue=賃貸料収入（参考。転記先は sales.accounts.revenue）, bank=敷金の入出金口座（省略時 payment.accounts.bank）, deduction=敷金から控除した原状回復費の計上先',
    'Account codes: deposit (security deposits held), rentRevenue (informational; invoices post to sales.accounts.revenue), bank (deposit receipts/returns; defaults to payment.accounts.bank), deduction (amount kept from a returned deposit)',
  ),
  schema: realEstateAccountsSchema,
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
