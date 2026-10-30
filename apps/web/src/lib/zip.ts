// A minimal ZIP writer for the evidence bulk download (docs/specs/evidence-search.md AC-17, decision 3): STORE method
// (no compression; evidence is mostly PDF/JPEG/PNG, already compressed), UTF-8 names (general purpose bit 11) plus the
// Info-ZIP Unicode Path extra field (0x7075) for unzip tools that ignore bit 11, and a DOS timestamp per entry. The
// result is a Blob assembled from small headers and the fetched Blobs themselves, so the files are not copied into one
// big buffer; each file is read once to compute its CRC-32. No ZIP64: the caller caps a zip at 50 files and 100 MB.

/** CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320) table. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes`, continuing from a previous `crc` (pass the returned value back to chain chunks). */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Earliest and latest instants a DOS timestamp can hold (local time; seconds are stored in steps of two). */
const DOS_MIN = { year: 1980, month: 1, day: 1, hours: 0, minutes: 0, seconds: 0 };
const DOS_MAX = { year: 2107, month: 12, day: 31, hours: 23, minutes: 59, seconds: 58 };

/** DOS date/time words of `date` in the local time zone, clamped to 1980-01-01 .. 2107-12-31. */
export function dosDateTime(date: Date): { time: number; date: number } {
  let parts = {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
  };
  if (Number.isNaN(date.getTime()) || parts.year < DOS_MIN.year) parts = DOS_MIN;
  else if (parts.year > DOS_MAX.year) parts = DOS_MAX;
  return {
    time: (parts.hours << 11) | (parts.minutes << 5) | (parts.seconds >> 1),
    date: ((parts.year - 1980) << 9) | (parts.month << 5) | parts.day,
  };
}

export interface ZipEntry {
  /** Entry name as it appears in the archive (already sanitized by the caller). */
  name: string;
  data: Blob;
  /** Last-modified time stored for the entry. */
  date: Date;
}

const UTF8_FLAG = 0x0800;
const VERSION = 20; // 2.0: the minimum for a stored file; host byte 0 = MS-DOS attributes
const UNICODE_PATH = 0x7075;

function unicodePathExtra(nameBytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4 + 5 + nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, UNICODE_PATH, true);
  view.setUint16(2, 5 + nameBytes.length, true);
  view.setUint8(4, 1); // version of this extra field
  view.setUint32(5, crc32(nameBytes), true); // CRC-32 of the header's file name field
  out.set(nameBytes, 9);
  return out;
}

async function blobCrc(blob: Blob): Promise<number> {
  return crc32(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * The archive as a Blob: for each entry a local file header and the entry's own Blob, then the central directory and
 * the end record. `onEntry` reports progress (entries whose CRC has been computed).
 */
export async function buildZip(entries: readonly ZipEntry[], onEntry?: (done: number) => void): Promise<Blob> {
  if (entries.length > 0xffff) throw new Error('too many zip entries');
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [index, entry] of entries.entries()) {
    const name = new Uint8Array(encoder.encode(entry.name));
    const extra = unicodePathExtra(name);
    const size = entry.data.size;
    if (size > 0xfffffffe || offset > 0xfffffffe) throw new Error('zip too large (ZIP64 is not supported)');
    const crc = await blobCrc(entry.data);
    const { time, date } = dosDateTime(entry.date);
    const local = new Uint8Array(30 + name.length + extra.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);
    const header = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, VERSION, true); // made by
    cv.setUint16(6, VERSION, true); // needed to extract
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true);
    header.set(name, 46);
    header.set(extra, 46 + name.length);
    central.push(header);
    parts.push(local, entry.data);
    offset += local.length + size;
    onEntry?.(index + 1);
  }
  const centralSize = central.reduce((sum, h) => sum + h.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
