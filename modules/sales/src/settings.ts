// Company settings owned by the sales module (spec AC-3 `sales.accounts`, AC-5 `sales.issuer`; ADR-0013 L1).
// Keys, zod schemas and defaults are exported so other modules (payment, l10n/jp) read them via kernel getSetting.
import { label, registry, type SettingDef } from '@daifuku/kernel';
import { z } from 'zod';

export const SALES_ACCOUNTS_KEY = 'sales.accounts';
export const SALES_ISSUER_KEY = 'sales.issuer';

/** Account codes (account.code) used when an invoice is posted: Dr receivable / Cr revenue / Cr taxPayable. */
export const salesAccountsSchema = z.object({
  receivable: z.string().min(1).max(20),
  revenue: z.string().min(1).max(20),
  taxPayable: z.string().min(1).max(20),
});
export type SalesAccounts = z.output<typeof salesAccountsSchema>;
export const SALES_ACCOUNTS_DEFAULT: SalesAccounts = { receivable: '1300', revenue: '4000', taxPayable: '2200' };

/** 適格請求書 issuer block (No.6625 記載事項①: 氏名又は名称及び登録番号). Falls back to the company name when unset. */
export const salesIssuerSchema = z.object({
  name: z.string().min(1).max(200),
  invoiceRegistrationNo: z
    .string()
    .regex(/^T\d{13}$/, 'T + 13 digits')
    .optional(),
  postalCode: z.string().max(20).optional(),
  address: z.string().max(400).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(200).optional(),
  bankInfo: z.string().max(400).optional(),
});
export type SalesIssuer = z.output<typeof salesIssuerSchema>;

export const SALES_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: SALES_ACCOUNTS_KEY,
    label: label('売上転記の勘定科目', 'Sales posting accounts'),
    description: label(
      '売上請求書の確定（submit）で仕訳に使う勘定科目',
      'Accounts the journal entry of a submitted sales invoice posts to',
    ),
    schema: salesAccountsSchema,
    default: SALES_ACCOUNTS_DEFAULT,
    order: 20,
    fields: {
      receivable: { label: label('売掛金', 'Accounts receivable'), widget: 'account-code' },
      revenue: { label: label('売上高', 'Revenue'), widget: 'account-code' },
      taxPayable: { label: label('仮受消費税', 'Output tax'), widget: 'account-code' },
    },
  },
  {
    key: SALES_ISSUER_KEY,
    label: label('請求書の発行者', 'Invoice issuer'),
    description: label(
      '適格請求書に印字する名称・登録番号（T+13桁）・住所・連絡先・振込先。未設定なら会社名を印字する',
      'Name, registration number (T + 13 digits), address, contact and bank details printed on invoices. Unset: the company name is printed',
    ),
    schema: salesIssuerSchema,
    order: 10,
    fields: {
      name: { label: label('名称', 'Name') },
      invoiceRegistrationNo: {
        label: label('登録番号', 'Registration number'),
        description: label('T と数字 13 桁（例: T1234567890123）', 'T followed by 13 digits (e.g. T1234567890123)'),
      },
      postalCode: { label: label('郵便番号', 'Postal code') },
      address: { label: label('住所', 'Address'), widget: 'textarea' },
      phone: { label: label('電話番号', 'Phone') },
      email: { label: label('メールアドレス', 'Email') },
      bankInfo: {
        label: label('振込先', 'Bank details'),
        description: label('銀行名・支店・口座種別・口座番号・名義', 'Bank, branch, account type, number and holder'),
        widget: 'textarea',
      },
    },
  },
];

export function registerSalesSettings(): void {
  for (const def of SALES_SETTING_DEFS) registry.registerSetting(def);
}
