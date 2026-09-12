import { describe, expect, it } from 'vitest';
import type { BankTransferSnapshot } from '../src/contract.ts';
import { csvCell, parseStatementCsv, statementTotals } from '../src/csv.ts';
import { candidateReasons } from '../src/matching.ts';
import { assertBankCharacters, encodeBankText, exportBankFile, zenginRecords } from '../src/zengin.ts';
const header = 'externalId,bookedOn,direction,amount,description';
const identity = { bankCode: '0009', branchCode: '001', accountType: 'ordinary' as const, accountNumber: '1234567', holderKana: 'ｶ)ﾃｽﾄ' };
const snapshot: BankTransferSnapshot = { account: { ...identity, name: '振込元', ledgerAccountId: 'ledger', requesterCode: '0123456789' }, lines: [{ invoiceId: 'invoice', invoiceVersion: 1, number: 'PINV-1', partnerId: 'partner', partnerName: '仕入先', payeeId: 'payee', payeeVersion: 1, amount: '1234567890', payee: { ...identity, accountNumber: '1' } }] };
describe('canonical bank CSV', () => {
  it('preserves quoted commas, escaped quotes and line breaks, BOM and CRLF; sums with Decimal', () => {
    const rows = parseStatementCsv(`\ufeff${header}\r\n001,2026-09-01,receive,9999999999,"ｶ)ﾃｽﾄ, ""入金""\n備考"\r\n002,2026-09-02,pay,12,支払\r\n003,2026-09-02,receive,2,追加\r\n`);
    expect(rows[0]).toMatchObject({ externalId: '001', description: 'ｶ)ﾃｽﾄ, "入金"\n備考' });
    expect(statementTotals(rows)).toEqual({ receiveTotal: '10000000001', payTotal: '12' });
  });
  it.each(['0', '-1', '+2', '01', '1.5', '1e3', '1,000', '10000000000'])('rejects noncanonical or oversized money %s', (amount) => {
    expect(() => parseStatementCsv(`${header}\na,2026-09-01,receive,${amount},x`)).toThrow();
  });
  it.each(['2026-02-29', '260901', '2026/09/01'])('rejects guessed or invalid dates %s', (date) => {
    expect(() => parseStatementCsv(`${header}\na,${date},receive,1,x`)).toThrow();
  });
  it('rejects duplicate IDs within a file, malformed quote, extra field and invalid encoding', () => {
    for (const body of ['a,2026-09-01,pay,1,x\na,2026-09-02,pay,1,y', 'a,2026-09-01,pay,1,"x"z', 'a,2026-09-01,pay,1,"x', 'a,2026-09-01,pay,1,x,y', 'a,2026-09-01,pay,1,\ufffd']) expect(() => parseStatementCsv(`${header}\n${body}`)).toThrow();
  });
  it('bounds rows and bytes; accepts distinct IDs for otherwise identical real transactions', () => {
    const make = (count: number) => `${header}\n` + Array.from({ length: count }, (_, i) => `${i},2026-09-01,pay,1,x`).join('\n');
    expect(parseStatementCsv(make(500))).toHaveLength(500); expect(() => parseStatementCsv(make(501))).toThrow();
    expect(() => parseStatementCsv(header + '\n' + 'あ'.repeat(170_000))).toThrow();
  });
  it('protects text export cells from spreadsheet formulas', () => { for (const value of ['=1+1', '+SUM(A1)', '@x', '-1', '\tformula']) expect(csvCell(value)).toContain("'"); });
});
describe('limited general transfer 120-byte profile', () => {
  it('matches official field offsets, zero padding, count/total, and single-byte kana', () => {
    const records = zenginRecords(snapshot, '2026-09-30');
    expect(records.map((row) => encodeBankText(row).length)).toEqual([120, 120, 120, 120]);
    expect(records[0]?.slice(0, 14)).toBe('12100123456789'); expect(records[0]?.slice(54, 58)).toBe('0930');
    expect(records[1]?.slice(43, 50)).toBe('0000001'); expect(records[1]?.slice(80, 90)).toBe('1234567890');
    expect(records[2]?.slice(0, 19)).toBe('8000001001234567890');
    expect(encodeBankText('ｶ)ﾃｽﾄ')).toEqual([0xb6, 0x29, 0xc3, 0xbd, 0xc4]);
  });
  it('emits exactly requested record endings with no BOM', () => {
    const none = exportBankFile(snapshot, '2026-09-30', 'zengin120', 'none');
    const crlf = exportBankFile(snapshot, '2026-09-30', 'zengin120', 'crlf');
    expect(none.bytes.length).toBe(480); expect(crlf.bytes.length).toBe(488);
    expect(none.bytes[0]).toBe(49); expect(crlf.bytes.slice(120, 122)).toEqual([13, 10]); expect(crlf.bytes.slice(-2)).toEqual([13, 10]);
  });
  it('rejects small kana, full-width, lower-case, unknown symbols and overflow without truncating', () => {
    for (const name of ['ｧ', 'ャ', 'abc', 'ﾃｰｽﾄ', 'A&B', 'A\nB']) expect(() => assertBankCharacters(name)).toThrow();
    expect(() => assertBankCharacters('ｦﾝ ABC-()/\\.,｢｣')).not.toThrow();
    expect(() => zenginRecords({ ...snapshot, lines: [{ ...required(snapshot.lines[0]), amount: '10000000000' }] }, '2026-09-30')).toThrow();
    expect(() => zenginRecords({ ...snapshot, lines: Array.from({ length: 101 }, () => ({ ...required(snapshot.lines[0]), amount: '9999999999' })) }, '2026-09-30')).toThrow();
    expect(() => zenginRecords({ ...snapshot, lines: [{ ...required(snapshot.lines[0]), payee: { ...identity, holderKana: 'A'.repeat(31) } }] }, '2026-09-30')).toThrow();
  });
});
it('candidate scoring explains equal amount/date/name and does not treat partial money as exact', () => {
  expect(candidateReasons(true, '2026-09-01', '2026-09-01', 'ｶ)ﾃｽﾄ 入金', 'カ)テスト')).toEqual({ score: 100, reasons: ['金額一致', '日付一致', '摘要に取引先名'] });
  expect(candidateReasons(false, '2026-08-01', '2026-09-01', '', '取引先').score).toBe(20);
});
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Expected fixture value'); return value; }
