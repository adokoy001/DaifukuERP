import { Decimal, ValidationError } from '@daifuku/kernel';
import { BANK_MAX_ROWS, bankStatementSource, type BankSource } from './contract.ts';
const HEADER = ['externalId', 'bookedOn', 'direction', 'amount', 'description'];
function invalid(message: string, row = 0): never { throw new ValidationError('銀行 CSV を確認してください。', [{ path: `csv.${row}`, message }]); }
/** Strict RFC-style quoting. A quote may only start an empty field; no characters after its closing quote. */
function cells(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
      continue;
    }
    if (ch === '"' && !field && !closed) { quoted = true; continue; }
    if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(field); field = ''; closed = false;
      if (ch !== ',') { rows.push(row); row = []; if (ch === '\r') { if (csv[i + 1] !== '\n') invalid('単独 CR は使用できません。'); i++; } }
      if (rows.length > BANK_MAX_ROWS + 1) invalid('500 行まで取り込めます。');
      continue;
    }
    if (closed || ch === '"') invalid('CSV の引用符が不正です。', rows.length + 1);
    field += ch;
  }
  if (quoted) invalid('CSV の引用符が閉じられていません。');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}
export function parseStatementCsv(raw: string): BankSource[] {
  if (new TextEncoder().encode(raw).length > 500_000 || raw.includes('\0') || raw.includes('\ufffd')) invalid('UTF-8、500 KB 以内のファイルが必要です。');
  const rows = cells(raw.replace(/^\uFEFF/u, ''));
  if (JSON.stringify(rows.shift()) !== JSON.stringify(HEADER)) invalid(`ヘッダーは ${HEADER.join(',')} にしてください。`);
  if (!rows.length || rows.length > BANK_MAX_ROWS) invalid('1 ～ 500 行が必要です。');
  const ids = new Set<string>();
  return rows.map((row, index) => {
    if (row.length !== HEADER.length) invalid('列数が一致しません。', index + 2);
    const result = bankStatementSource.safeParse(Object.fromEntries(HEADER.map((name, i) => [name, row[i]])));
    if (!result.success) invalid(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), index + 2);
    if (/^[\s]|[\s]$/u.test(result.data.externalId) || [...result.data.externalId].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) invalid('externalId の空白・制御文字は使用できません。', index + 2);
    if (ids.has(result.data.externalId)) invalid('ファイル内の externalId が重複しています。', index + 2);
    ids.add(result.data.externalId); return result.data;
  });
}
export function statementTotals(rows: readonly BankSource[]) {
  const sum = (direction: BankSource['direction']) => rows.filter((row) => row.direction === direction).reduce((total, row) => total.plus(row.amount), Decimal.zero()).toString();
  return { receiveTotal: sum('receive'), payTotal: sum('pay') };
}
export function csvCell(value: string): string {
  // A quoted cell alone does not prevent spreadsheet formula evaluation.
  const safe = /^[=+@\-\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
