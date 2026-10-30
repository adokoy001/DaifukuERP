// Golden hand calculations and properties of the depreciation arithmetic (docs/specs/fixed-assets.md AC-3, AC-6..AC-9,
// AC-18; golden G1..G9, D4..D6). Rates are arguments (fixture-rules.ts), never the l10n data.
import { Decimal } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  disposalDepreciation,
  monthIndex,
  periodDue,
  walkYears,
  yearAmount,
  type FiscalYearLike,
  type WalkAsset,
} from '../src/index.ts';
import { DB10, DB2, DB4, DB5, SL5, SYNTH, fiscalYears, rate } from './fixture-rules.ts';

const D = (v: string | number) => Decimal.from(String(v));
const ONE = D(1);
const ZERO = D(0);

function asset(over: Partial<WalkAsset>): WalkAsset {
  return {
    cost: D(1_000_000),
    method: 'straight_line',
    rate: SL5,
    memorandum: ONE,
    inServiceDate: null,
    opening: null,
    ...over,
  };
}

/** Year amounts from an empty history, booking each year's full amount (the yearly limit). */
function yearlyAmounts(a: WalkAsset, years: FiscalYearLike[]): string[] {
  const booked = new Map<string, Decimal>();
  const out: string[] = [];
  for (const y of years) {
    const states = walkYears(a, years, booked, y.id);
    const s = states[states.length - 1];
    const amount = s?.calc?.amount ?? ZERO;
    out.push(amount.toString());
    booked.set(y.id, amount);
  }
  return out;
}

/** Monthly runs of `months` (period month numbers) in order; returns booked per year id and per-run amounts. */
function runMonths(a: WalkAsset, years: FiscalYearLike[], months: number[]) {
  const booked = new Map<string, Decimal>();
  const runs: string[] = [];
  for (const m of months) {
    const y = years.find((x) => monthIndex(x.startDate) <= m && m <= monthIndex(x.endDate)) as FiscalYearLike;
    const states = walkYears(a, years, booked, y.id);
    const s = states[states.length - 1];
    const due = s ? periodDue(s, m).due : ZERO;
    runs.push(due.toString());
    booked.set(y.id, (booked.get(y.id) ?? ZERO).plus(due));
  }
  return { booked, runs };
}

const monthsOf = (y: FiscalYearLike) => Array.from({ length: 12 }, (_, i) => monthIndex(y.startDate) + i);

describe('straight line (AC-6, AC-8, AC-9)', () => {
  const years = fiscalYears(2026, 4, 7);
  const g1 = asset({ cost: D(600_000), rate: SL5, inServiceDate: '2026-10-15' });

  it('AC-6 AC-8 golden G1: 6 months in the service year, 12 after, capped at cost − 1 in FY2031', () => {
    expect(yearlyAmounts(g1, years)).toEqual(['60000', '120000', '120000', '120000', '120000', '59999', '0']);
  });

  it('AC-9 golden G1: monthly allocation 10,000; the final year 4,999 × 11 and 5,010 in March', () => {
    expect(allocate(D(60_000), 6).map(String)).toEqual(Array(6).fill('10000'));
    const last = allocate(D(59_999), 12).map(String);
    expect(last.slice(0, 11)).toEqual(Array(11).fill('4999'));
    expect(last[11]).toBe('5010');
    const all = years.slice(0, 6).flatMap(monthsOf);
    const { booked } = runMonths(g1, years, all);
    expect([...booked.values()].map(String)).toEqual(['60000', '120000', '120000', '120000', '120000', '59999']);
  });

  it('AC-8 golden G6: software (memorandum 0) ends at book value 0', () => {
    const fy = fiscalYears(2026, 1, 7);
    const g6 = asset({ cost: D(300_000), rate: SL5, memorandum: ZERO, inServiceDate: '2026-07-01' });
    expect(yearlyAmounts(g6, fy)).toEqual(['30000', '60000', '60000', '60000', '60000', '30000', '0']);
  });

  it('AC-3 AC-9 golden G8: opening in July with 60,000 booked this year; skipping August books 20,000 in September', () => {
    const fy = fiscalYears(2026, 1, 2);
    const g8 = asset({
      cost: D(600_000),
      rate: SL5,
      inServiceDate: '2026-01-10',
      opening: { date: '2026-07-01', accumulated: D(60_000), yearDepreciation: D(60_000), revisedBase: null },
    });
    const { runs } = runMonths(g8, fy, [monthIndex('2026-07-01'), monthIndex('2026-09-01')]);
    expect(runs).toEqual(['10000', '20000']);
  });
});

