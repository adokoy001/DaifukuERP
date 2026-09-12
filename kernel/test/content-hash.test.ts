import { expect, it } from 'vitest';
import { contentHash, contentHashBytes } from '../src/content-hash.ts';
it('uses SHA-256 with explicit UTF-8 for text and exact bytes for encoded exports', () => {
  expect(contentHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(contentHashBytes(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(contentHash('銀行')).toBe(contentHashBytes(new TextEncoder().encode('銀行')));
  const bytes = new Uint8Array([0, 0x82, 0xa0, 255]);
  expect(contentHashBytes(bytes.subarray(1, 3))).not.toBe(contentHashBytes(bytes));
  expect(contentHashBytes(bytes.subarray(1, 3))).not.toBe(contentHash('あ'));
});
