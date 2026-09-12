import { describe, expect, it } from 'vitest';
import { apiBaseUrl } from './base-url.ts';
describe('one artifact across deployment origins', () => {
  it('uses the same production prefix for every hostname while preserving local development', () => {
    expect(apiBaseUrl(undefined, true)).toBe('/api');
    expect(apiBaseUrl('', true)).toBe('/api');
    expect(apiBaseUrl(undefined, false)).toBe('http://localhost:3000');
    expect(apiBaseUrl('http://localhost:3199/', true)).toBe('http://localhost:3199');
    expect(apiBaseUrl('/api/', false)).toBe('/api');
  });
});
