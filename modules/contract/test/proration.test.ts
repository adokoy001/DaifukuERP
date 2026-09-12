// Proration (日割り) and the period plan of the contract module (docs/specs/contract.md AC-3, AC-7): factors as exact
// fractions, the pre-rounded invoice unit price, and fast-check properties. Properties actually checked:
//  P1 a daily month factor is in (0, 1] for every month from the start month to the end month, 0 outside, and exactly 1
//     for a month fully inside [startDate, endDate];
//  P2 Σ over consecutive months (start month .. end month) of factor × days-in-month = the inclusive day count
//     endDate − startDate + 1 (Date.UTC oracle) — the day-weighted factors add up to the contract's days;
//  P3 a k-month billing period's factor is the sum of its month factors and lies in [0, k];
//  P4 rounding: down <= exact < down + 1 unit, up >= exact > up − 1 unit, |half_up − exact| <= 0.5 unit (non-negative
//     prices), and a full month (factor 1) leaves a price already at the currency scale unchanged.
import { Decimal, ValidationError } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMonths, daysInPeriod, periodOf } from '../src/services/periods.ts';
import { planPeriod, type ContractTerms, type TermLine } from '../src/services/plan.ts';
import { addFractions, coveredDays, formatFraction, fraction, monthFactor, ONE, periodFactor, prorate, ZERO, type Fraction } from '../src/services/proration.ts';

const DAY = 86_400_000;
const EPOCH_2000 = Date.UTC(2000, 0, 1) / DAY;
const dateOf = (epochDay: number) => new Date(epochDay * DAY).toISOString().slice(0, 10);
const epochOf = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY;
/** start <= end within ~4 years, 2000..2100 */
const rangeArb = fc.tuple(fc.integer({ min: EPOCH_2000, max: EPOCH_2000 + 36_000 }), fc.integer({ min: 0, max: 1500 })).map(([s, len]) => ({ start: dateOf(s), end: dateOf(s + len) }));
const exact = (price: Decimal, f: Fraction) => price.times(f.num).div(f.den);
const money = (s: string) => Decimal.from(s);

describe('factor (AC-3)', () => {
  it('fractions reduce; sums are exact', () => {
    expect(fraction(15, 30)).toEqual({ num: 1, den: 2 });
    expect(fraction(0, 31)).toEqual(ZERO);
    expect(addFractions(fraction(10, 31), fraction(20, 30))).toEqual({ num: 92, den: 93 });
    expect([formatFraction(fraction(10, 31)), formatFraction(ONE), formatFraction(fraction(6, 2))]).toEqual(['10/31', '1', '3']);
    expect(() => fraction(1, 0)).toThrow(ValidationError);
    expect(() => fraction(-1, 3)).toThrow(ValidationError);
  });

  it('daily: covered days / days of the month (start and end inclusive); none: 1 for any covered month', () => {
    expect(coveredDays('2026-05', '2026-05-22', null)).toBe(10);
    expect(monthFactor('2026-05', '2026-05-22', null, 'daily')).toEqual({ num: 10, den: 31 });
    expect(monthFactor('2026-09', '2026-01-01', '2026-09-15', 'daily')).toEqual({ num: 1, den: 2 });
    expect(monthFactor('2026-02', '2026-02-10', null, 'daily')).toEqual({ num: 19, den: 28 });
    expect(monthFactor('2026-06', '2026-05-22', null, 'daily')).toEqual(ONE);
    expect(monthFactor('2026-05', '2026-05-31', '2026-05-31', 'daily')).toEqual({ num: 1, den: 31 });
    expect(monthFactor('2026-04', '2026-05-22', null, 'daily')).toEqual(ZERO);
    expect(monthFactor('2026-10', '2026-05-22', '2026-09-30', 'daily')).toEqual(ZERO);
    expect(monthFactor('2026-05', '2026-05-22', null, 'none')).toEqual(ONE);
    expect(monthFactor('2026-04', '2026-05-22', null, 'none')).toEqual(ZERO);
  });

  it('a k-month billing period sums its months', () => {
    expect(periodFactor('2026-04', 3, '2026-04-01', null, 'daily')).toEqual({ num: 3, den: 1 });
    expect(periodFactor('2026-04', 3, '2026-04-16', null, 'daily')).toEqual({ num: 5, den: 2 }); // 15/30 + 1 + 1
    expect(periodFactor('2026-04', 3, '2026-04-01', '2026-05-31', 'daily')).toEqual({ num: 2, den: 1 });
    expect(periodFactor('2026-04', 3, '2026-04-16', '2026-05-31', 'none')).toEqual({ num: 2, den: 1 });
  });

  it('P1: daily factor in (0,1] inside the contract months, 1 for fully covered months, 0 outside', () => {
    fc.assert(
      fc.property(rangeArb, fc.boolean(), ({ start, end }, openEnded) => {
        const endDate = openEnded ? null : end;
        const first = periodOf(start);
        const last = periodOf(end);
        for (let p = addMonths(first, -1); p <= addMonths(last, 1); p = addMonths(p, 1)) {
          const f = monthFactor(p, start, endDate, 'daily');
          const inside = p >= first && (endDate === null || p <= last);
          if (!inside) {
            expect(f).toEqual(ZERO);
            continue;
          }
          expect(f.num).toBeGreaterThan(0);
          expect(f.num).toBeLessThanOrEqual(f.den);
          const full = start <= `${p}-01` && (endDate === null || endDate >= `${p}-${daysInPeriod(p)}`);
          expect(f.num === f.den).toBe(full);
        }
      }),
    );
  });

  it('P2: Σ factor × days-in-month over the months from start to end = inclusive day count', () => {
    fc.assert(
      fc.property(rangeArb, ({ start, end }) => {
        let dayWeighted = ZERO;
        let covered = 0;
        for (let p = periodOf(start); p <= periodOf(end); p = addMonths(p, 1)) {
          const f = monthFactor(p, start, end, 'daily');
          dayWeighted = addFractions(dayWeighted, fraction(f.num * daysInPeriod(p), f.den));
          covered += coveredDays(p, start, end);
        }
        const total = epochOf(end) - epochOf(start) + 1;
        expect(dayWeighted).toEqual({ num: total, den: 1 });
        expect(covered).toBe(total);
      }),
    );
  });

  it('P3: period factor = Σ month factors, within [0, k]', () => {
    fc.assert(
      fc.property(rangeArb, fc.integer({ min: 1, max: 12 }), fc.integer({ min: -3, max: 60 }), fc.constantFrom('daily' as const, 'none' as const), ({ start, end }, k, offset, rule) => {
        const p = addMonths(periodOf(start), offset);
        const f = periodFactor(p, k, start, end, rule);
        let sum = ZERO;
        for (let i = 0; i < k; i++) sum = addFractions(sum, monthFactor(addMonths(p, i), start, end, rule));
        expect(f).toEqual(sum);
        expect(f.num).toBeLessThanOrEqual(k * f.den);
      }),
    );
  });
});

