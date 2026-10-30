// csv-import (docs/specs/csv-import.md) AC-1/AC-2/AC-3/AC-5/AC-9/AC-10, pure part: eligibility, header resolution and
// cell coercion. The database half (Repository writes, savepoints, refs) is import.db.test.ts.
import { describe, expect, it } from 'vitest';
import type { AnyField } from '../src/dsl/fields.ts';
import {
  coerceCell,
  dateCell,
  decimalCell,
  defaultKeyField,
  headerKey,
  importFields,
  isImportable,
  resolveHeader,
  templateHeaders,
} from '../src/import-values.ts';
import { TMemo, TMemoLine, TPartner } from './fixtures/entities.ts';
import { ImpDup, ImpItem, ImpOptOut, ImpOwned } from './fixtures/import-entities.ts';

const field = (name: string) => ImpItem.config.fields[name as keyof typeof ImpItem.config.fields] as AnyField;
const value = (name: string, raw: string | null | undefined) => coerceCell(field(name), raw);

describe('AC-1: which entities offer import', () => {
  it('AC-1: masters do; documents, their line entities, masters without settable fields and opted-out ones do not', () => {
    expect(isImportable(ImpItem)).toBe(true);
    expect(isImportable(TPartner)).toBe(true);
    expect(isImportable(TMemo)).toBe(false);
    expect(isImportable(TMemoLine)).toBe(false);
    expect(isImportable(ImpOwned)).toBe(false);
    // `import: false` (append-only ledgers, derived tables, upload-only rows) although it has settable fields.
    expect(isImportable(ImpOptOut)).toBe(false);
  });

  it('AC-1/AC-9: importable fields leave out server-owned and json fields, keep hidden ones', () => {
    const names = importFields(ImpItem).map((f) => f.name);
    expect(names).not.toContain('stockNote');
    expect(names).not.toContain('payload');
    expect(names).toContain('internalKey');
    expect(names.slice(0, 4)).toEqual(['code', 'name', 'nameKana', 'categoryId']);
  });
});

