// docs/specs/company-admin.md AC-3, AC-9, AC-11: the create form checks the kernel's rules before sending, maps the
// API's issues to its fields, and offers the first-setup destinations after creation.
import { describe, expect, it } from 'vitest';
import { DEDICATED_NAVIGATION } from './navigation-data.ts';
import {
  COMPANY_FIELD_LABEL,
  COMPANY_FIELDS,
  draftErrors,
  EMPTY_DRAFT,
  issuesByField,
  normalizeDraft,
  SETUP_DESTINATIONS,
} from './companies.ts';

describe('company-admin AC-3: create form rules', () => {
  it('AC-3: normalizes the code, country and currency to upper case and trims the name', () => {
    expect(normalizeDraft({ code: ' new-1 ', name: '  新会社 ', country: 'jp', currency: 'jpy' })).toEqual({
      code: 'NEW-1',
      name: '新会社',
      country: 'JP',
      currency: 'JPY',
    });
  });

  it.each([
    ['', 'code'],
    ['A'.repeat(21), 'code'],
    ['SP ACE', 'code'],
    ['日本', 'code'],
  ])('AC-3: code %j is refused', (code, field) => {
    expect(Object.keys(draftErrors({ ...EMPTY_DRAFT, name: 'x', code }))).toEqual([field]);
  });

  it('AC-3: a valid draft has no errors; name, country and currency are checked', () => {
    expect(draftErrors({ code: 'A_1-B', name: '会社', country: 'JP', currency: 'JPY' })).toEqual({});
    expect(Object.keys(draftErrors({ code: 'OK', name: '', country: 'JPN', currency: 'yen' })).sort()).toEqual([
      'country',
      'currency',
      'name',
    ]);
    // The edit dialog checks only its own fields.
    expect(draftErrors({ code: '', name: 'x', country: 'US', currency: '' }, ['name', 'country'])).toEqual({});
  });

  it('AC-3: API issues go to their field; others to the form', () => {
    expect(
      issuesByField([
        { path: 'code', message: 'already used' },
        { path: 'name', message: 'too long' },
        { path: '', message: 'Unrecognized key: "extra"' },
      ]),
    ).toEqual({ fields: { code: 'already used', name: 'too long' }, form: ['Unrecognized key: "extra"'] });
  });
});

describe('company-admin AC-9/AC-11: setup links, labels and navigation', () => {
  it('AC-9: the first-setup destinations are the company profile tab and the fiscal year list', () => {
    expect(SETUP_DESTINATIONS.map((d) => d.href)).toEqual(['/settings?tab=company', '/e/fiscal_year']);
  });

  it('AC-11: every field label and destination has ja and en text', () => {
    for (const field of COMPANY_FIELDS) {
      expect(COMPANY_FIELD_LABEL[field].ja).not.toBe('');
      expect(COMPANY_FIELD_LABEL[field].en).not.toBe('');
    }
    for (const d of SETUP_DESTINATIONS) expect(d.label.ja && d.label.en).toBeTruthy();
  });

  it('AC-9: the screen is a tenant-admin entry of the settings and administration workspace', () => {
    expect(DEDICATED_NAVIGATION.find((n) => n.href === '/admin/companies')).toMatchObject({
      workspace: 'admin',
      condition: 'tenant-admin',
    });
  });
});
