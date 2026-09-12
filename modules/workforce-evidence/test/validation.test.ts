import { describe, expect, it } from 'vitest';
import { MAX_RECEIPT_BYTES, validateReceipt } from '../src/validation.ts';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const input = { data: png, filename: '領収書.png', contentType: 'image/png', expectedVersion: 1 };
describe('private receipt file boundary', () => {
  it('keeps a Japanese basename and accepts matching PNG, JPEG and PDF headers', () => {
    expect(validateReceipt({ ...input, filename: '../camera/領収書.png' }).filename).toBe('領収書.png');
    expect(validateReceipt({ ...input, contentType: 'image/jpeg', data: new Uint8Array([255, 216, 255, 0]) }).contentType).toBe('image/jpeg');
    expect(validateReceipt({ ...input, contentType: 'application/pdf', data: new TextEncoder().encode('%PDF-1.7') }).contentType).toBe('application/pdf');
  });
  it('rejects a claimed image carrying active content and an unsupported SVG', () => {
    expect(() => validateReceipt({ ...input, data: new TextEncoder().encode('<script>alert(1)</script>') })).toThrow();
    expect(() => validateReceipt({ ...input, contentType: 'image/svg+xml' })).toThrow();
    expect(() => validateReceipt({ ...input, contentType: 'application/pdf' })).toThrow();
  });
  it('rejects empty, oversized and control-character filenames before storage', () => {
    expect(() => validateReceipt({ ...input, data: new Uint8Array() })).toThrow();
    const large = new Uint8Array(MAX_RECEIPT_BYTES + 1); large.set(png);
    expect(() => validateReceipt({ ...input, data: large })).toThrow('10 MB');
    expect(() => validateReceipt({ ...input, filename: 'a\r\n.png' })).toThrow('control');
  });
  it('requires a safe current positive integer expense version', () => {
    for (const expectedVersion of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) expect(() => validateReceipt({ ...input, expectedVersion })).toThrow();
  });
});
