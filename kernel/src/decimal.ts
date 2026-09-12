// Money and quantities (ADR-0010). Wraps decimal.js so modules never touch floats.
import { Decimal as DecimalJs } from 'decimal.js';

DecimalJs.set({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });

export type DecimalInput = Decimal | string | number | bigint;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export class Decimal {
  private constructor(private readonly v: DecimalJs) {}

  /** Accepts a decimal string ("1234.50"), an integer, a bigint, or another Decimal. Non-integer JS numbers are rejected. */
  static from(input: DecimalInput): Decimal {
    if (input instanceof Decimal) return input;
    if (typeof input === 'bigint') return new Decimal(new DecimalJs(input.toString()));
    if (typeof input === 'number') {
      if (!Number.isInteger(input)) {
        throw new TypeError(`Decimal.from: non-integer number ${input} is not allowed (ADR-0010). Pass a string.`);
      }
      return new Decimal(new DecimalJs(input));
    }
    const s = input.trim();
    if (!DECIMAL_STRING.test(s)) throw new TypeError(`Decimal.from: "${input}" is not a decimal string`);
    return new Decimal(new DecimalJs(s));
  }

  static zero(): Decimal {
    return new Decimal(new DecimalJs(0));
  }

  static isDecimalString(s: string): boolean {
    return DECIMAL_STRING.test(s.trim());
  }

  static sum(values: Iterable<Decimal>): Decimal {
    let acc = new DecimalJs(0);
    for (const d of values) acc = acc.plus(d.v);
    return new Decimal(acc);
  }

  plus(o: DecimalInput): Decimal {
    return new Decimal(this.v.plus(Decimal.from(o).v));
  }
  minus(o: DecimalInput): Decimal {
    return new Decimal(this.v.minus(Decimal.from(o).v));
  }
  times(o: DecimalInput): Decimal {
    return new Decimal(this.v.times(Decimal.from(o).v));
  }
  div(o: DecimalInput): Decimal {
    const d = Decimal.from(o);
    if (d.isZero()) throw new RangeError('Decimal.div: division by zero');
    return new Decimal(this.v.div(d.v));
  }
  neg(): Decimal {
    return new Decimal(this.v.neg());
  }
  abs(): Decimal {
    return new Decimal(this.v.abs());
  }

  cmp(o: DecimalInput): -1 | 0 | 1 {
    return this.v.cmp(Decimal.from(o).v) as -1 | 0 | 1;
  }
  eq(o: DecimalInput): boolean {
    return this.cmp(o) === 0;
  }
  lt(o: DecimalInput): boolean {
    return this.cmp(o) < 0;
  }
  lte(o: DecimalInput): boolean {
    return this.cmp(o) <= 0;
  }
  gt(o: DecimalInput): boolean {
    return this.cmp(o) > 0;
  }
  gte(o: DecimalInput): boolean {
    return this.cmp(o) >= 0;
  }
  isZero(): boolean {
    return this.v.isZero();
  }
  isNegative(): boolean {
    return this.v.isNegative();
  }

  /** Round half away from zero (四捨五入) to `scale` decimal places. */
  roundHalfUp(scale: number): Decimal {
    return new Decimal(this.v.toDecimalPlaces(scale, DecimalJs.ROUND_HALF_UP));
  }
  /** Round toward zero (切捨て). */
  roundDown(scale: number): Decimal {
    return new Decimal(this.v.toDecimalPlaces(scale, DecimalJs.ROUND_DOWN));
  }
  /** Round away from zero (切上げ). */
  roundUp(scale: number): Decimal {
    return new Decimal(this.v.toDecimalPlaces(scale, DecimalJs.ROUND_UP));
  }
  round(mode: RoundingMode, scale: number): Decimal {
    switch (mode) {
      case 'half_up':
        return this.roundHalfUp(scale);
      case 'down':
        return this.roundDown(scale);
      case 'up':
        return this.roundUp(scale);
    }
  }

  /** Canonical string: no exponent, no trailing zeros beyond the value's own scale. Used for DB and JSON. */
  toString(): string {
    return this.v.toFixed();
  }
  toFixed(scale: number): string {
    return this.v.toFixed(scale);
  }
  toJSON(): string {
    return this.toString();
  }
  /** Only for display/statistics. Never feed the result back into calculations. */
  toNumberUnsafe(): number {
    return this.v.toNumber();
  }
}

export type RoundingMode = 'half_up' | 'down' | 'up';
export const ROUNDING_MODES: readonly RoundingMode[] = ['half_up', 'down', 'up'];

export function isDecimal(x: unknown): x is Decimal {
  return x instanceof Decimal;
}