describe('200% declining balance (AC-7, AC-8)', () => {
  it('AC-7 AC-8 golden G2: 10 years, switch in year 7 (revised base 262,144), total 999,999', () => {
    const fy = fiscalYears(2026, 1, 11);
    const g2 = asset({ method: 'declining_200', rate: DB10, inServiceDate: '2026-01-01' });
    const amounts = yearlyAmounts(g2, fy);
    expect(amounts).toEqual([
      '200000',
      '160000',
      '128000',
      '102400',
      '81920',
      '65536',
      '65536',
      '65536',
      '65536',
      '65535',
      '0',
    ]);
    expect(amounts.reduce((s, v) => s.plus(v), ZERO).toString()).toBe('999999');
    const y6 = yearAmount({
      cost: D(1_000_000),
      method: 'declining_200',
      rate: DB10,
      memorandum: ONE,
      openingBookValue: D(327_680),
      revisedBase: null,
      months: 12,
    });
    expect([y6.unadjusted?.toString(), y6.guarantee?.toString(), y6.switched]).toEqual(['65536', '65520', false]);
    const y7 = yearAmount({
      ...{ cost: D(1_000_000), method: 'declining_200' as const, rate: DB10, memorandum: ONE },
      openingBookValue: D(262_144),
      revisedBase: null,
      months: 12,
    });
    expect([y7.unadjusted?.toString(), y7.switched, y7.revisedBase?.toString(), y7.amount.toString()]).toEqual([
      '52428.8',
      true,
      '262144',
      '65536',
    ]);
    const first = allocate(D(200_000), 12).map(String);
    expect(first.slice(0, 11)).toEqual(Array(11).fill('16666'));
    expect(first[11]).toBe('16674');
  });

  it('AC-7 AC-8 golden G3: 9 months in the service year, switch in FY2029, 125,999 and book value 1 in FY2030', () => {
    const fy = fiscalYears(2026, 1, 6);
    const g3 = asset({ method: 'declining_200', rate: DB5, inServiceDate: '2026-04-10' });
    expect(yearlyAmounts(g3, fy)).toEqual(['300000', '280000', '168000', '126000', '125999', '0']);
    const a = allocate(D(300_000), 9).map(String);
    expect(a.slice(0, 8)).toEqual(Array(8).fill('33333'));
    expect(a[8]).toBe('33336');
    const last = allocate(D(125_999), 12).map(String);
    expect([last[0], last[11]]).toEqual(['10499', '10510']);
  });

  it('AC-7 AC-8 golden G4: 4 years, equal-or-above in year 3, switch in year 4 capped at 49,999', () => {
    const fy = fiscalYears(2026, 1, 5);
    const g4 = asset({ cost: D(400_000), method: 'declining_200', rate: DB4, inServiceDate: '2026-01-01' });
    expect(yearlyAmounts(g4, fy)).toEqual(['200000', '100000', '50000', '49999', '0']);
  });

  it('AC-7 golden G5: unadjusted equal to the guarantee amount does not switch', () => {
    const fy = fiscalYears(2026, 1, 4);
    const g5 = asset({ method: 'declining_200', rate: SYNTH, inServiceDate: '2026-01-01' });
    const booked = new Map<string, Decimal>();
    const amounts: string[] = [];
    const switched: boolean[] = [];
    for (const y of fy) {
      const s = walkYears(g5, fy, booked, y.id).at(-1);
      amounts.push(s?.calc?.amount.toString() ?? '');
      switched.push(s?.calc?.switched ?? false);
      booked.set(y.id, s?.calc?.amount ?? ZERO);
    }
    expect(amounts).toEqual(['500000', '250000', '125000', '124999']);
    expect(switched).toEqual([false, false, false, true]);
  });

  it('AC-7 golden G9: 2 years (no guarantee rate) never switches; 500,000 then 499,999', () => {
    const fy = fiscalYears(2026, 1, 3);
    const g9 = asset({ method: 'declining_200', rate: DB2, inServiceDate: '2026-07-01' });
    expect(yearlyAmounts(g9, fy)).toEqual(['500000', '499999', '0']);
  });

  it('AC-3 golden G7: opening in the switched state with the revised base books 65,536 × 3 and 65,535', () => {
    const fy = fiscalYears(2026, 4, 5);
    const g7 = asset({
      method: 'declining_200',
      rate: DB10,
      inServiceDate: '2020-04-01',
      opening: { date: '2026-04-01', accumulated: D(737_856), yearDepreciation: ZERO, revisedBase: D(262_144) },
    });
    expect(yearlyAmounts(g7, fy)).toEqual(['65536', '65536', '65536', '65535', '0']);
  });
});

