import type { Label } from '../api/types.ts';

export const MAX_FINANCE_CSV_BYTES = 262_144;
export class FinanceFileError extends Error {
  constructor(readonly label: Label) { super(label.ja); }
}

export function financeBytesBlob(bytes: readonly number[], mediaType: string): Blob {
  if (bytes.length > 12_582_912 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new FinanceFileError({ ja: '出力ファイルの形式を確認できません。', en: 'The exported file is invalid.' });
  return new Blob([Uint8Array.from(bytes)], { type: mediaType });
}

/** Preserve source text for server validation; never silently replace invalid bank-file bytes. */
export async function readFinanceCsv(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<string> {
  if (file.size === 0 || file.size > MAX_FINANCE_CSV_BYTES) throw new FinanceFileError({ ja: '空でない256 KiB以下のCSVを選んでください。', en: 'Choose a non-empty CSV no larger than 256 KiB.' });
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_FINANCE_CSV_BYTES) throw new FinanceFileError({ ja: 'ファイルの大きさが変わりました。選び直してください。', en: 'The file size changed. Select it again.' });
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new FinanceFileError({ ja: 'CSVはUTF-8で保存してください。文字コードを自動変換しません。', en: 'Save the CSV as UTF-8. Its encoding is not converted automatically.' }); }
  if (!text.trim() || text.includes('\0')) throw new FinanceFileError({ ja: 'CSVが空、または使用できない文字を含みます。', en: 'The CSV is empty or contains invalid characters.' });
  return text;
}

/** Preserve the server's encoded bytes, including Shift_JIS. Text re-encoding corrupts bank/tax files. */
export function financeFileBlob(base64: string, mediaType: string): Blob {
  if (base64.length > 16_777_216 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new FinanceFileError({ ja: '出力ファイルの形式を確認できません。再取得してください。', en: 'The exported file is invalid. Download it again.' });
  const decoded = atob(base64), bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mediaType });
}
