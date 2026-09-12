import iconv from 'iconv-lite';
import { ValidationError } from '@daifuku/kernel';
function invalid(path: string, message: string): never { throw new ValidationError('e-Tax取込文字・桁の条件に適合しません', [{ path, message }]); }
/** Strict JIS X 0208 (levels 1/2) text; no CP932 vendor-extension or silent replacement. */
export function officialText(value: string, path: string, max: number): string {
 if (!value || [...value].length > max || (/[\r\n\t,"゛゜]/.test(value) || [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) || /^[=+@-]/.test(value)) invalid(path, '文字数・改行・区切り文字を確認してください。');
 const bytes = iconv.encode(value, 'shift_jis');
 if (iconv.decode(bytes, 'shift_jis') !== value) invalid(path, 'SHIFT-JISに無損失変換できる正式表記を指定してください。');
 for (let i = 0; i < bytes.length; i++) {
  const lead = bytes[i] ?? 0;
  if (lead < 0x80 || (lead >= 0xa1 && lead <= 0xdf)) invalid(path, '文字欄は全角のJIS第1・第2水準で指定してください。');
  const trail = bytes[++i] ?? 0, jisRow = (lead <= 0x9f ? (lead - 0x81) * 2 + 0x21 : (lead - 0xc1) * 2 + 0x21) + (trail >= 0x9f ? 1 : 0);
  if (lead < 0x81 || lead > 0xef || trail < 0x40 || trail > 0xfc || trail === 0x7f || jisRow > 0x74 || (jisRow >= 0x29 && jisRow <= 0x2f)) invalid(path, '拡張文字はJIS第1・第2水準の正式表記へ変更してください。');
 }
 return value;
}
export function officialAmount(value: string): string { if (!/^-?\d{1,15}$/.test(value)) invalid('amount', '円単位・整数15桁までの金額を指定してください。端数を自動で切り捨てません。'); return value; }
export function encodeOfficial(text: string): string { const bytes = iconv.encode(text, 'shift_jis'); if (iconv.decode(bytes, 'shift_jis') !== text) invalid('file', '出力をSHIFT-JISで復元できません。'); return bytes.toString('base64'); }
export function csvCell(text: string): string { const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text; return '"' + safe.replaceAll('"', '""') + '"'; }
export function encodePreparation(text: string): string { return iconv.encode('\ufeff' + text, 'utf8').toString('base64'); }