describe('disposal-year depreciation (AC-18, D22)', () => {
  it('AC-18 golden D1: G1 run through 2027-06, retired 2027-08-20 → 20,000', () => {
    const years = fiscalYears(2026, 4, 3);
    const g1 = asset({ cost: D(600_000), rate: SL5, inServiceDate: '2026-10-15' });
    const months = [
      ...monthsOf(years[0] as FiscalYearLike).slice(6),
      ...monthsOf(years[1] as FiscalYearLike).slice(0, 3),
    ];
    const { booked } = runMonths(g1, years, months);
    const s = walkYears(g1, years, booked, 'FY2027').at(-1);
    expect(s && disposalDepreciation(s, monthIndex('2027-08-20'), ONE).toString()).toBe('20000');
  });

  it('AC-18 golden D4: the capped final year uses the 12-month limit (30,004), not the allocation (4,999)', () => {
    const years = fiscalYears(2026, 4, 6);
    const g1 = asset({ cost: D(600_000), rate: SL5, inServiceDate: '2026-10-15' });
    const months = [
      ...years
        .slice(0, 5)
        .flatMap(monthsOf)
        .filter((m) => m >= monthIndex('2026-10-01')),
      ...monthsOf(years[5] as FiscalYearLike).slice(0, 4),
    ];
    const { booked } = runMonths(g1, years, months);
    expect(booked.get('FY2031')?.toString()).toBe('19996');
    const s = walkYears(g1, years, booked, 'FY2031').at(-1);
    expect(s?.openingBookValue.toString()).toBe('60000');
    expect(s && disposalDepreciation(s, monthIndex('2031-08-20'), ONE).toString()).toBe('30004');
    expect(s && periodDue(s, monthIndex('2031-08-01')).due.toString()).toBe('4999');
  });

  it('AC-18 golden D5: the switch year (126,000 a year), Jan–May booked, retired 2029-06-15 → 10,500', () => {
    const years = fiscalYears(2026, 1, 4);
    const g3 = asset({ method: 'declining_200', rate: DB5, inServiceDate: '2026-04-10' });
    const months = [
      ...years
        .slice(0, 3)
        .flatMap(monthsOf)
        .filter((m) => m >= monthIndex('2026-04-01')),
      ...monthsOf(years[3] as FiscalYearLike).slice(0, 5),
    ];
    const { booked } = runMonths(g3, years, months);
    expect(booked.get('FY2029')?.toString()).toBe('52500');
    const s = walkYears(g3, years, booked, 'FY2029').at(-1);
    expect(s && disposalDepreciation(s, monthIndex('2029-06-15'), ONE).toString()).toBe('10500');
  });

  it('AC-18 golden D6: software retired 2027-03-10 with Jan–Feb booked → 5,000', () => {
    const years = fiscalYears(2026, 1, 2);
    const g6 = asset({ cost: D(300_000), rate: SL5, memorandum: ZERO, inServiceDate: '2026-07-01' });
    const months = [
      ...monthsOf(years[0] as FiscalYearLike).slice(6),
      ...monthsOf(years[1] as FiscalYearLike).slice(0, 2),
    ];
    const { booked } = runMonths(g6, years, months);
    const s = walkYears(g6, years, booked, 'FY2027').at(-1);
    expect(s && disposalDepreciation(s, monthIndex('2027-03-10'), ZERO).toString()).toBe('5000');
  });
});

