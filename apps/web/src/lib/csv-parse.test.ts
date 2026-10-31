// csv-import AC-11: decoding (UTF-8 / BOM / Shift_JIS) and RFC 4180 parsing of the chosen file.
import { describe, expect, it } from 'vitest';
import { CsvParseError, csvTable, decodeCsvBytes, parseCsv } from './csv-parse.ts';

const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

describe('AC-11: file bytes to text', () => {
  it('AC-11: UTF-8 with a BOM, UTF-8 without one, and Shift_JIS are told apart', () => {
    const utf8 = new TextEncoder().encode('コード,名称\r\nA1,品目\r\n');
    expect(decodeCsvBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]))).toEqual({
      text: 'コード,名称\r\nA1,品目\r\n',
      encoding: 'utf-8-bom',
    });
    expect(decodeCsvBytes(utf8)).toEqual({ text: 'コード,名称\r\nA1,品目\r\n', encoding: 'utf-8' });
    // "コード,名称\r\nA1,品目\r\n" as Excel ja-JP writes it (cp932).
    const sjis = hex('8352815b83682c96bc8fcc0d0a41312c956996da0d0a');
    expect(decodeCsvBytes(sjis)).toEqual({ text: 'コード,名称\r\nA1,品目\r\n', encoding: 'shift_jis' });
    // Half-width katakana is a single Shift_JIS byte.
    expect(decodeCsvBytes(hex('c3bdc4')).text).toBe('ﾃｽﾄ');
    expect(decodeCsvBytes(new TextEncoder().encode('code,name\n')).encoding).toBe('utf-8');
  });
});

describe('AC-11: RFC 4180 records', () => {
  it('AC-11: quoted cells keep commas, doubled quotes and line breaks; CRLF, LF and CR end records', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\r\nline",z\n1,2\r3,4')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\r\nline', 'z'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('AC-11: a final line break adds no record; empty cells and a trailing comma are kept; BOM is dropped', () => {
    expect(parseCsv('\uFEFFa,b,\n,,\n')).toEqual([
      ['a', 'b', ''],
      ['', '', ''],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('"",x')).toEqual([['', 'x']]);
  });

  it('AC-11: a quote inside an unquoted cell is literal; an unterminated quote reports its line', () => {
    expect(parseCsv('5" pipe,ok')).toEqual([['5" pipe', 'ok']]);
    const failure = (() => {
      try {
        parseCsv('a,b\n1,"open\nstill open');
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(failure).toBeInstanceOf(CsvParseError);
    expect((failure as CsvParseError).line).toBe(2);
  });

  it('AC-11: the first non-blank record is the header; blank records are dropped but counted in line numbers', () => {
    const table = csvTable(parseCsv('\n コード ,名称\nA1,品目1\n,\nA2\n'));
    expect(table).toEqual({
      headers: ['コード', '名称'],
      rows: [
        ['A1', '品目1'],
        ['A2', ''],
      ],
      lines: [1, 3],
      wide: [],
    });
    expect(csvTable([])).toEqual({ headers: [], rows: [], lines: [], wide: [] });
  });

  it('AC-11: records with a non-blank cell past the header (an unquoted comma) are reported by data row number', () => {
    const table = csvTable(
      parseCsv('code,name,kana\r\nP1,ACME, Inc,ｱｸﾒ\r\nP2,Short\r\n\r\nP3,"ACME, Inc",ｱｸﾒ,\r\nP4,a,b,c\r\n'),
    );
    // P1's 4th cell would otherwise vanish and " Inc" would land in kana; a trailing comma (P3) is harmless.
    expect(table.wide).toEqual([1, 5]);
    expect(table.lines).toEqual([1, 2, 4, 5]);
    expect(table.rows[2]).toEqual(['P3', 'ACME, Inc', 'ｱｸﾒ']);
  });

  it('AC-11: a shifted record whose last value is blank is reported when it is wider than the file usually is', () => {
    // " Inc." would silently land in phone: the record has one blank cell more than the other records.
    const shifted = csvTable(parseCsv('code,name,phone\r\nP1,Daifuku, Inc.,\r\nP2,Mochi,03-1234\r\nP3,Dango,06-1\r\n'));
    expect(shifted.wide).toEqual([1]);
    // Written with a trailing comma on every record: the usual width is one more than the header's.
    const trailing = csvTable(parseCsv('code,name,phone\r\nP1,Mochi,03,\r\nP2,Dango,06,\r\nP3,Daifuku, Inc.,,\r\n'));
    expect(trailing.wide).toEqual([3]);
    expect(trailing.rows[0]).toEqual(['P1', 'Mochi', '03']);
  });
});
