// Unit tests for the opening balances screen logic (docs/specs/opening-balances.md AC-33..AC-35, AC-38, AC-39).
import { describe, expect, it } from 'vitest';
import type { AppMeta } from '../api/types.ts';
import { csvTable, parseCsv } from './csv-parse.ts';
import {
  clearingReasonText,
  errorCsv,
  fileLine,
  matchHeaders,
  messageLine,
  nameSuffix,
  isOpeningDocument,
  OPENING_SECTIONS,
  REASON_TEXT,
  reasonText,
  requestRows,
  sectionBlocked,
  SECTION_COLUMNS,
  templateCsv,
  usesClearingAccount,
  yearOptionLabel,
  type OpeningImportResult,
} from './opening-balances.ts';

const table = (text: string) => csvTable(parseCsv(text));

describe('AC-34 matchHeaders', () => {
  it('AC-34: ja and en labels and field names match, through headerKey (full-width, case, spaces)', () => {
    expect(matchHeaders(['科目コード', '取引先コード', '借方', '貸方', '摘要'], 'journal')).toEqual({
      ok: true,
      fields: ['accountCode', 'partnerCode', 'debit', 'credit', 'memo'],
    });
    expect(matchHeaders(['ACCOUNT  CODE', 'debit', 'Ｃｒｅｄｉｔ'], 'journal')).toEqual({
      ok: true,
      fields: ['accountCode', 'debit', 'credit'],
    });
    expect(matchHeaders(['warehouseCode', 'Product code', '数量', '単価'], 'stock')).toMatchObject({ ok: true });
  });

  it('AC-34: missing required, unknown and duplicate columns refuse the file with their names', () => {
    const r = matchHeaders(['取引先コード', 'amount', '金額', 'notes'], 'receivables');
    expect(r).toEqual({ ok: false, missing: [], unknown: ['notes'], duplicate: ['金額'] });
    const missing = matchHeaders(['数量'], 'stock');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.missing.map((c) => c.field)).toEqual(['productCode', 'unitCost']);
  });
});

describe('AC-34 requestRows', () => {
  it('AC-34: blank cells become null, the formula guard is removed, blank records are not sent', () => {
    const t = table('科目コード,借方,貸方\n1000,"1,000",\n\n,,\n2100,,\'-5\n');
    const m = matchHeaders(t.headers, 'journal');
    if (!m.ok) throw new Error('header');
    expect(requestRows(t, m.fields)).toEqual([
      { accountCode: '1000', debit: '1,000', credit: null },
      { accountCode: '2100', debit: null, credit: '-5' },
    ]);
    // AC-35: results are reported with the file's data row number (the blank records counted)
    expect(fileLine(t, 2)).toBe(4);
  });
});

describe('AC-33 template', () => {
  it('AC-33: header-only, UTF-8 BOM, CRLF, in the display language', () => {
    expect(templateCsv('journal', 'ja')).toBe('\uFEFF科目コード,取引先コード,借方,貸方,摘要\r\n');
    expect(templateCsv('stock', 'en')).toBe('\uFEFFWarehouse code,Product code,Quantity,Unit cost\r\n');
    for (const section of OPENING_SECTIONS) {
      const t = table(templateCsv(section, 'en').slice(1));
      expect(matchHeaders(t.headers, section).ok, section).toBe(true);
    }
  });
});

describe('AC-35 errorCsv', () => {
  it('AC-35: failed rows as written, the data row number and reasons; formula cells are guarded', () => {
    const t = table('partnerCode,amount\nC001,100\n=HYPERLINK("x"),-1\n');
    const result = {
      rows: [
        { line: 1, status: 'ok' },
        {
          line: 2,
          status: 'error',
          messages: [{ code: 'negative_amount', message: '-1 is negative', field: 'amount', column: 'amount' }],
        },
      ],
    } as OpeningImportResult;
    expect(errorCsv('receivables', t, result, 'ja')).toBe(
      '\uFEFFpartnerCode,amount,行番号,理由\r\n"\'=HYPERLINK(""x"")",-1,2,金額: 金額が負です (-1 is negative)\r\n',
    );
  });
});

describe('AC-39 reasons', () => {
  it('AC-39: every code the four imports return has ja and en text', () => {
    for (const code of [
      'zero_amount',
      'invalid_value',
      'negative_amount',
      'both_sides',
      'not_whole_yen',
      'ref_not_found',
      'ref_ambiguous',
      'pl_account',
      'clearing_account',
      'journal_only_open_item',
      'exists',
      'cancelled_in_year',
      'non_positive_quantity',
      'scale_exceeded',
      'service_product',
      'duplicate',
      'stock_exists',
      'unbalanced',
      'no_lines',
      'submit_failed',
      'clearing_account_used',
      'database',
    ]) {
      expect(REASON_TEXT[code]?.ja, code).toBeTruthy();
      expect(REASON_TEXT[code]?.en, code).toBeTruthy();
    }
    expect(reasonText('CONFLICT', 'en')).toBeTruthy();
    expect(
      messageLine('journal', { code: 'pl_account', message: 'x', field: 'accountCode', column: 'accountCode' }, 'en'),
    ).toBe('Account code: A profit-and-loss account (opening balances are balance-sheet accounts only) (x)');
    expect(SECTION_COLUMNS.payables).toBe(SECTION_COLUMNS.receivables);
  });
});

