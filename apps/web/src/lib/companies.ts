// Pure helpers of /admin/companies (docs/specs/company-admin.md AC-3, AC-9, AC-11): the same code / country / currency
// rules the kernel enforces (createCompanySchema), checked before sending so the form can point at the field, and the
// first-setup destinations offered after a company is created.
import type { Label } from '../api/types.ts';

export const COMPANY_CODE = /^[A-Z0-9_-]{1,20}$/;
const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

export interface CompanyDraft {
  code: string;
  name: string;
  country: string;
  currency: string;
}
export type CompanyField = keyof CompanyDraft;
export const COMPANY_FIELDS: readonly CompanyField[] = ['code', 'name', 'country', 'currency'];

export const EMPTY_DRAFT: CompanyDraft = { code: '', name: '', country: 'JP', currency: 'JPY' };

export const COMPANY_FIELD_LABEL: Record<CompanyField, Label> = {
  code: { ja: '会社コード', en: 'Company code' },
  name: { ja: '会社名', en: 'Company name' },
  country: { ja: '国（ISO 2 文字）', en: 'Country (ISO 2 letters)' },
  currency: { ja: '通貨（ISO 3 文字）', en: 'Currency (ISO 3 letters)' },
};

const MESSAGES: Record<CompanyField, Label> = {
  code: { ja: '英大文字・数字・_・- で 1〜20 文字にしてください', en: 'Use 1–20 of A–Z, 0–9, _ and -' },
  name: { ja: '会社名を入力してください', en: 'Enter the company name' },
  country: { ja: '国は英大文字 2 文字（例: JP）です', en: 'Country is 2 capital letters (e.g. JP)' },
  currency: { ja: '通貨は英大文字 3 文字（例: JPY）です', en: 'Currency is 3 capital letters (e.g. JPY)' },
};

/** Trims every field and upper-cases the code, country and currency (the API stores them upper-case). */
export function normalizeDraft(draft: CompanyDraft): CompanyDraft {
  return {
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
    country: draft.country.trim().toUpperCase(),
    currency: draft.currency.trim().toUpperCase(),
  };
}

/** Field errors of a normalized draft; `fields` limits the check (the edit dialog has only name and country). */
export function draftErrors(
  draft: CompanyDraft,
  fields: readonly CompanyField[] = COMPANY_FIELDS,
): Partial<Record<CompanyField, Label>> {
  const errors: Partial<Record<CompanyField, Label>> = {};
  const ok: Record<CompanyField, boolean> = {
    code: COMPANY_CODE.test(draft.code),
    name: draft.name.length > 0 && draft.name.length <= 200,
    country: COUNTRY.test(draft.country),
    currency: CURRENCY.test(draft.currency),
  };
  for (const field of fields) if (!ok[field]) errors[field] = MESSAGES[field];
  return errors;
}

/** The API's validation issues by form field; an issue on another path (or none) goes to the form-level list. */
export function issuesByField(issues: readonly { path: string; message: string }[]): {
  fields: Partial<Record<CompanyField, string>>;
  form: string[];
} {
  const fields: Partial<Record<CompanyField, string>> = {};
  const form: string[] = [];
  for (const issue of issues) {
    const head = issue.path.split('.')[0] as CompanyField;
    if ((COMPANY_FIELDS as readonly string[]).includes(head))
      fields[head] = fields[head] ? `${fields[head]}; ${issue.message}` : issue.message;
    else form.push(issue.path ? `${issue.path}: ${issue.message}` : issue.message);
  }
  return { fields, form };
}

/**
 * Where a new company's first setup continues (AC-9), opened after switching to it. The setup wizard (B4,
 * docs/specs/setup-wizard.md) will replace these with /setup; until then they open the company tab of the settings
 * console and the fiscal year list.
 */
export const SETUP_DESTINATIONS: readonly { href: string; label: Label }[] = [
  { href: '/settings?tab=company', label: { ja: '会社プロフィールを入力', en: 'Fill in the company profile' } },
  { href: '/e/fiscal_year', label: { ja: '会計年度を確認', en: 'Check the fiscal year' } },
];