describe('pre-rounded unit price (AC-3)', () => {
  it('AC-3 example: 100,000 × 10/31 = 32,258.064516… → down 32,258 (half_up 32,258, up 32,259)', () => {
    const f = fraction(10, 31);
    expect(exact(money('100000'), f).toFixed(6)).toBe('32258.064516');
    expect(prorate(money('100000'), f, 'down', 0).toString()).toBe('32258');
    expect(prorate(money('100000'), f, 'half_up', 0).toString()).toBe('32258');
    expect(prorate(money('100000'), f, 'up', 0).toString()).toBe('32259');
  });

  it('exact results stay exact in every mode; other scales and negative prices', () => {
    expect(['down', 'half_up', 'up'].map((m) => prorate(money('31000'), fraction(10, 31), m as 'down', 0).toString())).toEqual(['10000', '10000', '10000']);
    expect(['down', 'half_up', 'up'].map((m) => prorate(money('50000'), fraction(15, 30), m as 'down', 0).toString())).toEqual(['25000', '25000', '25000']);
    expect(['down', 'half_up', 'up'].map((m) => prorate(money('100000'), fraction(19, 28), m as 'down', 0).toString())).toEqual(['67857', '67857', '67858']);
    expect(['down', 'half_up', 'up'].map((m) => prorate(money('1000'), fraction(10, 30), m as 'down', 2).toString())).toEqual(['333.33', '333.33', '333.34']);
    expect(prorate(money('15500'), fraction(1, 2), 'half_up', 0).toString()).toBe('7750');
    expect(prorate(money('15501'), fraction(1, 2), 'half_up', 0).toString()).toBe('7751'); // 7750.5 → 7751
    expect(prorate(money('15501'), fraction(1, 2), 'down', 0).toString()).toBe('7750');
    expect(prorate(money('-5000'), fraction(10, 31), 'down', 0).toString()).toBe('-1612'); // toward zero
    expect(prorate(money('-5000'), fraction(10, 31), 'up', 0).toString()).toBe('-1613');
    expect(prorate(money('10000'), fraction(3, 1), 'down', 0).toString()).toBe('30000');
  });

  it('P4: rounding bounds per mode; factor 1 keeps a price already at the scale', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 100_000_000_00n }), fc.integer({ min: 1, max: 31 }), fc.integer({ min: 28, max: 31 }), fc.constantFrom(0, 2), (cents, d, dim, scale) => {
        const price = Decimal.from(cents).div(100).roundDown(scale);
        const f = fraction(Math.min(d, dim), dim);
        const unit = Decimal.from(1).div(10 ** scale);
        const x = exact(price, f);
        const down = prorate(price, f, 'down', scale);
        const up = prorate(price, f, 'up', scale);
        const half = prorate(price, f, 'half_up', scale);
        expect(down.lte(x) && x.lt(down.plus(unit))).toBe(true);
        expect(up.gte(x) && x.gt(up.minus(unit))).toBe(true);
        expect(half.minus(x).abs().lte(unit.div(2))).toBe(true);
        expect(down.lte(half) && half.lte(up)).toBe(true);
        expect(prorate(price, ONE, 'up', scale).eq(price)).toBe(true);
      }),
    );
  });
});

