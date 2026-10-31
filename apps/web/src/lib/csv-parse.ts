// Reading a CSV file for the import screen (docs/specs/csv-import.md AC-11): byte decoding (UTF-8 with or without BOM,
// else Shift_JIS, with the platform TextDecoder only) and an RFC 4180 parser (quoted cells, doubled quotes, line breaks
// inside quotes, CRLF / LF / CR). Pure; csv-parse.test.ts.

export type CsvEncoding = 'utf-8' | 'utf-8-bom' | 'shift_jis';

/** AC-11: a BOM means UTF-8; bytes that are valid UTF-8 are UTF-8; anything else is read as Shift_JIS (Excel ja-JP). */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
  }
}

export class CsvParseError extends Error {
  /** 1-based physical line where the unterminated quoted cell starts. */
  readonly line: number;
  constructor(line: number) {
    super(`unterminated quoted cell starting on line ${line}`);
    this.name = 'CsvParseError';
    this.line = line;
  }
}

/**
 * RFC 4180 records. A quote opens a quoted cell only at the start of a cell; elsewhere it is kept as written (lenient,
 * like spreadsheet exports). A final line break does not add an empty record. A leading BOM is dropped.
 */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let fresh = true;
  let quoted = false;
  let line = 1;
  let quoteLine = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n' || (c === '\r' && s[i + 1] !== '\n')) line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && fresh) {
      quoted = true;
      fresh = false;
      quoteLine = line;
    } else if (c === ',') {
      record.push(cell);
      cell = '';
      fresh = true;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
      fresh = true;
      line++;
    } else {
      cell += c;
      fresh = false;
    }
  }
  if (quoted) throw new CsvParseError(quoteLine);
  if (!fresh || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records;
}

export interface CsvTable {
  headers: string[];
  /** Data records (blank records dropped), each as long as `headers` (short records are padded with blank cells). */
  rows: string[][];
  /** For each entry of `rows`: its 1-based data row number in the file (header not counted; blank records counted). */
  lines: number[];
  /**
   * Data row numbers (as in `lines`) of records that an unquoted comma has probably shifted: a non-blank cell past the
   * last header, or more cells than the file's usual width. RFC 4180 records have as many cells as the header, and
   * `rows` would silently drop the extra cells, so the screen refuses such a file. The usual width is the header's, or
   * the most common record width when that is larger (a file written with a trailing comma on every record), so a
   * shifted record whose last value is blank is caught unless most records share its width.
   */
  wide: number[];
}

const blank = (record: readonly string[]) => record.every((cell) => cell.trim() === '');

/** The first non-blank record is the header (cells trimmed); records of only blank cells are dropped. */
export function csvTable(records: readonly string[][]): CsvTable {
  const start = records.findIndex((r) => !blank(r));
  if (start < 0) return { headers: [], rows: [], lines: [], wide: [] };
  const headers = (records[start] ?? []).map((h) => h.trim());
  const data = records
    .slice(start + 1)
    .map((record, index) => ({ record, line: index + 1 }))
    .filter(({ record }) => !blank(record));
  const width = Math.max(headers.length, commonWidth(data.map(({ record }) => record.length)));
  return {
    headers,
    rows: data.map(({ record }) => headers.map((_, i) => record[i] ?? '')),
    lines: data.map(({ line }) => line),
    wide: data
      .filter(({ record }) => record.length > width || !blank(record.slice(headers.length)))
      .map(({ line }) => line),
  };
}

/** The most frequent record width (the smaller one on a tie); 0 when there are no records. */
function commonWidth(widths: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [width, count] of counts)
    if (count > bestCount || (count === bestCount && width < best)) [best, bestCount] = [width, count];
  return best;
}
