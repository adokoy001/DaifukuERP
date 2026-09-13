import { describe, expect, it } from 'vitest';
import { edgeExpiry, edgePrintRequest, edgeRecentResponse } from './edge.ts';
describe('device operation preparation', () => {
  it('preserves Japanese output but rejects missing text and excessive copies', () => {
    const data = new FormData();
    data.set('title', '店舗案内');
    data.set('text', 'ご来店ありがとうございます。');
    data.set('copies', '2');
    expect(edgePrintRequest(data)).toEqual({
      kind: 'print.text',
      payload: { title: '店舗案内', text: 'ご来店ありがとうございます。', copies: 2 },
    });
    data.set('copies', '100');
    expect(() => edgePrintRequest(data)).toThrow();
    data.set('copies', '1');
    data.delete('text');
    expect(() => edgePrintRequest(data)).toThrow();
  });
  it('uses the server clock for bounded start deadlines', () => {
    expect(edgeExpiry('2026-09-12T10:00:00+09:00', 15)).toBe('2026-09-12T01:15:00.000Z');
    for (const minutes of [0, 61, 1.5, NaN]) expect(() => edgeExpiry('2026-09-12T01:00:00Z', minutes)).toThrow();
    expect(() => edgeExpiry('invalid', 15)).toThrow();
  });
  it('does not report missing, stale or future presence as a live response', () => {
    const now = '2026-09-12T01:00:00Z';
    expect(edgeRecentResponse('2026-09-12T00:58:30Z', now)).toBe(true);
    for (const timestamp of [null, 'invalid', '2026-09-12T00:58:29Z', '2026-09-12T01:00:01Z'])
      expect(edgeRecentResponse(timestamp, now)).toBe(false);
  });
});