describe('properties (AC-9, PV-FIXED-ASSETS-01)', () => {
  const lives = [
    { rate: SL5, method: 'straight_line' as const },
    { rate: DB10, method: 'declining_200' as const },
    { rate: DB5, method: 'declining_200' as const },
    { rate: DB4, method: 'declining_200' as const },
    { rate: DB2, method: 'declining_200' as const },
    { rate: rate('0.100'), method: 'straight_line' as const },
  ];
  const arb = fc.record({
    life: fc.integer({ min: 0, max: lives.length - 1 }),
    // Realistic costs: below ~10 yen a year the yen truncation books 0 forever (no asset is that small in practice).
    cost: fc.integer({ min: 10_000, max: 50_000_000 }),
    startMonth: fc.integer({ min: 1, max: 12 }),
    serviceOffset: fc.integer({ min: 0, max: 11 }),
    intangible: fc.boolean(),
    skips: fc.array(fc.boolean(), { minLength: 12 * 13, maxLength: 12 * 13 }),
  });

  it('AC-9: totals reach cost − memorandum, book value never below it, allocation sums to the year, order-free', () => {
    fc.assert(
      fc.property(arb, (p) => {
        const years = fiscalYears(2026, p.startMonth, 13);
        const { rate: r, method } = lives[p.life] as (typeof lives)[number];
        const memorandum = p.intangible ? ZERO : ONE;
        const service = monthIndex((years[0] as FiscalYearLike).startDate) + p.serviceOffset;
        const inServiceDate = `${Math.floor(service / 12)}-${String((service % 12) + 1).padStart(2, '0')}-15`;
        const a = asset({ cost: D(p.cost), method, rate: r, memorandum, inServiceDate });
        const all = years.flatMap(monthsOf);
        // Runs in some months only (skipped months are caught up later in the same year, never in a later year).
        const chosen = all.filter((m, i) => {
          const y = years.find((x) => monthIndex(x.startDate) <= m && m <= monthIndex(x.endDate)) as FiscalYearLike;
          const lastOfYear = m === monthIndex(y.endDate);
          return lastOfYear || !p.skips[i];
        });
        const { booked } = runMonths(a, years, chosen);
        const yearly = yearlyAmounts(a, years);
        years.forEach((y, i) => expect(booked.get(y.id)?.toString() ?? '0').toBe(yearly[i]));
        const total = [...booked.values()].reduce((s, v) => s.plus(v), ZERO);
        expect(total.toString()).toBe(D(p.cost).minus(memorandum).toString());
        let bv = D(p.cost);
        for (const y of years) {
          bv = bv.minus(booked.get(y.id) ?? ZERO);
          expect(bv.gte(memorandum)).toBe(true);
        }
        for (const v of yearly) {
          const amount = D(v);
          for (const months of [1, 6, 12]) {
            const parts = allocate(amount, months);
            expect(parts.reduce((s, x) => s.plus(x), ZERO).toString()).toBe(amount.toString());
            expect(parts.every((x) => !x.isNegative())).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
