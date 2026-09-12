import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { canRetainData } from './read-recovery.ts';
const error = (status: number) => new ApiError(status, { code: 'INTERNAL', message: 'Synthetic failed read', hint: 'Retry' });
describe('retaining an authorized snapshot after a failed background read', () => {
  it('preserves data only for network and server failures after a successful load', () => {
    for (const status of [0, 500, 503, 599]) expect(canRetainData({ data: { id: 'same-scope' }, isError: true, error: error(status) })).toBe(true);
    for (const data of [undefined, null]) expect(canRetainData({ data, isError: true, error: error(503) })).toBe(false);
  });
  it('fails closed for revoked access, missing records and all other client errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) expect(canRetainData({ data: { private: 'old' }, isError: true, error: error(status) })).toBe(false);
  });
  it('does not treat unknown failures or a successful refresh as a recoverable error', () => {
    expect(canRetainData({ data: {}, isError: true, error: new Error('Unknown local failure') })).toBe(false);
    expect(canRetainData({ data: {}, isError: false, error: null })).toBe(false);
  });
});
