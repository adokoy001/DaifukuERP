import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal, isDecimal, ROUNDING_MODES, type RoundingMode } from '../src/decimal.ts';

function scaled(value: bigint, scale: number): string {
  const sign = value < 0n ? '-' : '';
  const text = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  return scale === 0 ? sign + text : sign + text.slice(0, -scale) + '.' + text.slice(-scale);
}

// Independent integer oracle: the input is thousandths, never a binary float amount.
function roundThousandths(value: bigint, scale: number, mode: RoundingMode): string {
  const magnitude = value < 0n ? -value : value;
  const divisor = 10n ** BigInt(3 - scale),
    remainder = magnitude % divisor;
  const increment = mode === 'up' ? remainder > 0n : mode === 'half_up' ? remainder * 2n >= divisor : false;
  const rounded = magnitude / divisor + (increment ? 1n : 0n);
  return scaled(value < 0n ? -rounded : rounded, scale);
}

describe('AC-6 independent Decimal amount/quantity references', () => {
  it('orders exact micro-units including equality and signs against BigInt', () => {
    const units = fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n });
    fc.assert(
      fc.property(units, units, (a, b) => {
        const left = Decimal.from(scaled(a, 6)),
          right = Decimal.from(scaled(b, 6));
        for (const [value, integer] of [
          [right, b],
          [left, a],
        ] as const) {
          expect(left.cmp(value)).toBe(a < integer ? -1 : a > integer ? 1 : 0);
          expect(left.eq(value)).toBe(a === integer);
          expect(left.lt(value)).toBe(a < integer);
          expect(left.lte(value)).toBe(a <= integer);
          expect(left.gt(value)).toBe(a > integer);
          expect(left.gte(value)).toBe(a >= integer);
        }
        expect(left.isZero()).toBe(a === 0n);
        expect(left.isNegative()).toBe(a < 0n);
        expect(left.abs().eq(scaled(a < 0n ? -a : a, 6))).toBe(true);
        expect(left.neg().eq(scaled(-a, 6))).toBe(true);
        expect(left.times(right).eq(scaled(a * b, 12))).toBe(true);
      }),
      { seed: 930601, numRuns: 200 },
    );
  });

  it('rounds positive and negative amounts at every selected boundary using integer division', () => {
    const cases = [-1501n, -1500n, -1499n, -1n, 0n, 1n, 1499n, 1500n, 1501n];
    const check = (value: bigint) => {
      const decimal = Decimal.from(scaled(value, 3));
      for (const scale of [0, 1, 2, 3])
        for (const mode of ['half_up', 'down', 'up'] as const) {
          expect(decimal.round(mode, scale).eq(roundThousandths(value, scale, mode))).toBe(true);
        }
    };
    cases.forEach(check);
    fc.assert(fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), check), { seed: 930602, numRuns: 150 });
  });

  it('divides exact scaled integer amounts and rejects a zero divisor', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -10000000n, max: 10000000n }), fc.bigInt({ min: 1n, max: 10000n }), (a, b) => {
        expect(
          Decimal.from(scaled(a * b, 4))
            .div(b)
            .eq(scaled(a, 4)),
        ).toBe(true);
      }),
      { seed: 930603, numRuns: 100 },
    );
    expect(() => Decimal.from('12').div('0')).toThrow('division by zero');
    expect(() => Decimal.zero().div('-0')).toThrow(RangeError);
  });

  it('preserves wire amounts, type identity and presentation without accepting malformed input', () => {
    expect(ROUNDING_MODES).toEqual(['half_up', 'down', 'up']);
    const value = Decimal.from('12.3');
    expect(Decimal.from(value)).toBe(value);
    expect(Decimal.from(123n).toString()).toBe('123');
    expect(Decimal.from(' 12.30 ').toString()).toBe('12.3');
    expect(Decimal.isDecimalString(' 12.30 ')).toBe(true);
    for (const text of ['', '1e3', '+1', '1.2.3', '1x', '--1']) {
      expect(Decimal.isDecimalString(text)).toBe(false);
      expect(() => Decimal.from(text)).toThrow('not a decimal string');
    }
    expect(value.toFixed(2)).toBe('12.30');
    expect(value.toNumberUnsafe()).toBe(12.3);
    expect(value.toJSON()).toBe('12.3');
    expect(isDecimal(value)).toBe(true);
    expect(isDecimal({ value: '12.3' })).toBe(false);
    expect(Decimal.sum([]).toString()).toBe('0');
    expect(Decimal.zero().isZero()).toBe(true);
  });
});
