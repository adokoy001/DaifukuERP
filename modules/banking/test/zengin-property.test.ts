import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BankIdentity, BankTransferSnapshot } from '../src/contract.ts';
import { exportBankFile } from '../src/zengin.ts';

// Independent byte reader: protocol offsets, not the writer's text/encoding helpers.
const ascii = (bytes: number[], start: number, size: number) =>
  String.fromCharCode(...bytes.slice(start, start + size));
const numberAt = (bytes: number[], start: number, size: number) => {
  const value = ascii(bytes, start, size);
  expect(value).toMatch(/^[0-9]+$/u);
  return BigInt(value);
};
const kanaBytes = new Map([
  ['ｶ', 0xb6],
  ['ﾃ', 0xc3],
  ['ｽ', 0xbd],
  ['ﾄ', 0xc4],
  ['ﾞ', 0xde],
  ['ﾟ', 0xdf],
]);
const name = fc
  .array(fc.constantFrom('A', 'Z', '0', '9', ' ', '(', ')', '-', ...kanaBytes.keys()), { minLength: 1, maxLength: 30 })
  .map((v) => v.join(''));
const digits = (length: number) =>
  fc.integer({ min: 0, max: 10 ** length - 1 }).map((v) => String(v).padStart(length, '0'));
const identity: fc.Arbitrary<BankIdentity> = fc.record({
  bankCode: digits(4),
  branchCode: digits(3),
  accountType: fc.constantFrom('ordinary', 'current'),
  accountNumber: digits(7),
  holderKana: name,
});
const row = fc.record({ payee: identity, amount: fc.bigInt({ min: 1n, max: 9_999_999_999n }).map(String) });
function snapshot(account: BankIdentity, rows: { payee: BankIdentity; amount: string }[]): BankTransferSnapshot {
  return {
    account: { ...account, name: 'synthetic', ledgerAccountId: 'ledger', requesterCode: '0123456789' },
    lines: rows.map((value, i) => ({
      ...value,
      invoiceId: `invoice-${i}`,
      invoiceVersion: 1,
      number: `PINV-${i}`,
      partnerId: 'partner',
      partnerName: 'synthetic',
      payeeId: `payee-${i}`,
      payeeVersion: 1,
    })),
  };
}
function readRecords(bytes: number[], count: number, crlf: boolean) {
  const width = crlf ? 122 : 120;
  expect(bytes).toHaveLength((count + 3) * width);
  return Array.from({ length: count + 3 }, (_, i) => {
    if (crlf) expect(bytes.slice(i * width + 120, i * width + 122)).toEqual([13, 10]);
    const record = bytes.slice(i * width, i * width + 120);
    expect(record).not.toContain(13);
    expect(record).not.toContain(10);
    return record;
  });
}
function assertIdentity(record: number[], value: BankIdentity, header = false) {
  expect(numberAt(record, header ? 58 : 1, 4)).toBe(BigInt(value.bankCode));
  expect(numberAt(record, header ? 77 : 20, 3)).toBe(BigInt(value.branchCode));
  expect(ascii(record, header ? 95 : 42, 1)).toBe(value.accountType === 'ordinary' ? '1' : '2');
  expect(numberAt(record, header ? 96 : 43, 7)).toBe(BigInt(value.accountNumber));
  const encoded = Array.from(value.holderKana, (c) => kanaBytes.get(c) ?? c.charCodeAt(0));
  const size = header ? 40 : 30;
  expect(record.slice(header ? 14 : 50, (header ? 14 : 50) + size)).toEqual([
    ...encoded,
    ...Array<number>(size - encoded.length).fill(32),
  ]);
}
const parameters = {
  seed: Number(process.env['PBT_SEED'] ?? 730303),
  numRuns: Number(process.env['PBT_RUNS'] ?? 100),
  ...(process.env['PBT_PATH'] ? { path: process.env['PBT_PATH'] } : {}),
};
describe('AC-3 / BANK-BYTES-01 independent Zengin reader', () => {
  it('reads every field, count and BigInt total from both record endings without a writer round trip', () => {
    fc.assert(
      fc.property(
        identity,
        fc.array(row, { minLength: 1, maxLength: 80 }),
        fc.integer({ min: 1, max: 28 }),
        (account, rows, day) => {
          const source = snapshot(account, rows);
          const date = `2026-09-${String(day).padStart(2, '0')}`;
          const none = exportBankFile(source, date, 'zengin120', 'none');
          const crlf = exportBankFile(source, date, 'zengin120', 'crlf');
          const records = readRecords(none.bytes, rows.length, false);
          expect(readRecords(crlf.bytes, rows.length, true)).toEqual(records);
          const header = required(records[0]);
          expect(ascii(header, 0, 14)).toBe('12100123456789');
          expect(ascii(header, 54, 4)).toBe(`09${String(day).padStart(2, '0')}`);
          assertIdentity(header, account, true);
          rows.forEach((value, i) => {
            const detail = required(records[i + 1]);
            expect(detail[0]).toBe(50);
            assertIdentity(detail, value.payee);
            expect(numberAt(detail, 80, 10)).toBe(BigInt(value.amount));
            expect(ascii(detail, 90, 22)).toBe('0000000000000000000007');
          });
          const trailer = required(records[rows.length + 1]);
          expect(trailer[0]).toBe(56);
          expect(numberAt(trailer, 1, 6)).toBe(BigInt(rows.length));
          expect(numberAt(trailer, 7, 12)).toBe(rows.reduce((sum, value) => sum + BigInt(value.amount), 0n));
          expect(records.at(-1)).toEqual([57, ...Array<number>(119).fill(32)]);
        },
      ),
      parameters,
    );
  });
  it('checks the 500-record boundary in bytes and refuses 501 records', () => {
    fc.assert(
      fc.property(identity, fc.integer({ min: 1, max: 999_999_999 }), (account, amount) => {
        const value = { payee: account, amount: String(amount) };
        const source = snapshot(
          account,
          Array.from({ length: 500 }, () => value),
        );
        const file = exportBankFile(source, '2026-09-12', 'zengin120', 'crlf');
        const records = readRecords(file.bytes, 500, true);
        const trailer = required(records[501]);
        expect(numberAt(trailer, 1, 6)).toBe(500n);
        expect(numberAt(trailer, 7, 12)).toBe(BigInt(amount) * 500n);
        expect(() =>
          exportBankFile(
            snapshot(
              account,
              Array.from({ length: 501 }, () => value),
            ),
            '2026-09-12',
            'zengin120',
            'none',
          ),
        ).toThrow();
      }),
      { ...parameters, numRuns: 10 },
    );
  });
  it('rejects generated oversized numeric fields and unsupported characters instead of truncating', () => {
    fc.assert(
      fc.property(identity, row, fc.constantFrom('漢', 'ｧ', 'a', '\n', '&'), (account, value, bad) => {
        const source = snapshot(account, [value]);
        expect(() =>
          exportBankFile(
            snapshot(account, [{ ...value, amount: String(BigInt(value.amount) + 10_000_000_000n) }]),
            '2026-09-12',
            'zengin120',
            'none',
          ),
        ).toThrow();
        expect(() =>
          exportBankFile(
            { ...source, account: { ...source.account, holderKana: `${account.holderKana}${bad}` } },
            '2026-09-12',
            'zengin120',
            'crlf',
          ),
        ).toThrow();
      }),
      parameters,
    );
  });
});
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing record');
  return value;
}