describe('period plan (AC-3 lines, AC-5 expected amount)', () => {
  const base: ContractTerms = { status: 'active', startDate: '2026-05-22', endDate: null, intervalMonths: 1, billingDay: 27, billingTiming: 'advance', prorationRule: 'daily', roundingMode: 'down' };
  const lines: TermLine[] = [
    { seq: 1, productId: null, description: '賃料', quantity: money('1'), unitPrice: money('100000'), taxCategory: 'standard' },
    { seq: 2, productId: null, description: '住宅家賃', quantity: money('1'), unitPrice: money('50000'), taxCategory: 'non_taxable' },
    { seq: 3, productId: null, description: '駐輪場', quantity: money('2'), unitPrice: money('1500'), taxCategory: 'standard' },
  ];
  const view = (plan: ReturnType<typeof planPeriod>) => ({ status: plan.status, reason: plan.reason, date: plan.billingDate, factor: formatFraction(plan.factor), subtotal: plan.subtotal.toString(), lines: plan.lines.map((l) => [l.seq, l.quantity.toString(), l.unitPrice.toString(), l.amount.toString(), l.taxCategory]) });

  it('start month prorated, full month, generated, not due', () => {
    // 100,000 × 10/31 = 32,258.06 → 32,258; 50,000 × 10/31 = 16,129.03 → 16,129; 1,500 × 10/31 = 483.87 → 483 (× 2)
    expect(view(planPeriod({ terms: base, lines, period: '2026-05', alreadyGenerated: false, scale: 0 }))).toEqual({
      status: 'due',
      reason: null,
      date: '2026-05-27',
      factor: '10/31',
      subtotal: '49353',
      lines: [
        [1, '1', '32258', '32258', 'standard'],
        [2, '1', '16129', '16129', 'non_taxable'],
        [3, '2', '483', '966', 'standard'],
      ],
    });
    expect(view(planPeriod({ terms: base, lines, period: '2026-06', alreadyGenerated: false, scale: 0 }))).toMatchObject({ status: 'due', factor: '1', subtotal: '153000', date: '2026-06-27' });
    expect(view(planPeriod({ terms: base, lines, period: '2026-06', alreadyGenerated: true, scale: 0 }))).toMatchObject({ status: 'generated', reason: 'already_generated', subtotal: '153000', date: '2026-06-27' });
    expect(view(planPeriod({ terms: base, lines, period: '2026-04', alreadyGenerated: false, scale: 0 }))).toEqual({ status: 'not_due', reason: 'not_started', date: null, factor: '0', subtotal: '0', lines: [] });
    // end month to endDate, arrears date in the next month
    const ending = { ...base, endDate: '2026-08-15', billingTiming: 'arrears' as const, billingDay: 31 };
    expect(view(planPeriod({ terms: ending, lines: lines.slice(0, 1), period: '2026-08', alreadyGenerated: false, scale: 0 }))).toMatchObject({ status: 'due', date: '2026-09-30', factor: '15/31', subtotal: '48387' });
  });

  it('a line prorated to 0 is left off; nothing left → not_due zero_amount', () => {
    const tiny: TermLine[] = [{ seq: 1, productId: null, description: '少額', quantity: money('1'), unitPrice: money('30'), taxCategory: 'standard' }];
    const lastDay = { ...base, startDate: '2026-05-31' }; // 30 × 1/31 = 0.96 → 0
    expect(view(planPeriod({ terms: lastDay, lines: tiny, period: '2026-05', alreadyGenerated: false, scale: 0 }))).toMatchObject({ status: 'not_due', reason: 'zero_amount', date: null, subtotal: '0' });
    expect(planPeriod({ terms: lastDay, lines: [...tiny, ...lines.slice(0, 1)], period: '2026-05', alreadyGenerated: false, scale: 0 }).lines.map((l) => l.description)).toEqual(['賃料']);
    expect(view(planPeriod({ terms: { ...lastDay, roundingMode: 'up' }, lines: tiny, period: '2026-05', alreadyGenerated: false, scale: 0 }))).toMatchObject({ status: 'due', subtotal: '1' });
  });
});
