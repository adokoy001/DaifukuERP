// docs/specs/company-admin.md AC-7: the invoice issuer resolution order — `sales.issuer` when set, else the
// kernel's `company.profile` (legal name, else the company name), never mixing the two.
import { COMPANY_PROFILE_KEY } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { resolveIssuer } from '../src/actions/render-invoice-html.ts';
import { SALES_ISSUER_KEY } from '../src/settings.ts';

const profile = {
  legalName: '株式会社大福',
  invoiceRegistrationNo: 'T1234567890123',
  postalCode: '100-0001',
  address: '東京都千代田区1-1',
  phone: '03-0000-0000',
  email: 'billing@example.com',
  taxStatus: 'taxable',
  fiscalYearEndMonth: 3,
  representative: '代表 太郎',
};

describe('company-admin AC-7: issuer resolution', () => {
  it('AC-7: nothing set -> the company name only', () => {
    expect(resolveIssuer({ name: '大福', settings: {} })).toEqual({
      issuer: { name: '大福' },
      source: 'company.profile',
      invalidIssuer: false,
    });
  });

  it('AC-7: sales.issuer unset -> the profile issuer fields (not tax status, year-end or representative)', () => {
    expect(resolveIssuer({ name: '大福', settings: { [COMPANY_PROFILE_KEY]: profile } }).issuer).toEqual({
      name: '株式会社大福',
      invoiceRegistrationNo: 'T1234567890123',
      postalCode: '100-0001',
      address: '東京都千代田区1-1',
      phone: '03-0000-0000',
      email: 'billing@example.com',
    });
  });

  it('AC-7: a profile without a legal name falls back to the company name', () => {
    const { legalName: _omitted, ...rest } = profile;
    expect(resolveIssuer({ name: '大福', settings: { [COMPANY_PROFILE_KEY]: rest } }).issuer.name).toBe('大福');
  });

  it('AC-7: a set sales.issuer wins as a whole block over the profile', () => {
    const resolved = resolveIssuer({
      name: '大福',
      settings: { [COMPANY_PROFILE_KEY]: profile, [SALES_ISSUER_KEY]: { name: '請求名義' } },
    });
    expect(resolved).toEqual({ issuer: { name: '請求名義' }, source: 'sales.issuer', invalidIssuer: false });
  });

  it('AC-7: an invalid stored sales.issuer or profile is ignored', () => {
    expect(
      resolveIssuer({
        name: '大福',
        settings: { [COMPANY_PROFILE_KEY]: profile, [SALES_ISSUER_KEY]: { name: '' } },
      }),
    ).toMatchObject({ source: 'company.profile', invalidIssuer: true, issuer: { name: '株式会社大福' } });
    expect(
      resolveIssuer({ name: '大福', settings: { [COMPANY_PROFILE_KEY]: { invoiceRegistrationNo: 'bad' } } }).issuer,
    ).toEqual({ name: '大福' });
  });
});
