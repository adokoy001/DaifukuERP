import { describe, expect, it } from 'vitest';
import { financeFileBlob, MAX_FINANCE_CSV_BYTES, readFinanceCsv } from './finance-file.ts';

describe('financial file boundaries', () => {
  it('preserves quoted Japanese CSV and CRLF, removing only the UTF-8 BOM', async () => {
    const text = 'externalId,date,description\r\nA,2026-09-01,"売上,店舗"\r\n';
    expect(await readFinanceCsv(new Blob(['\ufeff' + text]))).toBe(text);
  });
  it('rejects invalid UTF-8 instead of replacing a payee name', async () => {
    await expect(readFinanceCsv(new Blob([new Uint8Array([0x82, 0xa0, 0x0a])]))).rejects.toThrow('UTF-8');
  });
  it('refuses oversized, empty, NUL-bearing, and changed files', async () => {
    for (const file of [new Blob([]), new Blob(['\0']), new Blob([' '.repeat(MAX_FINANCE_CSV_BYTES + 1)]), { size: 2, arrayBuffer: async () => new ArrayBuffer(3) }]) await expect(readFinanceCsv(file)).rejects.toThrow();
  });
  it('downloads the exact non-UTF-8 bytes supplied by the server', async () => {
    const blob = financeFileBlob('gqCxDQo=', 'application/octet-stream');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x82, 0xa0, 0xb1, 13, 10]);
  });
  it('rejects malformed base64 and oversized file responses', () => {
    for (const content of ['%%%%', 'ab=c', 'YQ=', 'YQ==\n', 'a'.repeat(16_777_217)]) expect(() => financeFileBlob(content, 'text/plain')).toThrow();
  });
});
