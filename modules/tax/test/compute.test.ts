// Pure tax engine: examples (AC-2..AC-4), properties (AC-9) and the hand-computed golden file (AC-10).
import { Decimal, ROUNDING_MODES, ValidationError, type RoundingMode } from '@daifuku/kernel';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TAX_CATEGORIES, type TaxCategory } from '../src/services/categories.ts';
import {
  computeLineTax,
  resolveRate,
  summarizeTax,
  taxScaleForCurrency,
  type LineTaxInput,
  type RateRow,
} from '../src/services/compute.ts';

const RATES: readonly RateRow[] = [
  { code: 'STD8', category: 'standard', rate: '0.08', validFrom: '2014-04-01', validTo: '2019-09-30', label: '標準8%' },
  { code: 'STD10', category: 'standard', rate: '0.10', validFrom: '2019-10-01', validTo: null, label: '標準10%' },
  { code: 'RED8', category: 'reduced', rate: '0.08', validFrom: '2019-10-01', validTo: null, label: '軽減8%' },
  { code: 'EXEMPT', category: 'exempt', rate: '0', validFrom: '2019-10-01', validTo: null, label: '免税' },
];

const line = (amount: string, category: TaxCategory, rate: string): LineTaxInput => ({ amount, category, rate });
const strings = (s: {
  groups: { category: string; rate: Decimal; taxable: Decimal; tax: Decimal; gross: Decimal }[];
}) => s.groups.map((g) => [g.category, g.rate.toString(), g.taxable.toString(), g.tax.toString(), g.gross.toString()]);

