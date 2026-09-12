import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/decimal.ts';

const decStr = fc.tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 18n }), fc.nat({ max: 999999 })).map(([neg, int, frac]) => `${neg ? '-' : ''}${int}.${String(frac).padStart(6, '0')}`);

describe('Decimal (ADR-0010)', () => {
  it('rejects floats and accepts decimal strings', () => {
    expect(() => Decimal.from(0.1)).toThrow(/non-integer/);
    expect(Decimal.from('0.1').plus('0.2').toString()).toBe('0.3');
    expect(Decimal.from(100).toString()).toBe('100');
    expect(() => Decimal.from('1e5')).toThrow();
  });

  it('rounds like Japanese tax practice: 四捨五入 / 切捨て / 切上げ', () => {
    expect(Decimal.from('123.5').roundHalfUp(0).toString()).toBe('124');
    expect(Decimal.from('123.4').roundHalfUp(0).toString()).toBe('123');
    expect(Decimal.from('123.9').roundDown(0).toString()).toBe('123');
    expect(Decimal.from('123.1').roundUp(0).toString()).toBe('124');
    expect(Decimal.from('-2.5').roundHalfUp(0).toString()).toBe('-3');
  });

  it('property: a + b - b == a and sum is associative', () => {
    fc.assert(
      fc.property(decStr, decStr, (a, b) => {
        const da = Decimal.from(a);
        const db = Decimal.from(b);
        expect(da.plus(db).minus(db).eq(da)).toBe(true);
      }),
    );
    fc.assert(
      fc.property(fc.array(decStr, { maxLength: 20 }), (xs) => {
        const ds = xs.map((x) => Decimal.from(x));
        const left = Decimal.sum(ds);
        const right = ds.reduceRight((acc, d) => acc.plus(d), Decimal.zero());
        expect(left.eq(right)).toBe(true);
      }),
    );
  });

  it('property: toString round-trips', () => {
    fc.assert(
      fc.property(decStr, (s) => {
        const d = Decimal.from(s);
        expect(Decimal.from(d.toString()).eq(d)).toBe(true);
      }),
    );
  });

  it('serialises as a string in JSON', () => {
    expect(JSON.stringify({ x: Decimal.from('12.50') })).toBe('{"x":"12.5"}');
  });
});
