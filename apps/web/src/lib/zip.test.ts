// The STORE zip writer (docs/specs/evidence-search.md AC-17): CRC-32 known values, DOS timestamps, and the archive read
// back by a minimal reader written here (local headers, central directory, end record, UTF-8 flag, the Info-ZIP
// Unicode Path extra field, CRC and sizes).
import { describe, expect, it } from 'vitest';
import { buildZip, crc32, dosDateTime } from './zip.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

interface ReadEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  size: number;
  time: number;
  date: number;
  data: Uint8Array;
  extra: Uint8Array;
  centralExtra: Uint8Array;
}

/** Reads a zip without compression support: end record -> central directory -> local headers. */
function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = bytes.length - 22;
  expect(view.getUint32(endAt, true)).toBe(0x06054b50);
  const count = view.getUint16(endAt + 10, true);
  const centralSize = view.getUint32(endAt + 12, true);
  let at = view.getUint32(endAt + 16, true);
  expect(at + centralSize).toBe(endAt);
  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    expect(view.getUint32(at + 24, true)).toBe(size);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const centralExtra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    at += 46 + nameLength + extraLength + commentLength;
    expect(view.getUint32(localAt, true)).toBe(0x04034b50);
    expect(view.getUint16(localAt + 6, true)).toBe(flags);
    expect(view.getUint32(localAt + 14, true)).toBe(crc);
    expect(view.getUint32(localAt + 18, true)).toBe(size);
    const localName = view.getUint16(localAt + 26, true);
    const localExtra = view.getUint16(localAt + 28, true);
    expect(dec.decode(bytes.subarray(localAt + 30, localAt + 30 + localName))).toBe(name);
    const extra = bytes.subarray(localAt + 30 + localName, localAt + 30 + localName + localExtra);
    const dataAt = localAt + 30 + localName + localExtra;
    out.push({
      name,
      flags,
      method,
      crc,
      size,
      time,
      date,
      data: bytes.subarray(dataAt, dataAt + size),
      extra,
      centralExtra,
    });
  }
  return out;
}

describe('zip writer (AC-17)', () => {
  it('AC-17 CRC-32 matches known values and chains across chunks', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(enc.encode('6789'), crc32(enc.encode('12345')))).toBe(0xcbf43926);
  });

  it('AC-17 DOS timestamps use local time in two-second steps and clamp to 1980..2107', () => {
    const d = new Date(2026, 9, 30, 13, 45, 59);
    expect(dosDateTime(d)).toEqual({ time: (13 << 11) | (45 << 5) | 29, date: ((2026 - 1980) << 9) | (10 << 5) | 30 });
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual({ time: 0, date: (1 << 5) | 1 });
    expect(dosDateTime(new Date(2200, 0, 1))).toEqual({
      time: (23 << 11) | (59 << 5) | 29,
      date: (127 << 9) | (12 << 5) | 31,
    });
    expect(dosDateTime(new Date('invalid'))).toEqual({ time: 0, date: (1 << 5) | 1 });
  });

  it('AC-17 entries are stored with UTF-8 names, the 0x7075 extra field, CRC, sizes and the given time; bytes are intact', async () => {
    const files = [
      { name: '2026-01-15_請求書.pdf', bytes: enc.encode('%PDF-1.7 請求書') },
      { name: 'no-date_receipt.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]) },
      { name: 'empty.txt', bytes: new Uint8Array() },
    ];
    const when = new Date(2026, 0, 15, 9, 30, 10);
    const progress: number[] = [];
    const zip = await buildZip(
      files.map((f) => ({ name: f.name, data: new Blob([f.bytes]), date: when })),
      (done) => progress.push(done),
    );
    expect(zip.type).toBe('application/zip');
    expect(progress).toEqual([1, 2, 3]);
    const entries = readZip(new Uint8Array(await zip.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, e] of entries.entries()) {
      const f = files[i] as (typeof files)[number];
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(e.method).toBe(0);
      expect(e.size).toBe(f.bytes.length);
      expect(e.crc).toBe(crc32(f.bytes));
      expect([...e.data]).toEqual([...f.bytes]);
      expect(dosDateTime(when)).toEqual({ time: e.time, date: e.date });
      for (const extra of [e.extra, e.centralExtra]) {
        const v = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
        const nameBytes = enc.encode(f.name);
        expect(v.getUint16(0, true)).toBe(0x7075);
        expect(v.getUint16(2, true)).toBe(5 + nameBytes.length);
        expect(v.getUint8(4)).toBe(1);
        expect(v.getUint32(5, true)).toBe(crc32(nameBytes));
        expect(dec.decode(extra.subarray(9))).toBe(f.name);
      }
    }
  });

  it('AC-17 an empty archive is just the end record', async () => {
    const zip = await buildZip([]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(bytes.length).toBe(22);
    expect(readZip(bytes)).toEqual([]);
  });
});