describe('resolveRate (AC-2)', () => {
  it('returns the row whose period contains the date; both period ends are inclusive', () => {
    expect(resolveRate(RATES, 'standard', '2019-09-30')).toMatchObject({
      code: 'STD8',
      category: 'standard',
      label: '標準8%',
    });
    expect(resolveRate(RATES, 'standard', '2019-10-01').code).toBe('STD10');
    expect(resolveRate(RATES, 'standard', '2014-04-01').code).toBe('STD8');
    expect(resolveRate(RATES, 'standard', '2026-09-10').rate.eq('0.10')).toBe(true);
    expect(resolveRate(RATES, 'reduced', '2026-09-10').rate.toString()).toBe('0.08');
  });

  it('exempt/non_taxable/out_of_scope resolve to rate 0 with the category preserved, with or without a row', () => {
    expect(resolveRate(RATES, 'exempt', '2026-01-01')).toMatchObject({
      category: 'exempt',
      code: 'EXEMPT',
      label: '免税',
    });
    expect(resolveRate(RATES, 'exempt', '2026-01-01').rate.isZero()).toBe(true);
    expect(resolveRate(RATES, 'exempt', '2010-01-01')).toMatchObject({
      category: 'exempt',
      code: 'EXEMPT',
      label: '免税',
    });
    expect(resolveRate(RATES, 'non_taxable', '2026-01-01')).toMatchObject({ category: 'non_taxable', code: 'NONTAX' });
    expect(resolveRate([], 'out_of_scope', '2026-01-01')).toMatchObject({ category: 'out_of_scope', code: 'OOS' });
    expect(resolveRate([], 'out_of_scope', '2026-01-01').rate.toString()).toBe('0');
  });

  it('no match -> ValidationError whose hint says which row to add', () => {
    const err = (() => {
      try {
        resolveRate(RATES, 'reduced', '2019-09-30');
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).hint).toBe('add a tax_rate row for reduced covering 2019-09-30');
    expect(() => resolveRate(RATES, 'standard', '2014-03-31')).toThrow(ValidationError);
    expect(() => resolveRate(RATES, 'standard', '2026-13-01')).toThrow(ValidationError);
    expect(() => resolveRate(RATES, 'vat' as TaxCategory, '2026-01-01')).toThrow(ValidationError);
  });

  it('AC-9 golden: adding RED1 (reduced 1% from 2027-04-01, 2 years) is a data change only', () => {
    const withRed1: RateRow[] = [
      ...RATES.map((r) => (r.code === 'RED8' ? { ...r, validTo: '2027-03-31' } : r)),
      {
        code: 'RED1',
        category: 'reduced',
        rate: '0.01',
        validFrom: '2027-04-01',
        validTo: '2029-03-31',
        label: '軽減1%（飲食料品）',
      },
    ];
    expect(resolveRate(withRed1, 'reduced', '2027-03-31').rate.toString()).toBe('0.08');
    expect(resolveRate(withRed1, 'reduced', '2027-04-01').rate.toString()).toBe('0.01');
    expect(resolveRate(withRed1, 'reduced', '2027-04-01').code).toBe('RED1');
    expect(resolveRate(withRed1, 'reduced', '2029-03-31').code).toBe('RED1');
    expect(() => resolveRate(withRed1, 'reduced', '2029-04-01')).toThrow(
      expect.objectContaining({ code: 'VALIDATION', hint: 'add a tax_rate row for reduced covering 2029-04-01' }),
    );
    expect(resolveRate(withRed1, 'standard', '2027-04-01').code).toBe('STD10');
  });
});

describe('computeLineTax (AC-3)', () => {
  it('税抜: tax = amount × rate, unrounded', () => {
    const r = computeLineTax({ amount: '1234', category: 'standard', rate: '0.10' });
    expect([r.taxable.toString(), r.tax.toString(), r.gross.toString()]).toEqual(['1234', '123.4', '1357.4']);
    const r8 = computeLineTax({ amount: '333', category: 'reduced', rate: '0.08', priceIncludesTax: false });
    expect(r8.tax.toString()).toBe('26.64');
  });

  it('税込: taxable = amount ÷ (1 + rate), tax = amount − taxable; exact when the value terminates', () => {
    const r = computeLineTax({ amount: '1100', category: 'standard', rate: '0.10', priceIncludesTax: true });
    expect([r.taxable.toString(), r.tax.toString(), r.gross.toString()]).toEqual(['1000', '100', '1100']);
    const odd = computeLineTax({ amount: '1000', category: 'standard', rate: '0.1', priceIncludesTax: true });
    expect(odd.taxable.toString().startsWith('909.0909')).toBe(true);
    expect(odd.taxable.plus(odd.tax).eq('1000')).toBe(true);
  });

  it('zero-rate categories: tax 0, gross = amount; a non-zero rate on them is rejected', () => {
    const r = computeLineTax({ amount: '500', category: 'exempt', rate: '0' });
    expect([r.taxable.toString(), r.tax.toString(), r.gross.toString()]).toEqual(['500', '0', '500']);
    expect(() => computeLineTax({ amount: '500', category: 'exempt', rate: '0.1' })).toThrow(ValidationError);
    expect(() => computeLineTax({ amount: '500', category: 'standard', rate: '-0.1' })).toThrow(ValidationError);
  });
});

describe('summarizeTax (AC-4)', () => {
  it('groups by (category, rate), sums, rounds once per group — not per line (問57)', () => {
    const lines = [line('1234', 'standard', '0.10'), line('567', 'standard', '0.10'), line('89', 'standard', '0.10')];
    const s = summarizeTax(lines, { roundingMode: 'down', scale: 0 });
    expect(strings(s)).toEqual([['standard', '0.1', '1890', '189', '2079']]);
    // per-line rounding would give 123 + 56 + 8 = 187
    const perLine = Decimal.sum(lines.map((l) => computeLineTax(l).tax.roundDown(0)));
    expect(perLine.toString()).toBe('187');
    expect(s.groups[0]?.lineCount).toBe(3);
  });

  it('two rates of the same category (historical mix) are separate groups; order = first appearance', () => {
    const s = summarizeTax(
      [line('100', 'reduced', '0.08'), line('1000', 'standard', '0.10'), line('1000', 'standard', '0.08')],
      { roundingMode: 'down', scale: 0 },
    );
    expect(strings(s)).toEqual([
      ['reduced', '0.08', '100', '8', '108'],
      ['standard', '0.1', '1000', '100', '1100'],
      ['standard', '0.08', '1000', '80', '1080'],
    ]);
    expect(s.totals.taxable.toString()).toBe('2100');
    expect(s.totals.tax.toString()).toBe('188');
    expect(s.totals.gross.toString()).toBe('2288');
  });

  it('rounding modes: 106.64 -> 106 (down) / 107 (half_up) / 107 (up); 123.5 -> 123 / 124 / 124', () => {
    const l8 = [line('1000', 'reduced', '0.08'), line('333', 'reduced', '0.08')];
    const l10 = [line('1235', 'standard', '0.10')];
    const tax = (lines: LineTaxInput[], mode: RoundingMode) =>
      summarizeTax(lines, { roundingMode: mode, scale: 0 }).groups[0]?.tax.toString();
    expect([tax(l8, 'down'), tax(l8, 'half_up'), tax(l8, 'up')]).toEqual(['106', '107', '107']);
    expect([tax(l10, 'down'), tax(l10, 'half_up'), tax(l10, 'up')]).toEqual(['123', '124', '124']);
  });

  it('税込 mode: tax = Σgross × rate ÷ (1 + rate) rounded once; taxable = gross − tax (exact for 1,100)', () => {
    const s = summarizeTax([line('100', 'standard', '0.10'), line('1000', 'standard', '0.10')], {
      roundingMode: 'down',
      scale: 0,
      priceIncludesTax: true,
    });
    expect(strings(s)).toEqual([['standard', '0.1', '1000', '100', '1100']]);
    const odd = summarizeTax([line('3284', 'standard', '0.10')], {
      roundingMode: 'half_up',
      scale: 0,
      priceIncludesTax: true,
    });
    expect(strings(odd)).toEqual([['standard', '0.1', '2985', '299', '3284']]);
  });

  it('negative amounts (返品・値引) round toward the same sign and never flip; -0 is reported as 0', () => {
    const l = [line('-1333', 'reduced', '0.08')];
    const tax = (mode: RoundingMode) => summarizeTax(l, { roundingMode: mode, scale: 0 }).groups[0]?.tax.toString();
    expect([tax('down'), tax('half_up'), tax('up')]).toEqual(['-106', '-107', '-107']);
    const tiny = summarizeTax([line('-3', 'standard', '0.10')], { roundingMode: 'down', scale: 0 });
    expect(tiny.groups[0]?.tax.toString()).toBe('0');
    expect(tiny.groups[0]?.tax.isNegative()).toBe(false);
  });

  it('scale follows the currency (JPY 0, others 2); empty input gives empty groups and zero totals; bad scale rejected', () => {
    expect(taxScaleForCurrency('JPY')).toBe(0);
    expect(taxScaleForCurrency('usd')).toBe(2);
    const s = summarizeTax([line('12.345', 'standard', '0.10')], { roundingMode: 'half_up', scale: 2 });
    expect(s.groups[0]?.tax.toString()).toBe('1.23');
    expect(
      summarizeTax([line('12.345', 'standard', '0.10')], { roundingMode: 'up', scale: 2 }).groups[0]?.tax.toString(),
    ).toBe('1.24');
    const empty = summarizeTax([], { roundingMode: 'down', scale: 0 });
    expect(empty.groups).toEqual([]);
    expect(empty.totals.tax.toString()).toBe('0');
    expect(() => summarizeTax([], { roundingMode: 'down', scale: -1 })).toThrow(ValidationError);
    expect(() => summarizeTax([line('1', 'exempt', '0.1')], { roundingMode: 'down', scale: 0 })).toThrow(
      ValidationError,
    );
  });
});

// ---- properties (AC-9) ----------------------------------------------------------------------------

const arbCategory = fc.constantFrom(...TAX_CATEGORIES);
const rateFor = (c: TaxCategory) =>
  c === 'standard'
    ? fc.constantFrom('0.10', '0.08', '0.05')
    : c === 'reduced'
      ? fc.constantFrom('0.08', '0.01')
      : fc.constant('0');
/** Money with up to 2 decimals, either sign, as a decimal string. */
const arbAmount = fc
  .integer({ min: -100_000_000, max: 100_000_000 })
  .map((cents) => Decimal.from(cents).div(100).toString());
const arbLine: fc.Arbitrary<LineTaxInput> = arbCategory.chain((category) =>
  fc.record({ amount: arbAmount, category: fc.constant(category), rate: rateFor(category) }),
);
const arbLines = fc.array(arbLine, { minLength: 0, maxLength: 30 });
const arbMode = fc.constantFrom(...ROUNDING_MODES);
const arbScale = fc.constantFrom(0, 2);

describe('summarizeTax — properties (AC-9)', () => {
  it('税抜: Σ group.taxable == Σ lines.amount, and Σ gross == Σ taxable + Σ tax', () => {
    fc.assert(
      fc.property(arbLines, arbMode, arbScale, (lines, roundingMode, scale) => {
        const s = summarizeTax(lines, { roundingMode, scale });
        const sumAmount = Decimal.sum(lines.map((l) => Decimal.from(l.amount)));
        expect(s.totals.taxable.eq(sumAmount)).toBe(true);
        expect(Decimal.sum(s.groups.map((g) => g.taxable)).eq(sumAmount)).toBe(true);
        expect(s.totals.gross.eq(s.totals.taxable.plus(s.totals.tax))).toBe(true);
        for (const g of s.groups) expect(g.gross.eq(g.taxable.plus(g.tax))).toBe(true);
      }),
    );
  });

  it('税込: Σ group.gross == Σ lines.amount, and taxable + tax == gross per group', () => {
    fc.assert(
      fc.property(arbLines, arbMode, arbScale, (lines, roundingMode, scale) => {
        const s = summarizeTax(lines, { roundingMode, scale, priceIncludesTax: true });
        expect(s.totals.gross.eq(Decimal.sum(lines.map((l) => Decimal.from(l.amount))))).toBe(true);
        for (const g of s.groups) expect(g.gross.eq(g.taxable.plus(g.tax))).toBe(true);
      }),
    );
  });

  it('rounding never changes the sign of the tax, and moves it by less than one unit of the scale', () => {
    fc.assert(
      fc.property(arbLines, arbMode, arbScale, fc.boolean(), (lines, roundingMode, scale, priceIncludesTax) => {
        const s = summarizeTax(lines, { roundingMode, scale, priceIncludesTax });
        const unit = Decimal.from(1).div(Decimal.from(10 ** scale));
        for (const g of s.groups) {
          const sum = Decimal.sum(
            lines
              .filter((l) => l.category === g.category && Decimal.from(l.rate).eq(g.rate))
              .map((l) => Decimal.from(l.amount)),
          );
          const unrounded = priceIncludesTax ? sum.times(g.rate).div(Decimal.from(1).plus(g.rate)) : sum.times(g.rate);
          expect(g.tax.isZero() || g.tax.cmp(0) === unrounded.cmp(0)).toBe(true);
          expect(g.tax.minus(unrounded).abs().lt(unit)).toBe(true);
        }
      }),
    );
  });

  it('one group per distinct (category, rate); zero-rate groups carry tax 0', () => {
    fc.assert(
      fc.property(arbLines, arbMode, (lines, roundingMode) => {
        const s = summarizeTax(lines, { roundingMode, scale: 0 });
        const keys = new Set(lines.map((l) => `${l.category}|${Decimal.from(l.rate).toString()}`));
        expect(s.groups.length).toBe(keys.size);
        for (const g of s.groups) if (g.rate.isZero()) expect(g.tax.isZero()).toBe(true);
      }),
    );
  });
});

// ---- golden (AC-10) --------------------------------------------------------------------------------

const groupExpectation = z.object({ taxable: z.string(), tax: z.string() });
const goldenSchema = z.object({
  date: z.string(),
  rates: z.array(
    z.object({
      code: z.string(),
      category: z.enum(TAX_CATEGORIES),
      rate: z.string(),
      validFrom: z.string(),
      validTo: z.string().nullable(),
      label: z.string(),
    }),
  ),
  invoices: z.array(
    z.object({
      name: z.string(),
      priceIncludesTax: z.boolean(),
      lines: z.array(z.object({ amount: z.string(), category: z.enum(TAX_CATEGORIES) })),
      expected: z.record(
        z.enum(ROUNDING_MODES),
        z
          .object({ totals: z.object({ taxable: z.string(), tax: z.string(), gross: z.string() }) })
          .catchall(groupExpectation),
      ),
    }),
  ),
});

const golden = goldenSchema.parse(
  JSON.parse(readFileSync(new URL('./golden/invoice-rounding.json', import.meta.url), 'utf8')),
);

describe('golden test/golden/invoice-rounding.json (AC-10, 問57)', () => {
  for (const inv of golden.invoices) {
    for (const mode of ROUNDING_MODES) {
      it(`${inv.name} — ${mode}`, () => {
        const expected = inv.expected[mode];
        const lines = inv.lines.map((l) => ({
          amount: l.amount,
          category: l.category,
          rate: resolveRate(golden.rates, l.category, golden.date).rate,
        }));
        const s = summarizeTax(lines, { roundingMode: mode, scale: 0, priceIncludesTax: inv.priceIncludesTax });
        const { totals, ...groups } = expected;
        expect(s.groups.map((g) => g.category)).toEqual(Object.keys(groups));
        for (const g of s.groups) {
          const e = groupExpectation.parse(groups[g.category]);
          expect(g.taxable.toString()).toBe(e.taxable);
          expect(g.tax.toString()).toBe(e.tax);
          expect(g.gross.toString()).toBe(Decimal.from(e.taxable).plus(e.tax).toString());
        }
        expect([s.totals.taxable.toString(), s.totals.tax.toString(), s.totals.gross.toString()]).toEqual([
          totals.taxable,
          totals.tax,
          totals.gross,
        ]);
      });
    }
  }
});
