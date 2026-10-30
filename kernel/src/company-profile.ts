// The kernel-owned company setting `company.profile` (docs/specs/company-admin.md AC-6, ADR-0027 §6): the company's
// legal name, address, contact, qualified-invoice registration number, taxable/exempt status, fiscal year-end month and
// representative, kept in companies.settings like every other setting (no new columns). Modules read it through
// getCompanyProfile / companyProfileOf; sales builds the invoice issuer from it when `sales.issuer` is unset.
import { z } from 'zod';
import type { Context } from './context.ts';
import { label } from './i18n.ts';
import { registry, type SettingDef } from './registry.ts';
import { getCompany } from './settings.ts';

export const COMPANY_PROFILE_KEY = 'company.profile';

/** 適格請求書発行事業者の登録番号: T + 13 digits (国税庁 タックスアンサー No.6625; docs/domain/japan-tax.md). */
export const INVOICE_REGISTRATION_NO = /^T\d{13}$/;

export const companyProfileSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    postalCode: z.string().trim().max(20).optional(),
    address: z.string().max(400).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.email().max(200).optional(),
    invoiceRegistrationNo: z.string().regex(INVOICE_REGISTRATION_NO, 'T + 13 digits').optional(),
    taxStatus: z.enum(['taxable', 'exempt']).optional(),
    fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
    representative: z.string().trim().max(200).optional(),
  })
  .superRefine((value, issues) => {
    // Only a registered (therefore taxable) business has a registration number.
    if (value.taxStatus === 'exempt' && value.invoiceRegistrationNo !== undefined)
      issues.addIssue({
        code: 'custom',
        path: ['invoiceRegistrationNo'],
        message: 'An exempt business has no qualified-invoice registration number',
      });
  });
export type CompanyProfile = z.output<typeof companyProfileSchema>;

export const COMPANY_PROFILE_SETTING: SettingDef<CompanyProfile> = {
  key: COMPANY_PROFILE_KEY,
  label: label('会社プロフィール', 'Company profile'),
  description: label(
    '正式名称・所在地・連絡先・登録番号など会社の基本情報。請求書の発行者（販売タブ）が未設定のときはここから印字する',
    'Legal name, address, contact details, registration number and other basics of the company. Invoices print these when the invoice issuer (Sales tab) is not set',
  ),
  schema: companyProfileSchema,
  category: 'company',
  order: 0,
  fields: {
    legalName: {
      label: label('正式名称', 'Legal name'),
      description: label('空欄なら会社名を使う', 'Leave empty to use the company name'),
    },
    postalCode: { label: label('郵便番号', 'Postal code') },
    address: { label: label('住所', 'Address'), widget: 'textarea' },
    phone: { label: label('電話番号', 'Phone') },
    email: { label: label('メールアドレス', 'Email') },
    invoiceRegistrationNo: {
      label: label('登録番号（適格請求書）', 'Registration number (qualified invoice)'),
      description: label('T と数字 13 桁（例: T1234567890123）', 'T followed by 13 digits (e.g. T1234567890123)'),
    },
    taxStatus: {
      label: label('消費税の課税区分', 'Consumption tax status'),
      valueLabels: {
        taxable: label('課税事業者', 'Taxable business'),
        exempt: label('免税事業者', 'Exempt business'),
      },
    },
    fiscalYearEndMonth: {
      label: label('決算月', 'Fiscal year-end month'),
      description: label('1〜12（3 月決算なら 3）', '1 to 12 (3 for a March year-end)'),
    },
    representative: { label: label('代表者名', 'Representative') },
  },
};

/** Declares `company.profile` once (idempotent; also after registry.reset in tests). apps/runtime calls it. */
export function ensureCompanyProfileSetting(): void {
  if (!registry.hasSetting(COMPANY_PROFILE_KEY)) registry.registerSetting(COMPANY_PROFILE_SETTING);
}

/** The profile in raw company settings; unset or invalid reads as an empty profile (every field optional). */
export function companyProfileOf(settings: Readonly<Record<string, unknown>>): CompanyProfile {
  const raw = settings[COMPANY_PROFILE_KEY];
  if (raw === undefined) return {};
  const parsed = companyProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** The context's company profile ({} when unset or invalid). */
export async function getCompanyProfile(ctx: Context): Promise<CompanyProfile> {
  const company = await getCompany(ctx);
  const raw = company.settings[COMPANY_PROFILE_KEY];
  if (raw !== undefined && !companyProfileSchema.safeParse(raw).success)
    ctx.log.warn('invalid company setting, using an empty profile', { key: COMPANY_PROFILE_KEY });
  return companyProfileOf(company.settings);
}
