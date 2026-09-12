// Unit tests for the pure parts of the retail pack (docs/specs/pack-retail.md AC-3, AC-7, AC-10): tax-inclusive closing
// totals rounded once per rate, the cash + card check, the 三分法 month-close lines and the daily aggregation. Expected
// figures are the hand derivations of docs/domain/scenario-retail.md.
import { Decimal } from '@daifuku/kernel';
import type { TaxCategory } from '@daifuku/mod-tax';
import { describe, expect, it } from 'vitest';
import { aggregateDaily, closingTotals, laterCloses, lineAmount, monthCloseLines, periodRange, previousClose, ratePercentKey, taxColumnsOf, tenderCheck, tenderHint } from '../src/index.ts';

const RATE: Record<string, string> = { reduced: '0.08', standard: '0.1' };
const JPY = { roundingMode: 'down' as const, scale: 0 };
/** [category, quantity, tax-inclusive unit price] -> closing tax lines. */
const lines = (rows: readonly [TaxCategory, string, string][]) => rows.map(([category, qty, price]) => ({ category, rate: RATE[category] ?? '0', amount: lineAmount(qty, price) }));

const REG1 = lines([
  ['reduced', '20', '540'],
  ['reduced', '30', '162'],
  ['standard', '5', '1100'],
  ['standard', '10', '330'],
]);
const REG2 = lines([
  ['reduced', '25', '540'],
  ['reduced', '40', '162'],
  ['standard', '8', '1100'],
  ['standard', '15', '330'],
]);
const REG3 = lines([
  ['reduced', '3', '540'],
  ['reduced', '5', '162'],
  ['standard', '2', '1100'],
  ['standard', '-1', '330'],
]);

describe('closingTotals (AC-3): tax-inclusive, rounded once per rate', () => {
  it('REG1: 軽減 15,660 → 税 1,160 / 税抜 14,500; 標準 8,800 → 税 800 / 税抜 8,000; total 24,460', () => {
    const t = closingTotals(REG1, JPY);
    expect([t.subtotal.toString(), t.taxTotal.toString(), t.total.toString()]).toEqual(['22500', '1960', '24460']);
    expect(t.taxSummary.map((g) => [g.category, g.rate, g.taxable, g.tax, g.gross, g.lineCount])).toEqual([
      ['reduced', '0.08', '14500', '1160', '15660', 2],
      ['standard', '0.1', '8000', '800', '8800', 2],
    ]);
  });

  it('REG2 31,000 / 2,730 / 33,730 and REG3 (return P4×−1 in the standard group) 3,950 / 350 / 4,300', () => {
    const t2 = closingTotals(REG2, JPY);
    expect([t2.subtotal.toString(), t2.taxTotal.toString(), t2.total.toString()]).toEqual(['31000', '2730', '33730']);
    expect(t2.taxSummary.map((g) => [g.taxable, g.tax])).toEqual([
      ['18500', '1480'],
      ['12500', '1250'],
    ]);
    const t3 = closingTotals(REG3, JPY);
    expect([t3.subtotal.toString(), t3.taxTotal.toString(), t3.total.toString()]).toEqual(['3950', '350', '4300']);
    expect(t3.taxSummary.map((g) => [g.category, g.gross, g.taxable, g.tax])).toEqual([
      ['reduced', '2430', '2250', '180'],
      ['standard', '1870', '1700', '170'],
    ]);
  });

  it('rounds once per rate, not per line: 3 × 税込 100 @8% → 22 (per line 7 × 3 = 21 would be wrong)', () => {
    const t = closingTotals(
      lines([
        ['reduced', '1', '100'],
        ['reduced', '1', '100'],
        ['reduced', '1', '100'],
      ]),
      JPY,
    );
    // 300 × 0.08 / 1.08 = 22.22… → 22 (切捨て); per line 100 × 0.08 / 1.08 = 7.40… → 7, × 3 = 21
    expect([t.taxTotal.toString(), t.subtotal.toString(), t.total.toString()]).toEqual(['22', '278', '300']);
    expect(closingTotals(lines([['reduced', '3', '100']]), { roundingMode: 'half_up', scale: 0 }).taxTotal.toString()).toBe('22');
    expect(closingTotals(lines([['reduced', '3', '100']]), { roundingMode: 'up', scale: 0 }).taxTotal.toString()).toBe('23');
  });

  it('month (REG1..3): 税抜 57,450, 税額 5,040 (軽減 2,820 + 標準 2,220), 税込 62,490', () => {
    const all = [REG1, REG2, REG3].map((l) => closingTotals(l, JPY));
    expect(Decimal.sum(all.map((t) => t.subtotal)).toString()).toBe('57450');
    expect(Decimal.sum(all.map((t) => t.taxTotal)).toString()).toBe('5040');
    expect(Decimal.sum(all.map((t) => t.total)).toString()).toBe('62490');
    const taxOf = (category: string) => Decimal.sum(all.flatMap((t) => t.taxSummary.filter((g) => g.category === category).map((g) => Decimal.from(g.tax)))).toString();
    expect([taxOf('reduced'), taxOf('standard')]).toEqual(['2820', '2220']);
  });
});

