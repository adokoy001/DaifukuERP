// 消費税集計表 classification (docs/specs/tax-period-summary.md AC-2..AC-4) — examples + fast-check properties, no DB.
import { Decimal } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyGroup,
  formatRate,
  taxSummaryRows,
  type TaxAccountInfo,
  type TaxLineGroup,
} from '../src/services/tax-summary.ts';

const D = (s: string) => Decimal.from(s);
const ACCOUNTS = new Map<string, TaxAccountInfo>([
  ['ar', { type: 'asset', taxRole: 'none' }],
  ['bank', { type: 'asset', taxRole: 'none' }],
  ['inputTax', { type: 'asset', taxRole: 'input_tax' }],
  ['ap', { type: 'liability', taxRole: 'none' }],
  ['outputTax', { type: 'liability', taxRole: 'output_tax' }],
  ['capital', { type: 'equity', taxRole: 'none' }],
  ['sales', { type: 'revenue', taxRole: 'none' }],
  ['rent', { type: 'expense', taxRole: 'none' }],
  ['fees', { type: 'expense', taxRole: 'none' }],
  ['equipment', { type: 'asset', taxRole: 'none' }],
]);
const g = (
  accountId: string,
  debit: string,
  credit: string,
  taxCategory: string | null = null,
  taxRate: string | null = null,
  lines = 1,
): TaxLineGroup => ({
  accountId,
  ...(ACCOUNTS.has(accountId) ? { accountAtPosting: ACCOUNTS.get(accountId) as TaxAccountInfo } : {}),
  debit: D(debit),
  credit: D(credit),
  taxCategory,
  taxRate: taxRate === null ? null : D(taxRate),
  lines,
});