describe('AC-38 sectionBlocked', () => {
  const meta = (roles: string[], ops: Record<string, string[]>, actions: string[]): AppMeta =>
    ({
      roles,
      modules: [],
      actions: actions.map((name) => ({ name })),
      entities: Object.entries(ops).map(([name, o]) => ({ name, ops: o })),
    }) as unknown as AppMeta;
  const all = [
    'accounting.import_opening_balances',
    'sales.import_opening_receivables',
    'purchase.import_opening_payables',
    'inventory.import_opening_stock',
  ];
  it('AC-38: accounting alone imports only the journal', () => {
    const m = meta(['accounting'], { sales_invoice: ['read', 'update'], stock_entry: ['read'] }, all);
    expect(sectionBlocked('journal', m)).toBeUndefined();
    expect(sectionBlocked('receivables', m)).toBeDefined();
    expect(sectionBlocked('payables', m)).toBeDefined();
    expect(sectionBlocked('stock', m)).toBeDefined();
  });
  it('AC-38: sales holds stock_entry create/submit but cannot receive: the stock section stays disabled', () => {
    const m = meta(
      ['accounting', 'sales'],
      { sales_invoice: ['read', 'create', 'submit'], stock_entry: ['read', 'create', 'submit'] },
      all,
    );
    expect(sectionBlocked('receivables', m)).toBeUndefined();
    expect(sectionBlocked('stock', m)?.en).toContain('sales role cannot receive');
    const purchasing = meta(
      ['accounting', 'purchasing'],
      { stock_entry: ['read', 'create', 'submit'], product: ['read', 'create'], warehouse: ['read'] },
      all,
    );
    expect(sectionBlocked('stock', purchasing)).toBeUndefined();
  });
  it('AC-6 AC-38: accounting + inventory without a product read role keeps the stock section disabled', () => {
    const stock = { stock_entry: ['read', 'create', 'submit'], warehouse: ['read', 'create'] };
    const noProduct = meta(['accounting', 'inventory'], stock, all);
    expect(sectionBlocked('stock', noProduct)?.ja).toContain('品目を読める役割');
    expect(sectionBlocked('stock', noProduct)?.en).toContain('reads products');
    const withViewer = meta(['accounting', 'inventory', 'viewer'], { ...stock, product: ['read'] }, all);
    expect(sectionBlocked('stock', withViewer)).toBeUndefined();
    const noWarehouse = meta(['admin'], { stock_entry: ['read', 'create', 'submit'], product: ['read'] }, all);
    expect(sectionBlocked('stock', noWarehouse)).toBeDefined();
  });
});

describe('AC-28 AC-37 clearing account and year texts', () => {
  it('AC-28: each clearing reason explains the fix in ja and en with the account code', () => {
    const missing = clearingReasonText('clearing_account_missing', '3999');
    expect(missing.ja).toContain('3999 がありません');
    expect(missing.ja).toContain('3900 期首残高仮勘定');
    expect(missing.en).toContain('Settings → Accounting → Opening balance import');
    const invalid = clearingReasonText('clearing_account_invalid', '4000');
    expect(invalid.ja).toContain('科目 4000 は期首残高仮勘定に使えません');
    expect(invalid.en).toContain('Account 4000 cannot be the clearing account');
    expect(usesClearingAccount('journal')).toBe(true);
    expect(usesClearingAccount('receivables')).toBe(true);
    expect(usesClearingAccount('payables')).toBe(true);
    expect(usesClearingAccount('stock')).toBe(false);
  });
  it('AC-39: repeated controls get a section suffix in the separators of the UI language', () => {
    expect(`事前確認${nameSuffix('開始仕訳', 'ja')}`).toBe('事前確認（開始仕訳）');
    expect(`Preview${nameSuffix('Opening journal', 'en')}`).toBe('Preview (Opening journal)');
  });
  it('AC-19 AC-20: only a record with openingBalance true is an opening document (no print, no amend)', () => {
    expect(isOpeningDocument({ openingBalance: true })).toBe(true);
    expect(isOpeningDocument({ openingBalance: false })).toBe(false);
    expect(isOpeningDocument({})).toBe(false);
  });
  it('AC-39: the year option uses the separators of the UI language', () => {
    const year = { code: 'FY2026', startDate: '2026-04-01', endDate: '2027-03-31' };
    expect(yearOptionLabel(year, 'ja')).toBe('FY2026（2026-04-01〜2027-03-31）');
    expect(yearOptionLabel(year, 'en')).toBe('FY2026 (2026-04-01 – 2027-03-31)');
  });
});
