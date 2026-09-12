import { describe, expect, it } from 'vitest';
import type { FieldMeta } from '../api/types.ts';
import { changedFields, changeValueText, decimalMinScale, docstatusLabel, fieldChanges, formatDecimal, formatDecimalInput, formatValue, groupDigits, shortId } from './format.ts';

function field(over: Partial<FieldMeta> & { name: string; kind: string }): FieldMeta {
  return { label: { ja: over.name, en: over.name }, required: false, hasDefault: false, hidden: false, immutable: false, ...over };
}

describe('groupDigits / formatDecimal (ADR-0010: strings only)', () => {
  it('groups thousands without float conversion', () => {
    expect(groupDigits('1234567')).toBe('1,234,567');
    expect(groupDigits('-1234.5')).toBe('-1,234.5');
    expect(groupDigits('12345678901234567890.123456')).toBe('12,345,678,901,234,567,890.123456');
    expect(groupDigits('abc')).toBe('abc');
  });
  // web-phase15 AC-8 (replaces the web-polish rule "never show more than the field scale", which cut 1234.5 to 1,234 once
  // money meta scale became the currency's 0 digits): the minimum digits are padded, significant digits stay up to 6.
  it('AC-8 JPY (minimum 0): trailing zeros go, significant fraction digits stay', () => {
    expect(formatDecimal('150')).toBe('150');
    expect(formatDecimal('33.3', 0)).toBe('33.3');
    expect(formatDecimal('1234.500000', 0)).toBe('1,234.5');
    expect(formatDecimal('100.000000', 0)).toBe('100');
    expect(formatDecimal('1234567.000000', 0)).toBe('1,234,567');
    expect(formatDecimal('1.234567', 0)).toBe('1.234567');
    expect(formatDecimal('-1234.500000', 0)).toBe('-1,234.5');
    expect(formatDecimal('1000', 0)).toBe('1,000');
  });
  it('AC-8 a currency with minor units keeps at least that many digits; at most 6 are shown', () => {
    expect(formatDecimal('100.000000', 2)).toBe('100.00');
    expect(formatDecimal('1234.500000', 2)).toBe('1,234.50');
    expect(formatDecimal('1.234500', 2)).toBe('1.2345');
    expect(formatDecimal('7', 2)).toBe('7.00');
    expect(formatDecimal('7', 3)).toBe('7.000');
    expect(formatDecimal('0.1234567', 0)).toBe('0.123456');
    expect(formatDecimal('10.123456', 2)).toBe('10.123456');
  });
  it('leaves non-decimal text alone and normalises negative zero', () => {
    expect(formatDecimal('abc', 0)).toBe('abc');
    expect(formatDecimal('', 0)).toBe('');
    expect(formatDecimal('-0.000000', 0)).toBe('0');
    expect(formatDecimal('-0.000000', 2)).toBe('0.00');
  });
});

describe('decimalMinScale / formatDecimalInput (web-phase15 AC-4/AC-8)', () => {
  it('money: meta scale wins, storage scale 6 means "unknown" and falls back to the currency; other decimals: 0', () => {
    expect(decimalMinScale({ money: true, scale: 0 }, 2)).toBe(0);
    expect(decimalMinScale({ money: true, scale: 2 }, 0)).toBe(2);
    expect(decimalMinScale({ money: true }, 2)).toBe(2);
    expect(decimalMinScale({ money: true, scale: 6 }, 0)).toBe(0);
    expect(decimalMinScale({ scale: 6 }, 2)).toBe(0); // f.quantity
    expect(decimalMinScale({ scale: 4 }, 2)).toBe(0); // a rate
    expect(decimalMinScale(undefined, 2)).toBe(2); // report column: no field info
  });
  it('inputs follow the display rule unless that would hide typed digits', () => {
    expect(formatDecimalInput('1234.5', 0)).toBe('1,234.5');
    expect(formatDecimalInput('1100', 2)).toBe('1,100.00');
    expect(formatDecimalInput('1.1234567', 0)).toBe('1.1234567');
    expect(formatDecimalInput('1.1234560', 0)).toBe('1.123456');
    expect(formatDecimalInput('12a', 0)).toBe('12a');
  });
});

