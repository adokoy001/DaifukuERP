// csv-import AC-11/AC-13: importable fields, header auto-mapping, the request rows and the error CSV.
import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta } from '../api/types.ts';
import { csvTable, parseCsv } from './csv-parse.ts';
import {
  autoMapColumns,
  checkMapping,
  errorCsv,
  guardCell,
  importableFields,
  importRows,
  messageText,
  requestBytes,
  unguardCell,
  type ImportResult,
} from './import-map.ts';

const field = (name: string, ja: string, en: string, extra: Partial<FieldMeta> = {}): FieldMeta => ({
  name,
  kind: 'text',
  label: { ja, en },
  required: false,
  hasDefault: false,
  hidden: false,
  immutable: false,
  ...extra,
});

const fields = [
  field('code', '取引先コード', 'Code'),
  field('name', '名称', 'Name', { required: true }),
  field('nameKana', 'カナ名称', 'Name (kana)'),
  field('closingDay', '締め日', 'Closing day', { kind: 'int', required: true, hasDefault: true }),
  field('stockNote', '在庫メモ', 'Stock note', { serverOwned: true, readOnly: true }),
  field('payload', '付加情報', 'Payload', { kind: 'json' }),
];
const entity = { name: 'partner', fields } as unknown as EntityMeta;

describe('AC-11: columns map to fields', () => {
  it('AC-11: importable fields leave out server-owned, read-only and json fields', () => {
    expect(importableFields(entity).map((f) => f.name)).toEqual(['code', 'name', 'nameKana', 'closingDay']);
  });

  it('AC-11: headers map by field name, ja label or en label (width/case/space insensitive); others stay unmapped', () => {
    const usable = importableFields(entity);
    expect(
      autoMapColumns(['取引先コード', ' NAME ', 'ｶﾅ名称', 'closingDay', '在庫メモ', 'id', '備考'], usable),
    ).toEqual(['code', 'name', 'nameKana', 'closingDay', '', '', '']);
    // A field is used once: the second header naming it is left for the user to decide.
    expect(autoMapColumns(['名称', 'Name'], usable)).toEqual(['name', '']);
  });

  it('AC-11: the mapping check reports duplicate fields and required fields without a default', () => {
    const usable = importableFields(entity);
    expect(checkMapping(['code', 'code', ''], usable)).toEqual({
      duplicates: ['code'],
      missingRequired: [usable[1]],
      mapped: 1,
    });
    expect(checkMapping(['code', 'name'], usable).missingRequired).toEqual([]);
  });

  it('AC-11: request rows carry mapped non-blank cells under field names', () => {
    const table = csvTable(parseCsv('取引先コード,名称,備考\nP1,一号,memo\nP2, ,\n'));
    const rows = importRows(table, ['code', 'name', '']);
    expect(rows).toEqual([{ code: 'P1', name: '一号' }, { code: 'P2' }]);
    expect(requestBytes({ rows, mode: 'dry-run', onExisting: 'skip' })).toBe(
      new TextEncoder().encode(JSON.stringify({ rows, mode: 'dry-run', onExisting: 'skip' })).length,
    );
  });

  it("AC-11/AC-13: the formula guard (a leading ' before = + - @) is removed from cells and headers when read", () => {
    const table = csvTable(parseCsv("'=名称,取引先コード\n'=cmd,P1\n'+81-3-1234,P2\n'note,P3\n-5,P4\n"));
    expect(autoMapColumns(table.headers, importableFields(entity))).toEqual(['', 'code']);
    expect(importRows(table, ['name', 'code']).map((r) => r.name)).toEqual(['=cmd', '+81-3-1234', "'note", '-5']);
    // guardCell writes what unguardCell reads back; plain numbers and other text are left alone.
    for (const raw of ['=SUM(A1)', ' +1', '@x', '-x', '-5', '+1.5', 'text', "'quoted", '', '\u0001=cmd'])
      expect(unguardCell(guardCell(raw)), raw).toBe(raw);
    expect([guardCell('=1+1'), guardCell('-5'), guardCell('-x'), guardCell("'=x"), guardCell('\u0001=x')]).toEqual([
      "'=1+1",
      '-5',
      "'-x",
      "'=x",
      "'\u0001=x",
    ]);
  });
});

describe('AC-13: error CSV', () => {
  const table = csvTable(parseCsv('取引先コード,名称,締め日\nP1,一号,20\n\nP2,二号,99\nP3,"=cmd",x\n'));
  const result: ImportResult = {
    mode: 'execute',
    committed: true,
    keyField: 'code',
    summary: { created: 1, updated: 0, skipped: 0, errors: 2 },
    rows: [
      { line: 1, status: 'created', id: '0190a5b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b' },
      { line: 2, status: 'error', messages: [{ code: 'VALIDATION', field: 'closingDay', message: 'Too big: <=31' }] },
      {
        line: 3,
        status: 'error',
        messages: [
          { code: 'invalid_value', field: 'closingDay', column: '締め日', message: '"x" is not an integer' },
          { code: 'exists', field: 'code', message: '=SUM(A1)' },
        ],
      },
    ],
    notices: [],
  };
  const labels = { line: { ja: '行', en: 'Line' }, reason: { ja: '理由', en: 'Reason' } };

  it('AC-13: failed rows keep their original cells (formula-guarded), then the file row number and localized reasons', () => {
    const csv = errorCsv(table, result, fields, 'ja', labels);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '取引先コード,名称,締め日,行,理由',
      'P2,二号,99,3,締め日: 入力内容を確認してください。 (Too big: <=31)',
      `P3,'=cmd,x,4,"締め日: 値の形式が正しくありません (""x"" is not an integer) / 取引先コード: 同じキーの記録が既にあります (=SUM(A1))"`,
      '',
    ]);
    expect(errorCsv(table, result, fields, 'en', labels).split('\r\n')[0]).toBe(
      '\uFEFF取引先コード,名称,締め日,Line,Reason',
    );
  });

  it('AC-13: a reason that would start a spreadsheet formula is neutralised; messages read in the locale', () => {
    const csv = errorCsv(
      table,
      { ...result, rows: [{ line: 1, status: 'error', messages: [{ code: 'X', message: '=1+1' }] }] },
      fields,
      'ja',
      labels,
    );
    expect(csv.split('\r\n')[1]).toBe("P1,一号,20,1,'=1+1");
    expect(messageText({ code: 'ref_not_found', field: 'code', message: 'no uom' }, fields, 'en')).toBe(
      'Code: Referenced record not found (no uom)',
    );
  });

  it('AC-8/AC-14: the database code and kernel codes read in the locale too; unknown codes keep the server text', () => {
    const sql = { code: 'database', message: 'the database rejected the row (SQLSTATE 23514)' };
    expect(messageText(sql, fields, 'ja')).toBe(
      'データベースが行を受け付けませんでした (the database rejected the row (SQLSTATE 23514))',
    );
    expect(messageText({ code: 'CONFLICT', message: 'duplicate code' }, fields, 'ja')).toBe(
      '他の更新と競合しました。最新の内容を読み込んでから、もう一度お試しください。 (duplicate code)',
    );
    expect(messageText({ code: 'INVALID_STATE', field: 'name', message: 'locked' }, fields, 'en')).toBe(
      'Name: This cannot be done in the current state. (locked)',
    );
    expect(messageText({ code: 'SOMETHING_NEW', message: 'as sent' }, fields, 'ja')).toBe('as sent');
  });
});
