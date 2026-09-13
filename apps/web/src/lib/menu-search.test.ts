import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { parseDirectorySearch } from './menu-search.ts';

describe('directory search URL boundaries', () => {
  it('preserves the five supported screen types and Japanese search text', () => {
    for (const kind of ['workspace', 'record', 'report', 'action', 'setting']) {
      expect(parseDirectorySearch({ q: '給与 サポート', kind, page: '2' })).toEqual({ q: '給与 サポート', kind, page: 2 });
    }
  });
  it('omits defaults and unknown state rather than forwarding company or route parameters', () => {
    expect(parseDirectorySearch({})).toEqual({});
    expect(parseDirectorySearch({ q: '', page: 1, kind: '', companyId: 'other-company', workspace: 'finance', redirect: '//example.com', token: 'ignore-me' })).toEqual({});
    expect(parseDirectorySearch({ q: undefined, kind: undefined, page: undefined })).toEqual({});
  });
  it('accepts whole-number page boundaries from router numbers and ordinary URL strings', () => {
    for (const page of [2, '2', '00002', 9999, '9999', 10000, '10000']) {
      expect(parseDirectorySearch({ page }).page).toBe(Number(page));
    }
  });
  it('rejects nonpositive, fractional, oversized and ambiguous pagination inputs', () => {
    for (const page of [0, '0', -1, '-1', 1, '1', 10001, '10001', 2.5, '2.5', '2e1', '0x10', '+2', ' 2 ', '000002', '2x', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, true, null, [], {}]) {
      expect(parseDirectorySearch({ page }), String(page)).toEqual({});
    }
  });
  it('does not coerce arrays, objects or scalar nonstrings into search text or screen types', () => {
    for (const value of [undefined, null, 42, true, ['record'], { value: 'record' }]) {
      expect(parseDirectorySearch({ q: value, kind: value })).toEqual({});
    }
    for (const kind of ['Record', 'records', ' report', 'report ', '__proto__', 'toString']) expect(parseDirectorySearch({ kind })).toEqual({});
  });
  it('bounds long text and does not mutate the caller state', () => {
    const raw = Object.freeze({ q: '給'.repeat(150), kind: 'report', page: '10000', unrelated: 'retain-on-input-only' });
    expect(parseDirectorySearch(raw)).toEqual({ q: '給'.repeat(120), kind: 'report', page: 10000 });
    expect(raw.q).toHaveLength(150);
    expect(raw.page).toBe('10000');
    expect(raw.unrelated).toBe('retain-on-input-only');
  });
});

describe('directory state through the actual router URL codec', () => {
  it('roundtrips Japanese, reserved characters, JSON-looking terms and screen pagination', () => {
    for (const q of ['給与 サポート', 'ｼﾌﾄ　ＰＡＹＲＯＬＬ', 'A&B + #? / % "quoted"', '{"kind":"record"}', 'false', '42', '😀 勤怠']) {
      const state = parseDirectorySearch({ q, kind: 'record', page: 7 });
      expect(parseDirectorySearch(defaultParseSearch(defaultStringifySearch(state)))).toEqual(state);
    }
  });
  it('restores a bookmarked page and removes invalid or obsolete state on canonical serialization', () => {
    const bookmarked = defaultParseSearch('?q=%E8%A9%A6%E7%AE%97%E8%A1%A8&kind=report&page=2&companyId=other');
    const state = parseDirectorySearch(bookmarked);
    expect(state).toEqual({ q: '試算表', kind: 'report', page: 2 });
    const canonical = defaultStringifySearch(state);
    expect(canonical).not.toContain('companyId');
    expect(parseDirectorySearch(defaultParseSearch(canonical))).toEqual(state);
    expect(defaultStringifySearch(parseDirectorySearch({ ...state, q: undefined, kind: undefined, page: undefined }))).toBe('');
  });
  it('ignores repeated keys that the router decodes as arrays', () => {
    expect(parseDirectorySearch(defaultParseSearch('?q=first&q=second&kind=record&kind=report&page=2&page=3'))).toEqual({});
  });
  it('keeps text valid for URL serialization when the limit meets an emoji surrogate pair', () => {
    const state = parseDirectorySearch({ q: `${'x'.repeat(119)}😀 extra`, kind: 'record' });
    expect(state.q).toBe(`${'x'.repeat(119)}😀`);
    expect(() => defaultStringifySearch(state)).not.toThrow();
    expect(parseDirectorySearch(defaultParseSearch(defaultStringifySearch(state)))).toEqual(state);
    const emoji = parseDirectorySearch({ q: '😀'.repeat(150) });
    expect(emoji.q).toBe('😀'.repeat(120));
    expect(parseDirectorySearch(defaultParseSearch(defaultStringifySearch(emoji)))).toEqual(emoji);
    const malformed = parseDirectorySearch({ q: 'before\uD800after\uDC00' });
    expect(malformed.q).toBe('before\uFFFDafter\uFFFD');
    expect(parseDirectorySearch(defaultParseSearch(defaultStringifySearch(malformed)))).toEqual(malformed);
  });
});