describe('formatValue (AC-3 cell rendering)', () => {
  it('numbers are right-aligned monospace, bools are marks, enums use valueLabels', () => {
    expect(formatValue(field({ name: 'qty', kind: 'int' }), 1200, 'ja')).toEqual({ text: '1,200', align: 'right', mono: true });
    expect(formatValue(field({ name: 'amt', kind: 'decimal', scale: 6 }), '5.500000', 'ja')).toEqual({ text: '5.5', align: 'right', mono: true });
    // web-phase15 AC-4: the currency's digits apply to money only (FieldMeta.money); a quantity stays '5.5' in USD too
    expect(formatValue(field({ name: 'amt', kind: 'decimal', money: true }), '5.500000', 'ja', { currencyScale: 2 }).text).toBe('5.50');
    expect(formatValue(field({ name: 'amt', kind: 'decimal', money: true, scale: 0 }), '5.500000', 'ja', { currencyScale: 2 }).text).toBe('5.5');
    expect(formatValue(field({ name: 'qty', kind: 'decimal', scale: 6 }), '5.500000', 'ja', { currencyScale: 2 }).text).toBe('5.5');
    expect(formatValue(field({ name: 'amt', kind: 'decimal' }), '1234567.000000', 'ja').text).toBe('1,234,567');
    expect(formatValue(field({ name: 'ok', kind: 'bool' }), true, 'ja').text).toBe('✓');
    expect(formatValue(field({ name: 'ok', kind: 'bool' }), false, 'ja').text).toBe('—');
    const en = field({ name: 'st', kind: 'enum', values: ['a'], valueLabels: { a: { ja: 'あ', en: 'A' } } });
    expect(formatValue(en, 'a', 'ja').text).toBe('あ');
    expect(formatValue(en, 'a', 'en').text).toBe('A');
    expect(formatValue(en, 'zzz', 'en').text).toBe('zzz');
  });
  it('null renders empty; refs use the resolved label or a short id', () => {
    expect(formatValue(field({ name: 'x', kind: 'text' }), null, 'ja').text).toBe('');
    const ref = field({ name: 'partnerId', kind: 'ref', ref: 'partner' });
    expect(formatValue(ref, '0193c5e0-1111-7000-8000-000000000000', 'ja', { refLabel: 'Acme' }).text).toBe('Acme');
    expect(formatValue(ref, '0193c5e0-1111-7000-8000-000000000000', 'ja').text).toBe('0193c5e0…');
  });
});

describe('fieldChanges / changeValueText (AC-6 audit values)', () => {
  it('pairs each changed field with its before/after; create has no before', () => {
    expect(fieldChanges({ before: { total: '100.000000', note: null, version: 1 }, after: { total: '250.000000', note: null, version: 2 } })).toEqual([{ name: 'total', before: '100.000000', after: '250.000000' }]);
    expect(fieldChanges({ before: null, after: { id: '1', name: 'A', version: 1 } })).toEqual([{ name: 'name', before: undefined, after: 'A' }]);
  });
  it('formats values like cells (decimal rule), shows — for empty and cuts long text', () => {
    expect(changeValueText(field({ name: 'total', kind: 'decimal', scale: 6 }), '1234500.000000', 'ja')).toBe('1,234,500');
    expect(changeValueText(field({ name: 'total', kind: 'decimal', money: true, scale: 6 }), '1.500000', 'en', { currencyScale: 2 })).toBe('1.50');
    expect(changeValueText(field({ name: 'note', kind: 'text' }), null, 'ja')).toBe('—');
    expect(changeValueText(undefined, undefined, 'ja')).toBe('—');
    expect(changeValueText(field({ name: 'note', kind: 'text' }), 'x'.repeat(60), 'ja')).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('docstatusLabel (AC-5)', () => {
  it('maps 0/1/2 and falls back to draft', () => {
    expect(docstatusLabel(0).ja).toBe('下書き');
    expect(docstatusLabel(1).en).toBe('Submitted');
    expect(docstatusLabel(2).ja).toBe('取消');
    expect(docstatusLabel(undefined).en).toBe('Draft');
  });
});

describe('changedFields (AC-6)', () => {
  it('create lists written non-null fields, ignoring system noise', () => {
    expect(changedFields({ before: null, after: { id: '1', name: 'A', code: null, version: 1, createdAt: 'x' } })).toEqual(['name']);
  });
  it('update diffs before/after', () => {
    expect(changedFields({ before: { name: 'A', notes: null, version: 1, updatedAt: 'a' }, after: { name: 'B', notes: null, version: 2, updatedAt: 'b' } })).toEqual(['name']);
  });
  it('delete and empty entries yield no fields', () => {
    expect(changedFields({ before: { name: 'A' }, after: null })).toEqual([]);
    expect(changedFields({ before: null, after: null })).toEqual([]);
  });
});

describe('shortId', () => {
  it('shortens uuids only', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('0193c5e0-1111-7000-8000-000000000000')).toBe('0193c5e0…');
  });
});
