import { Decimal, ValidationError } from '@daifuku/kernel';
import type { BankTransferSnapshot } from './contract.ts';
import { csvCell } from './csv.ts';
const allowed = /^[0-9A-Z ｢｣(),.\\/ｦｱ-ﾟ-]+$/u;
function invalid(field: string): never { throw new ValidationError('銀行ファイルの項目を確認してください。', [{ path: field, message: '許可文字・桁数・上限を満たしていません。' }]); }
export function assertBankCharacters(value: string) { if (!allowed.test(value)) invalid('holderKana'); }
function numeric(value: string, length: number, field: string): string {
  if (!/^[0-9]+$/u.test(value) || value.length > length) invalid(field);
  return value.padStart(length, '0');
}
function kana(value: string, length: number): string {
  assertBankCharacters(value);
  if (value.length > length) invalid('holderKana');
  return value.padEnd(length, ' ');
}
const space = (length: number) => ' '.repeat(length);
const type = (value: 'ordinary' | 'current') => value === 'ordinary' ? '1' : '2';
/** Limited single-byte JIS/Shift_JIS repertoire, validated before conversion; never truncates. */
export function encodeBankText(text: string): number[] {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0);
    if (code <= 0x7f) return code;
    if (code >= 0xff61 && code <= 0xff9f) return code - 0xff61 + 0xa1;
    return invalid('encoding');
  });
}
export function zenginRecords(snapshot: BankTransferSnapshot, transferDate: string): string[] {
  const account = snapshot.account;
  const count = snapshot.lines.length;
  if (count < 1 || count > 500 || !/^\d{4}-\d{2}-\d{2}$/u.test(transferDate)) invalid('items');
  const total = snapshot.lines.reduce((sum, row) => sum.plus(row.amount), Decimal.zero()).toString();
  const header = '1210' + numeric(account.requesterCode, 10, 'requesterCode') + kana(account.holderKana, 40) + transferDate.slice(5).replace('-', '') + numeric(account.bankCode, 4, 'bankCode') + space(15) + numeric(account.branchCode, 3, 'branchCode') + space(15) + type(account.accountType) + numeric(account.accountNumber, 7, 'accountNumber') + space(17);
  const rows = snapshot.lines.map((line) => {
    const payee = line.payee;
    return '2' + numeric(payee.bankCode, 4, 'bankCode') + space(15) + numeric(payee.branchCode, 3, 'branchCode') + space(15) + space(4) + type(payee.accountType) + numeric(payee.accountNumber, 7, 'accountNumber') + kana(payee.holderKana, 30) + numeric(line.amount, 10, 'amount') + '0' + '0'.repeat(20) + '7' + space(8);
  });
  const records = [header, ...rows, '8' + numeric(String(count), 6, 'count') + numeric(total, 12, 'total') + space(101), '9' + space(119)];
  if (records.some((record) => encodeBankText(record).length !== 120)) invalid('recordLength');
  return records;
}
export function exportBankFile(snapshot: BankTransferSnapshot, transferDate: string, format: 'canonical_csv' | 'zengin120', lineEnding: 'none' | 'crlf') {
  if (format === 'zengin120') {
    const separator = lineEnding === 'crlf' ? '\r\n' : '';
    return { encoding: 'shift_jis' as const, bytes: encodeBankText(zenginRecords(snapshot, transferDate).join(separator) + separator), contentType: 'application/octet-stream', extension: 'txt' };
  }
  if (lineEnding !== 'crlf') invalid('lineEnding');
  const rows = [['transferDate', 'invoiceId', 'bankCode', 'branchCode', 'accountType', 'accountNumber', 'holderKana', 'amount'], ...snapshot.lines.map((line) => [transferDate, line.invoiceId, line.payee.bankCode, line.payee.branchCode, line.payee.accountType, line.payee.accountNumber.padStart(7, '0'), line.payee.holderKana, line.amount])];
  return { encoding: 'utf-8' as const, bytes: Array.from(new TextEncoder().encode(rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n')), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
}
