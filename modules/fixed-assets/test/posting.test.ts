// Journal lines of runs and disposals (docs/specs/fixed-assets.md AC-12, AC-18, AC-19; golden R1, D1..D7; D8, D19).
import { Decimal } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { disposalJournalLines, imbalance, runJournalLines, type JournalLineSpec } from '../src/index.ts';

const D = (v: number | string) => Decimal.from(String(v));
const view = (lines: JournalLineSpec[]) =>
  lines.map((l) => [
    l.accountId,
    l.debit ? `Dr ${l.debit.toString()}` : `Cr ${l.credit?.toString()}`,
    l.taxCategory ?? null,
    l.taxRate?.toString() ?? null,
  ]);
const accounts = {
  asset: '1925',
  accumulated: '1929',
  expense: '6700',
  lossOnRetirement: '8300',
  gainOnSale: '8100',
  lossOnSale: '8200',
  outputTax: '2200',
  proceeds: '1910',
};
const base = {
  cost: D(600_000),
  yearDepreciation: D(20_000),
  accumulated: D(110_000),
  bookValue: D(490_000),
  accounts,
  proceeds: D(0),
  tax: D(0),
  taxCategory: null,
  taxRate: null,
  partnerId: null,
  memo: 'm',
};

describe('run journal (AC-12)', () => {
  it('AC-12 golden R1: one debit per expense account (out_of_scope), one credit per accumulated account', () => {
    const lines = runJournalLines(
      [
        { expenseAccountId: '6700', accumulatedAccountId: '1929', amount: D(10_000) },
        { expenseAccountId: '6700', accumulatedAccountId: '1930', amount: D(5_000) },
        { expenseAccountId: '6700', accumulatedAccountId: '1930', amount: D(0) },
      ],
      'm',
    );
    expect(view(lines)).toEqual([
      ['6700', 'Dr 15000', 'out_of_scope', '0'],
      ['1929', 'Cr 10000', null, null],
      ['1930', 'Cr 5000', null, null],
    ]);
    expect(imbalance(lines).isZero()).toBe(true);
  });
});

describe('disposal journal (AC-18, AC-19)', () => {
  it('AC-18 golden D1: retirement — year depreciation, accumulated, asset, loss (out_of_scope)', () => {
    const lines = disposalJournalLines({ ...base, kind: 'retirement' });
    expect(view(lines)).toEqual([
      ['6700', 'Dr 20000', 'out_of_scope', '0'],
      ['1929', 'Cr 20000', null, null],
      ['1929', 'Dr 110000', null, null],
      ['1925', 'Cr 600000', null, null],
      ['8300', 'Dr 490000', 'out_of_scope', '0'],
    ]);
    expect(imbalance(lines).isZero()).toBe(true);
  });

  it('AC-19 golden D2: sale at a loss — proceeds + tax, output tax, tagged gain credit, untagged offset, loss', () => {
    const lines = disposalJournalLines({
      ...base,
      kind: 'sale',
      proceeds: D(450_000),
      tax: D(45_000),
      taxCategory: 'standard',
      taxRate: D('0.10'),
    });
    expect(view(lines).slice(4)).toEqual([
      ['1910', 'Dr 495000', null, null],
      ['2200', 'Cr 45000', 'standard', '0.1'],
      ['8100', 'Cr 450000', 'standard', '0.1'],
      ['8100', 'Dr 450000', null, null],
      ['8200', 'Dr 40000', 'out_of_scope', '0'],
    ]);
    expect(imbalance(lines).isZero()).toBe(true);
  });

  it('AC-19 golden D3: sale at a gain — the gain account nets to a 10,000 credit, no loss line', () => {
    const lines = disposalJournalLines({
      ...base,
      kind: 'sale',
      proceeds: D(500_000),
      tax: D(50_000),
      taxCategory: 'standard',
      taxRate: D('0.10'),
    });
    expect(view(lines).slice(4)).toEqual([
      ['1910', 'Dr 550000', null, null],
      ['2200', 'Cr 50000', 'standard', '0.1'],
      ['8100', 'Cr 500000', 'standard', '0.1'],
      ['8100', 'Dr 490000', null, null],
    ]);
    expect(imbalance(lines).isZero()).toBe(true);
  });

  it('AC-19 golden D7: non-taxable sale has no output tax line', () => {
    const lines = disposalJournalLines({
      ...base,
      kind: 'sale',
      proceeds: D(450_000),
      tax: D(0),
      taxCategory: 'non_taxable',
      taxRate: D(0),
    });
    expect(view(lines).slice(4)).toEqual([
      ['1910', 'Dr 450000', null, null],
      ['8100', 'Cr 450000', 'non_taxable', '0'],
      ['8100', 'Dr 450000', null, null],
      ['8200', 'Dr 40000', 'out_of_scope', '0'],
    ]);
  });

  it('AC-18 golden D6: direct method (software) credits the asset with the book value in one line', () => {
    const lines = disposalJournalLines({
      ...base,
      kind: 'retirement',
      cost: D(300_000),
      yearDepreciation: D(5_000),
      accumulated: D(45_000),
      bookValue: D(255_000),
      accounts: { ...accounts, asset: '1930', accumulated: '1930' },
    });
    expect(view(lines)).toEqual([
      ['6700', 'Dr 5000', 'out_of_scope', '0'],
      ['1930', 'Cr 5000', null, null],
      ['1930', 'Cr 255000', null, null],
      ['8300', 'Dr 255000', 'out_of_scope', '0'],
    ]);
    expect(imbalance(lines).isZero()).toBe(true);
  });

  it('AC-18 golden D4 / D5: retirement lines with the capped and switched year amounts', () => {
    const d4 = disposalJournalLines({
      ...base,
      kind: 'retirement',
      yearDepreciation: D(30_004),
      accumulated: D(590_000),
      bookValue: D(10_000),
    });
    expect(view(d4).map((l) => l[1])).toEqual(['Dr 30004', 'Cr 30004', 'Dr 590000', 'Cr 600000', 'Dr 10000']);
    const d5 = disposalJournalLines({
      ...base,
      kind: 'retirement',
      cost: D(1_000_000),
      yearDepreciation: D(10_500),
      accumulated: D(811_000),
      bookValue: D(189_000),
    });
    expect(view(d5).map((l) => l[1])).toEqual(['Dr 10500', 'Cr 10500', 'Dr 811000', 'Cr 1000000', 'Dr 189000']);
  });
});
