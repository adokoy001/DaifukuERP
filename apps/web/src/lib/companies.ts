// Pure helpers of /admin/companies (docs/specs/company-admin.md AC-3, AC-9, AC-11): the same code / country / currency
// rules the kernel enforces (createCompanySchema), checked before sending so the form can point at the field, and the
// first-setup destinations offered after a company is created.
import type { Label } from '../api/types.ts';

export const COMPANY_CODE = /^[A-Z0-9_-]{1,20}$/;
const COUNTRY = /^[A-Z]{2}$/;
/**
 * The kernel's SUPPORTED_COMPANY_CURRENCIES: posting refuses a company whose currency is not JPY and the currency is
 * immutable, so the form offers JPY only (read-only field) until multi-currency business exists.
 */
export const SUPPORTED_CURRENCIES: readonly string[] = ['JPY'];

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
  currency: { ja: '通貨は現在 JPY だけを選べます', en: 'Only JPY is available for now' },
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
    currency: SUPPORTED_CURRENCIES.includes(draft.currency),
  };
  for (const field of fields) if (!ok[field]) errors[field] = MESSAGES[field];
  return errors;
}

/** Localized text of the API issues the form can meet (kernel/src/company-admin.ts); other messages stay as sent. */
const KNOWN_ISSUES: Partial<Record<CompanyField, Record<string, Label>>> = {
  code: {
    'already used': {
      ja: 'このコードはテナント内の別の会社で使われています',
      en: 'This code is already used by another company of the tenant',
    },
  },
};
const IMMUTABLE_ISSUE: Label = { ja: '作成後は変更できません', en: 'It cannot be changed after creation' };

/**
 * The API's validation issues by form field, localized where the message is known (`t` picks the language); an issue
 * on another path (or none) goes to the form-level list.
 */
export function issuesByField(
  issues: readonly { path: string; message: string }[],
  t: (label: Label) => string,
): {
  fields: Partial<Record<CompanyField, string>>;
  form: string[];
} {
  const fields: Partial<Record<CompanyField, string>> = {};
  const form: string[] = [];
  for (const issue of issues) {
    const head = issue.path.split('.')[0] as CompanyField;
    if ((COMPANY_FIELDS as readonly string[]).includes(head)) {
      const known =
        KNOWN_ISSUES[head]?.[issue.message] ??
        (issue.message === 'immutable after creation' ? IMMUTABLE_ISSUE : undefined);
      const message = known ? t(known) : issue.message;
      fields[head] = fields[head] ? `${fields[head]}; ${message}` : message;
    } else form.push(issue.path ? `${issue.path}: ${issue.message}` : issue.message);
  }
  return { fields, form };
}

/** The first field with an error, in form order (the field focus moves to). */
export function firstErrorField(errors: Partial<Record<CompanyField, unknown>>): CompanyField | undefined {
  return COMPANY_FIELDS.find((field) => errors[field] !== undefined);
}

/**
 * Where a new company's first setup continues (AC-9), opened after switching to it: the setup wizard
 * (docs/specs/setup-wizard.md AC-27), whose first steps are the company profile and the fiscal year.
 */
export const SETUP_DESTINATIONS: readonly { href: string; label: Label; switchLabel: Label }[] = [
  {
    href: '/setup',
    label: { ja: 'セットアップを始める', en: 'Start the setup' },
    switchLabel: { ja: '切り替えてセットアップを始める', en: 'Switch and start the setup' },
  },
];
