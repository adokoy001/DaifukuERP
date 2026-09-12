import { describe, expect, it } from 'vitest';
import { addDecimalStrings, compareDecimalStrings, isDecimalString, minDecimalString, parseDecimalString, subtractDecimalStrings, sumDecimalStrings } from './decimal.ts';

describe('web-phase15 AC-2 subtraction / comparison (no floats)', () => {
  it('subtracts exactly across scales and signs', () => {
    expect(subtractDecimalStrings('1100', '1100')).toBe('0');
    expect(subtractDecimalStrings('1000', '1100.5')).toBe('-100.5');
    expect(subtractDecimalStrings('0.3', '0.1')).toBe('0.2');
    expect(subtractDecimalStrings('5', '-2.25')).toBe('7.25');
    expect(subtractDecimalStrings('-1', '-1')).toBe('0');
    expect(subtractDecimalStrings('12345678901234567890.000001', '0.000002')).toBe('12345678901234567889.999999');
    expect(subtractDecimalStrings('', '1')).toBeUndefined();
    expect(subtractDecimalStrings('1', 'x')).toBeUndefined();
  });

  it('compares by value, not by text', () => {
    expect(compareDecimalStrings('1100', '1100.000000')).toBe(0);
    expect(compareDecimalStrings('999.999999', '1000')).toBe(-1);
    expect(compareDecimalStrings('10', '9.5')).toBe(1);
    expect(compareDecimalStrings('-0.5', '0')).toBe(-1);
    expect(compareDecimalStrings('abc', '1')).toBeUndefined();
    expect(minDecimalString('1100', '600.5')).toBe('600.5');
    expect(minDecimalString('3', '3.0')).toBe('3');
    expect(minDecimalString('3', '')).toBeUndefined();
  });
});

describe('AC-2 decimal-string sums (no floats)', () => {
  it('adds with differing scales exactly', () => {
    expect(addDecimalStrings('0.1', '0.2')).toBe('0.3'); // the float classic
    expect(addDecimalStrings('100', '0.005')).toBe('100.005');
    expect(addDecimalStrings('1.50', '2.5')).toBe('4');
  });

  it('handles signs, zero and empty results', () => {
    expect(sumDecimalStrings(['10', '-4.25'])).toBe('5.75');
    expect(sumDecimalStrings(['-1', '1'])).toBe('0');
    expect(sumDecimalStrings(['-0.5', '-0.5'])).toBe('-1');
    expect(sumDecimalStrings([])).toBe('0');
    expect(sumDecimalStrings(['', 'abc', '  '])).toBe('0');
  });

  it('ignores invalid entries and keeps large values exact', () => {
    expect(sumDecimalStrings(['12345678901234567890.123456', '0.000001', 'x'])).toBe('12345678901234567890.123457');
    expect(sumDecimalStrings(['1e3', '1'])).toBe('1'); // exponent notation is not a decimal string here
  });

  it('parses leading-dot, trailing-dot and plus-sign forms', () => {
    expect(parseDecimalString('.5')).toEqual({ neg: false, int: '0', frac: '5' });
    expect(parseDecimalString('7.')).toEqual({ neg: false, int: '7', frac: '' });
    expect(parseDecimalString('+3')).toEqual({ neg: false, int: '3', frac: '' });
    expect(isDecimalString('.')).toBe(false);
    expect(isDecimalString('-')).toBe(false);
    expect(isDecimalString('1,000')).toBe(false);
  });
});
