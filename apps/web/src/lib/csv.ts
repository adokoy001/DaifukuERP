// TableResult -> CSV text (web-phase1 AC-3, client-side download). Pure; csv.test.ts.
import type { Locale, TableResult } from '../api/types.ts';
import { columnTotals, extraTotals } from './report.ts';

function cell(v: unknown, numeric = false): string {
  if (v === null || v === undefined) return '';
  const raw = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  const safeNumber = numeric && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw);
  const leading = [...raw].find((char) => char.charCodeAt(0) > 32 && !/\s/.test(char));
  const s = !safeNumber && leading !== undefined && '=+@-'.includes(leading) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Header row uses the column labels in `locale`; decimals stay as the raw strings the server sent; column totals become a
 * last row, and totals that match no column follow as `key,value` rows (web-phase15 AC-7).
 */
export function tableToCsv(result: TableResult, locale: Locale, totalsLabel: string): string {
  const lines: string[] = [result.columns.map((c) => cell(c.label[locale] || c.label.en)).join(',')];
  for (const row of result.rows) lines.push(result.columns.map((c) => cell(row[c.key], c.kind === 'decimal' || c.kind === 'int')).join(','));
  const totals = columnTotals(result);
  if (Object.keys(totals).length > 0) lines.push(result.columns.map((c, i) => cell(totals[c.key] ?? (i === 0 ? totalsLabel : ''), totals[c.key] !== undefined)).join(','));
  for (const [key, value] of extraTotals(result)) lines.push(`${cell(key)},${cell(value, true)}`);
  // CRLF + BOM so Excel (ja-JP) opens UTF-8 without garbling.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function csvFilename(actionName: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `${actionName.replace(/\./g, '_')}_${stamp}.csv`;
}