describe('tenderCheck (AC-3): cash + card must equal the total', () => {
  it('REG1 cash 20,000 + card 4,460 = 24,460 → difference 0', () => {
    expect(tenderCheck({ cashAmount: '20000', cardAmount: '4460', total: '24460' }).difference.toString()).toBe('0');
  });
  it('short and over: the hint carries the difference', () => {
    const short = tenderCheck({ cashAmount: '20000', cardAmount: '4000', total: '24460' });
    expect([short.tendered.toString(), short.difference.toString()]).toEqual(['24000', '460']);
    expect(tenderHint(short, '24460')).toContain('460 short');
    expect(tenderHint(short, '24460')).toContain('差額 460');
    const over = tenderCheck({ cashAmount: '25000', cardAmount: '0', total: '24460' });
    expect(over.difference.toString()).toBe('-540');
    expect(tenderHint(over, '24460')).toContain('540 too much');
  });
});

describe('month close (AC-7): 三分法 lines, period range, order', () => {
  const acc = { inventory: 'acc-1400', closingStock: 'acc-5100', openingStock: 'acc-5050' };
  it('first month: Dr 1400 / Cr 5100 for the valuation (7,700); no opening transfer', () => {
    expect(monthCloseLines({ opening: '0', closing: '7700' }, acc).map((l) => [l.accountId, l.debit ?? '0', l.credit ?? '0'])).toEqual([
      ['acc-1400', '7700', '0'],
      ['acc-5100', '0', '7700'],
    ]);
  });
  it('later month: Dr 5050 / Cr 1400 for the previous closing, then Dr 1400 / Cr 5100; nothing when both are 0', () => {
    expect(monthCloseLines({ opening: '7700', closing: '6500' }, acc).map((l) => [l.accountId, l.debit ?? '0', l.credit ?? '0'])).toEqual([
      ['acc-5050', '7700', '0'],
      ['acc-1400', '0', '7700'],
      ['acc-1400', '6500', '0'],
      ['acc-5100', '0', '6500'],
    ]);
    expect(monthCloseLines({ opening: '0', closing: '0' }, acc)).toEqual([]);
    expect(monthCloseLines({ opening: '0', closing: '-100' }, acc).map((l) => [l.accountId, l.debit ?? '0', l.credit ?? '0'])).toEqual([
      ['acc-1400', '0', '100'],
      ['acc-5100', '100', '0'],
    ]);
  });
  it('periodRange handles month lengths; previous / later closes compare YYYY-MM', () => {
    expect(periodRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    const recs = [{ period: '2026-09' }, { period: '2026-11' }, { period: '2026-10' }];
    expect(previousClose(recs, '2026-12')).toEqual({ period: '2026-11' });
    expect(previousClose(recs, '2026-09')).toBeNull();
    expect(laterCloses(recs, '2026-10')).toEqual([{ period: '2026-11' }]);
  });
});

describe('aggregateDaily (AC-7 retail.daily_sales)', () => {
  const closing = (date: string, cash: string, card: string, l: typeof REG1) => {
    const t = closingTotals(l, JPY);
    return { date, subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total, cashAmount: Decimal.from(cash), cardAmount: Decimal.from(card), taxSummary: t.taxSummary };
  };
  it('one row per date, tax columns per rate (8% before 10%), totals 57,450 / 2,820 / 2,220 / 5,040 / 62,490 / 53,730 / 8,760 / 3', () => {
    const agg = aggregateDaily([closing('2026-11-15', '33730', '0', REG2), closing('2026-11-05', '20000', '4460', REG1), closing('2026-11-25', '0', '4300', REG3)]);
    expect(agg.taxColumns.map((c) => [c.key, c.percent])).toEqual([
      ['tax_reduced_8', '8'],
      ['tax_standard_10', '10'],
    ]);
    expect(agg.rows).toEqual([
      { date: '2026-11-05', subtotal: '22500', tax_reduced_8: '1160', tax_standard_10: '800', taxTotal: '1960', total: '24460', cashAmount: '20000', cardAmount: '4460', count: 1 },
      { date: '2026-11-15', subtotal: '31000', tax_reduced_8: '1480', tax_standard_10: '1250', taxTotal: '2730', total: '33730', cashAmount: '33730', cardAmount: '0', count: 1 },
      { date: '2026-11-25', subtotal: '3950', tax_reduced_8: '180', tax_standard_10: '170', taxTotal: '350', total: '4300', cashAmount: '0', cardAmount: '4300', count: 1 },
    ]);
    expect(agg.totals).toEqual({ subtotal: '57450', tax_reduced_8: '2820', tax_standard_10: '2220', taxTotal: '5040', total: '62490', cashAmount: '53730', cardAmount: '8760', count: '3' });
  });
  it('two closings on the same date add up; zero-rate groups get no tax column', () => {
    const exempt = { category: 'non_taxable' as const, code: 'NONTAX', label: '非課税', rate: '0', taxable: '500', tax: '0', gross: '500', lineCount: 1 };
    const a = closing('2026-11-05', '24460', '0', REG1);
    const agg = aggregateDaily([a, { ...a, taxSummary: [...a.taxSummary, exempt] }]);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0]).toMatchObject({ subtotal: '45000', tax_reduced_8: '2320', count: 2 });
    expect(taxColumnsOf([{ ...a, taxSummary: [exempt] }])).toEqual([]);
    expect(ratePercentKey('0.1')).toBe('10');
  });
});
