// The per-contract period walk of the cash forecast (docs/specs/cash-forecast.md D-4 `contract`): counting runs of whole
// periods before the window from one planPeriod call gives exactly the result of planning every aligned period from the
// start month (the reference below), and a contract started in year 1 no longer costs one planPeriod call per month.
import { Decimal, type LocalDate } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { walkContractPeriods, type ContractWalk, type ContractWalkInput } from '../src/cash-plan.ts';
import { addMonths, periodOf, periodStart, type Period } from '../src/services/periods.ts';
import { planPeriod, type ContractTerms, type TermLine } from '../src/services/plan.ts';

const WINDOW_START = '2025-11-01'; // today 2026-11-10

/** Every aligned period from the start month, one planPeriod call each (the walk before the bound). */
function reference(input: ContractWalkInput): ContractWalk {
  const { terms, lines, billed, scale, windowStart, to } = input;
  const due: ContractWalk['due'] = [];
  const backlog = { count: 0, subtotal: Decimal.zero() };
  for (let period = periodOf(terms.startDate); period <= periodOf(to);) {
    if (terms.endDate !== null && terms.endDate < periodStart(period)) break;
    const p = planPeriod({ terms, lines, period, alreadyGenerated: billed.has(period), scale });
    if (p.status === 'due' && p.billingDate <= to) {
      if (p.billingDate < windowStart) {
        backlog.count += 1;
        backlog.subtotal = backlog.subtotal.plus(p.subtotal);
      } else due.push({ period, billingDate: p.billingDate, lines: p.lines });
    }
    period = addMonths(period, terms.intervalMonths);
  }
  return { due, backlog };
}

const line = (unitPrice: string, quantity = '1'): TermLine => ({
  seq: 1,
  productId: null,
  description: '保守',
  quantity: Decimal.from(quantity),
  unitPrice: Decimal.from(unitPrice),
  taxCategory: 'standard',
});

function terms(partial: Partial<ContractTerms>): ContractTerms {
  return {
    status: 'active',
    startDate: '2024-01-01',
    endDate: null,
    intervalMonths: 1,
    billingDay: 1,
    billingTiming: 'advance',
    prorationRule: 'daily',
    roundingMode: 'down',
    ...partial,
  };
}

const plain = (w: ContractWalk) => ({
  due: w.due.map((d) => ({
    period: d.period,
    billingDate: d.billingDate,
    amounts: d.lines.map((l) => String(l.amount)),
  })),
  backlog: { count: w.backlog.count, subtotal: w.backlog.subtotal.toString() },
});

const DAY = 86_400_000;
const dateOf = (epochDay: number): LocalDate => new Date(epochDay * DAY).toISOString().slice(0, 10);
const EPOCH_2018 = Date.UTC(2018, 0, 1) / DAY;
const EPOCH_2028 = Date.UTC(2028, 0, 1) / DAY;

describe('contract period walk (cash forecast D-4)', () => {
  it('D-4: equals planning every aligned period, for any start, end, interval, timing, proration and billed set', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: EPOCH_2018, max: EPOCH_2028 }),
        fc.option(fc.integer({ min: 0, max: 3000 }), { nil: null }),
        fc.constantFrom(1, 2, 3, 6, 12),
        fc.integer({ min: 1, max: 31 }),
        fc.constantFrom('advance' as const, 'arrears' as const),
        fc.constantFrom('daily' as const, 'none' as const),
        fc.constantFrom('half_up' as const, 'down' as const, 'up' as const),
        fc.integer({ min: Date.UTC(2023, 0, 1) / DAY, max: EPOCH_2028 }),
        fc.array(fc.integer({ min: 0, max: 60 }), { maxLength: 8 }),
        fc.constantFrom('0', '31000', '1234.5'),
        (
          start,
          endOffset,
          intervalMonths,
          billingDay,
          billingTiming,
          prorationRule,
          roundingMode,
          toDay,
          billedSteps,
          price,
        ) => {
          const startDate = dateOf(start);
          const t = terms({
            startDate,
            endDate: endOffset === null ? null : dateOf(start + endOffset),
            intervalMonths,
            billingDay,
            billingTiming,
            prorationRule,
            roundingMode,
          });
          const billed = new Set<Period>(billedSteps.map((n) => addMonths(periodOf(startDate), n * intervalMonths)));
          const input = {
            terms: t,
            lines: [line(price, '3')],
            billed,
            scale: 0,
            windowStart: WINDOW_START,
            to: dateOf(toDay),
          };
          expect(plain(walkContractPeriods(input))).toEqual(plain(reference(input)));
        },
      ),
      { numRuns: 400 },
    );
  });

  it('D-4: a start in year 1 (a mistyped year) gives the same backlog with a bounded walk', () => {
    const input = {
      terms: terms({ startDate: '0001-01-01', billingDay: 20 }),
      lines: [line('31000')],
      billed: new Set<Period>(['0001-01', '1999-12', '2025-12']),
      scale: 0,
      windowStart: WINDOW_START,
      to: '2027-01-31',
    };
    const walk = walkContractPeriods(input);
    expect(plain(walk)).toEqual(plain(reference(input)));
    // 0001-01 .. 2025-10 bill before 2025-11-01: 24,298 periods, two of them billed
    expect(plain(walk).backlog).toEqual({ count: 24_296, subtotal: Decimal.from('31000').times(24_296).toString() });
    expect(walk.due.map((d) => d.period)).toEqual([
      '2025-11',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('D-4: an ended contract long before the window counts its prorated last period once', () => {
    const input = {
      terms: terms({ startDate: '1990-04-10', endDate: '2001-06-15', intervalMonths: 3 }),
      lines: [line('30000')],
      billed: new Set<Period>(),
      scale: 0,
      windowStart: WINDOW_START,
      to: '2026-12-31',
    };
    expect(plain(walkContractPeriods(input))).toEqual(plain(reference(input)));
    expect(walkContractPeriods(input).due).toEqual([]);
  });
});
