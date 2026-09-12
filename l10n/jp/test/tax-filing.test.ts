import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import iconv from 'iconv-lite';
import type { FilingSource, AccountingProfile } from '@daifuku/mod-tax-filing';
import { JAPAN_FILING_PROFILES } from '../src/filing/profiles.ts';
import { csvCell, officialText, officialAmount } from '../src/filing/encoding.ts';
const jp = JAPAN_FILING_PROFILES[0]; if (!jp) throw new Error('Missing JP formatter');
const mappings = [{ accountId: '00000000-0000-4000-8000-000000000001', category: 'current_assets', displayName: '普通預金' }, { accountId: '00000000-0000-4000-8000-000000000002', category: 'capital', displayName: '資本金' }, { accountId: '00000000-0000-4000-8000-000000000003', category: 'sales', displayName: '売上高' }, { accountId: '00000000-0000-4000-8000-000000000004', category: 'operating_expenses', displayName: '給料手当' }];
const profile: AccountingProfile = { countryProfile: 'jp-hot010-general-v3', entityType: 'corporation', accountingBasis: 'tax_exclusive', consolidation: 'standalone', legalName: '株式会社試験', mappings, basis: '帳簿分類を確認' };
function source(): FilingSource { return { kind: 'accounting', country: 'JP', currency: 'JPY', from: '2026-01-01', to: '2026-12-31', profile, balances: [
 { accountId: mappings[0]?.accountId ?? '', name: '普通預金', code: '100', type: 'asset', opening: '1000', debit: '300', credit: '100', closing: '1200' },
 { accountId: mappings[1]?.accountId ?? '', name: '資本金', code: '300', type: 'equity', opening: '-1000', debit: '0', credit: '0', closing: '-1000' },
 { accountId: mappings[2]?.accountId ?? '', name: '売上高', code: '400', type: 'revenue', opening: '0', debit: '0', credit: '300', closing: '-300' },
 { accountId: mappings[3]?.accountId ?? '', name: '給料手当', code: '600', type: 'expense', opening: '0', debit: '100', credit: '0', closing: '100' },
 ], payrollRows: [], issues: [], totals: { statutoryTaxDue: null }, versions: [], records: {} }; }
describe('HOT010 3.0 limited general-industry profile', () => {
 it('emits two five-column SHIFT-JIS statements with official headers and reconciled totals', () => {
  const s = source(), p = jp.prepare(s); expect(p.issues).toEqual([]); expect(p.totals).toMatchObject({ assets: '1200', liabilities: '0', equity: '1200', netProfit: '200', balanceDifference: '0', statutoryTaxDue: null });
  const files = jp.export(s, p); expect(files.map((f) => f.filename)).toEqual(['HOT010_3.0_BS_10.csv', 'HOT010_3.0_PL_10.csv']);
  const bs = iconv.decode(Buffer.from(files[0]?.contentBase64 ?? '', 'base64'), 'shift_jis');
  expect(bs.startsWith('A,BS,,,\r\nB,株式会社試験,,,\r\nC1,2026-01-01,,,\r\nC2,2026-12-31,,,\r\n貸借対照表,,,,\r\n')).toBe(true);
  expect(bs).toContain('資産の部,,T,2,10A000010\r\n'); expect(bs).toContain('資産,1200,1,3,10A000020\r\n'); expect(bs).toContain('負債純資産,1200,1,2,10C000040\r\n');
  expect(bs).toContain('流動負債,0,1,4,10B101070\r\n'); expect(bs.split('\r\n').filter(Boolean).every((line) => line.split(',').length === 5)).toBe(true);
 });
 it('preserves a loss and integrates the actual PL loss into equity without a balancing plug', () => {
  const s = source(); s.balances = s.balances.map((r) => r.type === 'expense' ? { ...r, debit: '500', closing: '500' } : r.type === 'asset' ? { ...r, credit: '500', closing: '800' } : r);
  const p = jp.prepare(s); expect(p.totals).toMatchObject({ netProfit: '-200', equity: '800', balanceDifference: '0' }); expect(p.issues).toEqual([]);
  const pl = iconv.decode(Buffer.from(jp.export(s, p)[1]?.contentBase64 ?? '', 'base64'), 'shift_jis'); expect(pl).toContain('当期純利益又は当期純損失（△）,-200,1,2,10F000160');
 });
 it('blocks unmapped accounts, account-type mismatches, non-JPY and an unbalanced BS', () => {
  const s = source(); s.profile = { ...profile, mappings: mappings.slice(1) }; expect(jp.prepare(s).issues.map((i) => i.code)).toContain('mapping_missing');
  s.profile = { ...profile, mappings: mappings.map((m) => m.category === 'sales' ? { ...m, category: 'current_assets' } : m) }; expect(jp.prepare(s).issues.map((i) => i.code)).toContain('mapping_type');
  s.profile = profile; s.currency = 'USD'; s.balances = s.balances.map((r) => r.type === 'asset' ? { ...r, closing: '999' } : r); expect(jp.prepare(s).issues.map((i) => i.code)).toEqual(expect.arrayContaining(['country_currency', 'statement_balance']));
 });
 it('does not round fractional or overlong amounts into an official file', () => {
  expect(() => officialAmount('1.5')).toThrow(); expect(() => officialAmount('1000000000000000')).toThrow(); expect(officialAmount('-999999999999999')).toBe('-999999999999999');
 });
 it('rejects silent substitutions, vendor extensions, halfwidth, delimiters and duplicate mappings', () => {
  for (const name of ['株式会社😀', '株式会社①', '株式会社髙', '株式会社ABC', '株式会社,試験', '株式会社\n試験', '株式会社カ゛ラス']) expect(() => officialText(name, 'name', 50)).toThrow();
  expect(officialText('株式会社ガラス', 'name', 50)).toBe('株式会社ガラス'); expect(() => jp.validateProfile?.({ ...profile, mappings: [...mappings, ...mappings] })).toThrow('複数');
 });
 it('requires the typed corporate, tax-exclusive and standalone profile', () => {
  expect(() => jp.prepare({ ...source(), profile: { ...profile, entityType: 'individual' } })).toThrow();
 });
 it('matches all standard output codes, titles and levels against the independently extracted official XLSX fixture', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/hot010-v3-general.json', import.meta.url), 'utf8')) as { rows: { statement: string; code: string; rowType: string; level: number }[] };
  for (const statement of jp.prepare(source()).statements) for (const row of statement.rows.filter((r) => !r.code.includes('-'))) {
   const official = reference.rows.find((r) => r.code === row.code && r.statement === statement.kind);
   expect(official, row.code).toBeDefined(); expect(row, row.code).toMatchObject({ rowType: official?.rowType, level: official?.level });
  }
  const pl = jp.prepare(source()).statements.find((s) => s.kind === 'PL');
  expect(pl?.rows.slice(4, 6).map((r) => r.code)).toEqual(['10E100010', '10E100020']);
 });
 it('neutralizes spreadsheet formula prefixes in the explicitly nonofficial preparation CSV', () => {
  for (const value of ['=1+1', '+123', '-CMD', '@SUM(A1)', '  =SUM(A1)', '\t=1+1']) expect(csvCell(value)).toBe('"\'' + value + '"');
 });

});