describe('AC-3: cell strings become field values', () => {
  it('AC-3: text stays as written; blank and whitespace-only cells are "not given"', () => {
    expect(value('name', ' 株式会社 テスト ')).toEqual({ status: 'value', value: ' 株式会社 テスト ' });
    for (const blank of ['', '   ', '　', null, undefined])
      expect(value('name', blank as string | null)).toEqual({ status: 'empty' });
    expect(value('qty', '')).toEqual({ status: 'empty' });
  });

  it('AC-3: int accepts commas, full-width digits and a sign; rejects fractions and unsafe sizes', () => {
    expect(value('qty', '1,234')).toEqual({ status: 'value', value: 1234 });
    expect(value('qty', '１２３')).toEqual({ status: 'value', value: 123 });
    expect(value('qty', '-7')).toEqual({ status: 'value', value: -7 });
    expect(value('qty', '1.5').status).toBe('invalid');
    expect(value('qty', '9007199254740993').status).toBe('invalid');
    expect(value('qty', 'abc').status).toBe('invalid');
  });

  it('AC-3: decimal yields a canonical decimal string, never a float (commas, full width, signs)', () => {
    expect(value('price', '1,234.50')).toEqual({ status: 'value', value: '1234.50' });
    expect(value('price', '１，２３４．５')).toEqual({ status: 'value', value: '1234.5' });
    expect(value('price', '−0.10')).toEqual({ status: 'value', value: '-0.10' });
    expect(decimalCell('+.5')).toBe('0.5');
    expect(decimalCell('007')).toBe('7');
    expect(decimalCell('3.')).toBe('3');
    // 20 significant digits survive exactly (a JS number would round them).
    expect(decimalCell('12345678901234.123456')).toBe('12345678901234.123456');
    for (const bad of ['1e3', '1.2.3', '.', '-', '¥100', 'NaN']) expect(decimalCell(bad)).toBeUndefined();
  });

  it('AC-3: bool accepts true/false/1/0/yes/no/はい/いいえ in any case and width', () => {
    for (const yes of ['true', 'TRUE', '1', 'yes', 'Yes', 'はい', 'ＴＲＵＥ'])
      expect(value('active', yes)).toEqual({ status: 'value', value: true });
    for (const no of ['false', '0', 'no', 'NO', 'いいえ'])
      expect(value('active', no)).toEqual({ status: 'value', value: false });
    expect(value('active', 'maybe').status).toBe('invalid');
  });

  it('AC-3: date accepts YYYY-MM-DD and YYYY/MM/DD (also unpadded) and rejects impossible days', () => {
    expect(value('since', '2026-04-01')).toEqual({ status: 'value', value: '2026-04-01' });
    expect(value('since', '2026/4/1')).toEqual({ status: 'value', value: '2026-04-01' });
    expect(dateCell('２０２６／１２／３１')).toBe('2026-12-31');
    expect(dateCell('2026-02-30')).toBeUndefined();
    expect(dateCell('01/04/2026')).toBeUndefined();
    expect(dateCell('2026-04-01T00:00')).toBeUndefined();
  });

  it('AC-3: enum accepts the value or its current ja/en label', () => {
    expect(value('grade', 'b')).toEqual({ status: 'value', value: 'b' });
    expect(value('grade', 'B')).toEqual({ status: 'value', value: 'b' });
    expect(value('grade', '並')).toEqual({ status: 'value', value: 'b' });
    expect(value('grade', 'premium')).toEqual({ status: 'value', value: 'a' });
    expect(value('kind', 'service')).toEqual({ status: 'value', value: 'service' });
    expect(value('grade', 'c')).toMatchObject({ status: 'invalid', message: expect.stringContaining('a, b') });
  });

  it('AC-3: ref cells become lookups; uuid and timestamp are validated', () => {
    expect(value('categoryId', ' C1 ')).toEqual({ status: 'lookup', text: 'C1' });
    const id = '0190a5b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b';
    expect(value('ownerId', id.toUpperCase())).toEqual({ status: 'value', value: id });
    expect(value('ownerId', 'not-a-uuid').status).toBe('invalid');
    const at = value('syncedAt', '2026-04-01 09:00:00+09:00');
    expect(at.status === 'value' && (at.value as Date).toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(value('syncedAt', '2026-04-01T09:00').status).toBe('invalid');
  });

  it('AC-3: an impossible date, time or offset in a timestamp is refused, not rolled over (as date cells are)', () => {
    const iso = (raw: string) => {
      const at = value('syncedAt', raw);
      return at.status === 'value' ? (at.value as Date).toISOString() : at.status;
    };
    expect(iso('2026-12-31T23:59:59.999Z')).toBe('2026-12-31T23:59:59.999Z');
    expect(iso('2026-04-01T09:00-0530')).toBe('2026-04-01T14:30:00.000Z');
    expect(iso('2026-04-01T09:00+14:00')).toBe('2026-03-31T19:00:00.000Z');
    // new Date() would give 2026-03-02T00:00Z, 2026-05-01T00:00Z and the next day at 01:00.
    for (const bad of [
      '2026-02-30T09:00:00+09:00',
      '2026-04-31T09:00Z',
      '2026-04-01T25:00+09:00',
      '2026-04-01T24:00Z',
      '2026-04-01T09:60Z',
      '2026-04-01T09:00:60Z',
      '2026-04-01T09:00+09:60',
      '2026-04-01T09:00+15:00',
    ])
      expect(iso(bad), bad).toBe('invalid');
  });
});

describe('AC-2/AC-9: headers name fields by name or label', () => {
  it('AC-2: field names, ja labels and en labels (width, case and spacing insensitive) resolve', () => {
    expect(resolveHeader(ImpItem, 'code')).toEqual({ kind: 'field', field: 'code' });
    expect(resolveHeader(ImpItem, '品目コード')).toEqual({ kind: 'field', field: 'code' });
    expect(resolveHeader(ImpItem, '  ITEM   CODE ')).toEqual({ kind: 'field', field: 'code' });
    expect(resolveHeader(ImpItem, 'ｶﾅ')).toEqual({ kind: 'field', field: 'nameKana' });
    expect(resolveHeader(ImpItem, 'Category')).toEqual({ kind: 'field', field: 'categoryId' });
    expect(headerKey('Ｎａｍｅ')).toBe('name');
  });

  it('AC-9: server-owned, system and ext columns are ignored with a reason; json is unsupported; others unknown', () => {
    expect(resolveHeader(ImpItem, '在庫メモ')).toEqual({ kind: 'ignored', reason: 'server-owned' });
    expect(resolveHeader(ImpItem, 'stockNote')).toEqual({ kind: 'ignored', reason: 'server-owned' });
    for (const system of ['id', 'version', 'createdAt', 'companyId', 'docstatus'])
      expect(resolveHeader(ImpItem, system)).toEqual({ kind: 'ignored', reason: 'system' });
    expect(resolveHeader(ImpItem, 'ext.jan')).toEqual({ kind: 'ignored', reason: 'ext' });
    expect(resolveHeader(ImpItem, 'payload')).toEqual({ kind: 'ignored', reason: 'unsupported' });
    expect(resolveHeader(ImpItem, '存在しない列')).toEqual({ kind: 'unknown' });
    // An output-hidden field is not public: its name reads as an unknown column, not as "server-owned".
    expect(resolveHeader(ImpItem, 'secretToken')).toEqual({ kind: 'unknown' });
  });

  it('AC-2: a label two fields share is ambiguous, but each field name still resolves', () => {
    expect(resolveHeader(ImpDup, '名称')).toEqual({ kind: 'ambiguous', fields: ['first', 'second'] });
    expect(resolveHeader(ImpDup, 'second')).toEqual({ kind: 'field', field: 'second' });
  });
});

describe('AC-5/AC-10: key and template', () => {
  it('AC-5: the default key is the first unique text field', () => {
    expect(defaultKeyField(ImpItem)).toBe('code');
    expect(defaultKeyField(ImpDup)).toBeUndefined();
  });

  it('AC-10: template headers are labels of settable, visible, writable fields; shared labels fall back to names', () => {
    const ja = templateHeaders(ImpItem, 'ja', new Set(['cost']));
    expect(ja).toEqual([
      '品目コード',
      '名称',
      'カナ',
      '分類',
      '単価',
      '数量',
      '有効',
      '開始日',
      '等級',
      '種別',
      '担当者',
      '同期日時',
      '連番',
    ]);
    expect(templateHeaders(ImpItem, 'en', new Set())).toContain('Cost');
    expect(templateHeaders(ImpItem, 'en', new Set())[0]).toBe('Item code');
    expect(templateHeaders(ImpDup, 'ja', new Set())).toEqual(['first', 'second']);
    // Every template header maps back to its field.
    for (const header of ja) expect(resolveHeader(ImpItem, header).kind).toBe('field');
  });
});
