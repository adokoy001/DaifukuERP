import { describe, expect, it } from 'vitest';
import { currencyOf, currencyScale, NO_CURRENCY_SCALE } from './currency.ts';

describe('currencyScale (web-phase15 AC-4)', () => {
  it('ISO 4217 minor units: JPY 0, common currencies 2, KWD 3', () => {
    expect(currencyScale('JPY')).toBe(0);
    expect(currencyScale('jpy ')).toBe(0);
    expect(currencyScale('USD')).toBe(2);
    expect(currencyScale('EUR')).toBe(2);
    expect(currencyScale('KWD')).toBe(3);
  });
  // web-polish fell back to JPY for everything; AC-4 removes the hard-coded company currency.
  it('no currency (no company / not loaded) pads nothing; an unknown code gets the ISO default 2 like the kernel', () => {
    expect(NO_CURRENCY_SCALE).toBe(0);
    expect(currencyScale(undefined)).toBe(0);
    expect(currencyScale(null)).toBe(0);
    expect(currencyScale('')).toBe(0);
    expect(currencyScale('XYZ')).toBe(2);
  });
});

describe('currencyOf (GET /auth/me reader)', () => {
  it('reads company.currency of the kernel-phase15 response', () => {
    const me = {
      user: { id: 'u' },
      companyId: 'c',
      company: { id: 'c', name: 'デモ株式会社', currency: 'JPY' },
      actor: { type: 'user', id: 'u' },
      locale: 'ja',
    };
    expect(currencyOf(me)).toBe('JPY');
    expect(currencyOf({ company: { id: 'c', name: 'x', currency: 'EUR' } })).toBe('EUR');
  });
  it('no company, no currency or not an object -> undefined; a top-level currency is tolerated', () => {
    expect(currencyOf({ user: { id: 'u' }, companyId: null, company: null, locale: 'ja' })).toBeUndefined();
    expect(currencyOf({ company: { id: 'c' } })).toBeUndefined();
    expect(currencyOf({ currency: '' })).toBeUndefined();
    expect(currencyOf(null)).toBeUndefined();
    expect(currencyOf('JPY')).toBeUndefined();
    expect(currencyOf({ currency: 'USD' })).toBe('USD');
  });
});