describe('tax period summary (pure)', () => {
  it('uses the recorded classification and refuses unknown legacy classification', () => {
    const posted = g('sales', '0', '1000', 'standard', '0.1');
    expect(classifyGroup(posted, { type: 'expense', taxRole: 'input_tax' })).toMatchObject({
      side: '売上',
      kind: 'base',
      amount: D('1000'),
    });
    const legacy = { ...posted };
    delete legacy.accountAtPosting;
    expect(() => classifyGroup(legacy, { type: 'revenue', taxRole: 'none' })).toThrow(
      'Historical account classification is unavailable',
    );
  });
  it('formatRate keeps at least two decimals and never drops digits', () => {
    expect([
      formatRate(D('0.1')),
      formatRate(D('0.08')),
      formatRate(D('0.100000')),
      formatRate(D('0')),
      formatRate(D('0.075')),
      formatRate(D('1')),
    ]).toEqual(['0.10', '0.08', '0.10', '0.00', '0.075', '1.00']);
  });

  it('AC-2 classification: revenue → 売上 (credit − debit); expense/asset → 仕入 (debit − credit); taxRole lines are tax; no category → skipped', () => {
    const acc = (id: string) => ACCOUNTS.get(id);
    expect(classifyGroup(g('sales', '100', '1000', 'standard', '0.1'), acc('sales'))).toMatchObject({
      side: '売上',
      category: 'standard',
      kind: 'base',
      amount: D('900'),
    });
    expect(classifyGroup(g('rent', '80000', '0', 'non_taxable', '0'), acc('rent'))).toMatchObject({
      side: '仕入',
      category: 'non_taxable',
      kind: 'base',
      amount: D('80000'),
    });
    expect(classifyGroup(g('equipment', '300000', '0', 'standard', '0.1'), acc('equipment'))).toMatchObject({
      side: '仕入',
      kind: 'base',
      amount: D('300000'),
    });
    expect(classifyGroup(g('fees', '0', '1000', 'standard', '0.1'), acc('fees'))).toMatchObject({
      side: '仕入',
      kind: 'base',
      amount: D('-1000'),
    });
    expect(classifyGroup(g('outputTax', '10', '100', 'standard', '0.1'), acc('outputTax'))).toMatchObject({
      side: '売上',
      kind: 'tax',
      amount: D('90'),
    });
    expect(classifyGroup(g('inputTax', '100', '10', 'reduced', '0.08'), acc('inputTax'))).toMatchObject({
      side: '仕入',
      category: 'reduced',
      kind: 'tax',
      amount: D('90'),
    });
    // 売掛金・預金・控除対象外消費税 (no category), liability/equity lines, unknown accounts: not part of the summary
    for (const [group, id] of [
      [g('ar', '1100', '0'), 'ar'],
      [g('bank', '0', '500'), 'bank'],
      [g('fees', '1500', '0'), 'fees'],
      [g('ap', '0', '1100', 'standard', '0.1'), 'ap'],
      [g('capital', '0', '1', 'out_of_scope', '0'), 'capital'],
    ] as const) {
      expect(classifyGroup(group, acc(id)), id).toBeNull();
    }
    expect(() => classifyGroup(g('ghost', '1', '0', 'standard', '0.1'), undefined)).toThrow(
      'Historical account classification is unavailable',
    );
  });

  it('AC-3/AC-4 rows per (side, category, rate) with totals; tax lines without category or rate go to (side, unclassified, "")', () => {
    const { rows, totals } = taxSummaryRows(
      [
        g('rent', '80000', '0', 'non_taxable', '0'),
        g('inputTax', '400', '0', 'reduced', '0.08'),
        g('sales', '0', '239000', 'standard', '0.1', 5),
        g('outputTax', '0', '23900', 'standard', '0.100000', 3),
        g('fees', '70000', '0', 'standard', '0.1', 2),
        g('fees', '1500', '0'),
        g('inputTax', '5500', '0', 'standard', '0.1', 2),
        g('fees', '5000', '0', 'reduced', '0.08'),
        g('outputTax', '0', '100'),
        g('inputTax', '50', '0', 'standard', null),
        g('ar', '262900', '0', null, null, 3),
      ],
      ACCOUNTS,
    );
    expect(rows).toEqual([
      {
        side: '売上',
        taxCategory: 'standard',
        taxCategoryLabel: '標準税率',
        taxRate: '0.10',
        taxableAmount: '239000',
        taxAmount: '23900',
        count: 8,
      },
      {
        side: '売上',
        taxCategory: 'unclassified',
        taxCategoryLabel: '未分類',
        taxRate: '',
        taxableAmount: '0',
        taxAmount: '100',
        count: 1,
      },
      {
        side: '仕入',
        taxCategory: 'standard',
        taxCategoryLabel: '標準税率',
        taxRate: '0.10',
        taxableAmount: '70000',
        taxAmount: '5500',
        count: 4,
      },
      {
        side: '仕入',
        taxCategory: 'reduced',
        taxCategoryLabel: '軽減税率',
        taxRate: '0.08',
        taxableAmount: '5000',
        taxAmount: '400',
        count: 2,
      },
      {
        side: '仕入',
        taxCategory: 'non_taxable',
        taxCategoryLabel: '非課税',
        taxRate: '0.00',
        taxableAmount: '80000',
        taxAmount: '0',
        count: 1,
      },
      {
        side: '仕入',
        taxCategory: 'unclassified',
        taxCategoryLabel: '未分類',
        taxRate: '',
        taxableAmount: '0',
        taxAmount: '50',
        count: 1,
      },
    ]);
    expect(totals).toEqual({ output_tax_total: '24000', input_tax_total: '5950', net_tax_due: '18050' });
  });

  it('several rates of one category sort high to low; base lines without a rate sort last', () => {
    const { rows } = taxSummaryRows(
      [
        g('sales', '0', '1', 'standard', null),
        g('sales', '0', '10', 'standard', '0.08'),
        g('sales', '0', '100', 'standard', '0.1'),
      ],
      ACCOUNTS,
    );
    expect(rows.map((r) => [r.taxRate, r.taxableAmount])).toEqual([
      ['0.10', '100'],
      ['0.08', '10'],
      ['', '1'],
    ]);
  });

  describe('properties', () => {
    const arbAmount = fc.integer({ min: 1, max: 10_000_000 }).map(String);
    const arbGroup = fc.record({
      accountId: fc.constantFrom(...ACCOUNTS.keys()),
      side: fc.boolean(),
      amount: arbAmount,
      taxCategory: fc.constantFrom<string | null>('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope', null),
      taxRate: fc.constantFrom<string | null>('0.1', '0.08', '0', null),
    });
    const toGroup = (x: {
      accountId: string;
      side: boolean;
      amount: string;
      taxCategory: string | null;
      taxRate: string | null;
    }): TaxLineGroup => g(x.accountId, x.side ? x.amount : '0', x.side ? '0' : x.amount, x.taxCategory, x.taxRate);

    it('a reversal (every group mirrored) nets every row and every total to zero', () => {
      fc.assert(
        fc.property(fc.array(arbGroup, { maxLength: 20 }), (xs) => {
          const groups = xs.map(toGroup);
          const mirrored = groups.map((x) => ({ ...x, debit: x.credit, credit: x.debit }));
          const { rows, totals } = taxSummaryRows([...groups, ...mirrored], ACCOUNTS);
          for (const r of rows) expect([r.taxableAmount, r.taxAmount]).toEqual(['0', '0']);
          expect(totals).toEqual({ output_tax_total: '0', input_tax_total: '0', net_tax_due: '0' });
        }),
        { numRuns: 200 },
      );
    });

    it('nothing on a taxRole account is dropped: Σ taxAmount per side equals the totals, net = output − input', () => {
      fc.assert(
        fc.property(fc.array(arbGroup, { maxLength: 20 }), (xs) => {
          const groups = xs.map(toGroup);
          const { rows, totals } = taxSummaryRows(groups, ACCOUNTS);
          const side = (s: string) => Decimal.sum(rows.filter((r) => r.side === s).map((r) => D(r.taxAmount)));
          const expectedOutput = Decimal.sum(
            groups.filter((x) => x.accountId === 'outputTax').map((x) => x.credit.minus(x.debit)),
          );
          const expectedInput = Decimal.sum(
            groups.filter((x) => x.accountId === 'inputTax').map((x) => x.debit.minus(x.credit)),
          );
          expect(side('売上').toString()).toBe(totals.output_tax_total);
          expect(side('仕入').toString()).toBe(totals.input_tax_total);
          expect(totals.output_tax_total).toBe(expectedOutput.toString());
          expect(totals.input_tax_total).toBe(expectedInput.toString());
          expect(totals.net_tax_due).toBe(expectedOutput.minus(expectedInput).toString());
        }),
        { numRuns: 200 },
      );
    });
  });
});
