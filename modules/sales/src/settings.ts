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
      '科目コード: receivable=売掛金, revenue=売上高, taxPayable=仮受消費税',
      'Account codes: receivable, revenue, taxPayable (output tax)',
    ),
    schema: salesAccountsSchema,
  },
  {
    key: SALES_ISSUER_KEY,
    label: label('請求書の発行者', 'Invoice issuer'),
    description: label(
      '適格請求書に印字する名称・登録番号（T+13桁）・住所・連絡先・振込先',
      'Name, registration number (T + 13 digits), address, contact and bank details printed on invoices',
    ),
    schema: salesIssuerSchema,
  },
];

export function registerSalesSettings(): void {
  for (const def of SALES_SETTING_DEFS) registry.registerSetting(def);
}
