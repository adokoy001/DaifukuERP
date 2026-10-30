// Unit tests of the settlement tax rules (docs/specs/expense-settlement.md AC-5, D7, D20, D21): rounding once per
// receipt x rate, spreading a receipt's tax over its lines (rounded down, never negative), the credit ratio by invoice
// kind and expense date, and the document fields each invoice kind requires.
import { Decimal, type LocalDate } from '@daifuku/kernel';
import { SEED_TAX_RATES, type RateRow } from '@daifuku/mod-tax';
import { describe, expect, it } from 'vitest';
import {
  computeSettlementTax,
  creditRatioFor,
  invoiceIssues,
  spreadCapped,
  spreadDown,
  type TaxLineInput,
  type TaxSettings,
} from '../src/index.ts';
import { must } from './must.ts';
import { testCreditRatioForDate } from './ratio.ts';

const RATES = SEED_TAX_RATES.map((r) => ({ ...r, validTo: r.validTo ?? null })) as unknown as RateRow[];
const settings: TaxSettings = {
  rates: RATES,
  rounding: { mode: 'down', scale: 0 },
  transitionalRatio: (date: LocalDate) => testCreditRatioForDate(date),
};
const d = (v: string) => Decimal.from(v);
const s = (v: Decimal | null) => (v === null ? null : v.toString());
let seq = 0;
const line = (over: Omit<Partial<TaxLineInput>, 'amount'> & { amount: string }): TaxLineInput => ({
  seq: ++seq,
  expenseId: 'E1',
  expenseDate: '2026-10-05' as LocalDate,
  accountId: '6500',
  taxCategory: 'standard',
  invoiceKind: 'qualified',
  ...over,
  amount: d(over.amount),
});

describe('settlement tax (AC-5, D7)', () => {
  it('AC-5 rounds once per receipt and rate: two 1,000 yen receipts are 90 + 90, not 181', () => {
    const tax = computeSettlementTax(
      [line({ amount: '1000', expenseId: 'A' }), line({ amount: '1000', expenseId: 'B' })],
      settings,
    );
    expect(tax.lines.map((l) => s(l.taxAmount))).toEqual(['90', '90']);
    expect(s(tax.totals.taxTotal)).toBe('180');
    expect(tax.groups).toHaveLength(1);
  });
  it('AC-5 spreads one receipt over its lines rounded down with the rest on the last line (90 / 210)', () => {
    const tax = computeSettlementTax([line({ amount: '1000' }), line({ amount: '2300', accountId: '6900' })], settings);
    expect(tax.lines.map((l) => s(l.taxAmount))).toEqual(['90', '210']);
    expect(tax.lines.map((l) => s(l.taxableAmount))).toEqual(['910', '2090']);
  });
  it('AC-5 spreads the non-deductible part capped by each line tax; deductible = tax − non-deductible, never negative', () => {
    const tax = computeSettlementTax(
      [
        line({ amount: '1000', invoiceKind: 'not_qualified' }),
        line({ amount: '2300', invoiceKind: 'not_qualified' }),
        line({ amount: '1', invoiceKind: 'not_qualified' }),
      ],
      settings,
    );
    // receipt 3,301 → tax 300; 70% deductible 210, non-deductible 90
    expect(Decimal.sum(tax.lines.map((l) => l.taxAmount)).toString()).toBe('300');
    expect(Decimal.sum(tax.lines.map((l) => l.nonDeductibleTax)).toString()).toBe('90');
    for (const l of tax.lines) {
      expect(l.taxAmount.isNegative()).toBe(false);
      expect(l.nonDeductibleTax.isNegative()).toBe(false);
      expect(l.deductibleTax.isNegative()).toBe(false);
      expect(l.nonDeductibleTax.lte(l.taxAmount)).toBe(true);
      expect(l.deductibleTax.plus(l.nonDeductibleTax).eq(l.taxAmount)).toBe(true);
    }
  });
  it('AC-5 spreadDown / spreadCapped keep the sum and never produce a negative share', () => {
    expect(spreadDown(d('100'), [d('1'), d('1'), d('1')], 0).map(String)).toEqual(['33', '33', '34']);
    expect(spreadDown(d('7'), [d('0'), d('0')], 0).map(String)).toEqual(['0', '7']);
    expect(spreadCapped(d('5'), [d('1'), d('1')], [d('1'), d('10')], 0).map(String)).toEqual(['1', '4']);
    expect(spreadCapped(d('3'), [d('9'), d('1')], [d('1'), d('2')], 0).map(String)).toEqual(['1', '2']);
  });
  it('AC-5 D20 takes the rate and the transitional ratio from the expense date (2026-09-30 → 0.8, 2026-10-05 → 0.7)', () => {
    const tax = computeSettlementTax(
      [
        line({
          amount: '1080',
          taxCategory: 'reduced',
          invoiceKind: 'not_qualified',
          expenseDate: '2026-09-30',
          expenseId: 'A',
        }),
        line({ amount: '1030', invoiceKind: 'not_qualified', expenseId: 'B' }),
      ],
      settings,
    );
    expect(tax.lines.map((l) => [s(l.taxAmount), s(l.deductibleTax), s(l.nonDeductibleTax), s(l.creditRatio)])).toEqual(
      [
        ['80', '64', '16', '0.8'],
        ['93', '65', '28', '0.7'],
      ],
    );
  });
  it('AC-5 D21 credit ratio by invoice kind: qualified / books_only / small_amount 1, not_qualified transitional, none 0', () => {
    const date = '2026-10-05' as LocalDate;
    expect(creditRatioFor('qualified', date, settings).toString()).toBe('1');
    expect(creditRatioFor('books_only', date, settings).toString()).toBe('1');
    expect(creditRatioFor('small_amount', date, settings).toString()).toBe('1');
    expect(creditRatioFor('not_qualified', date, settings).toString()).toBe('0.7');
    expect(creditRatioFor('none', date, settings).toString()).toBe('0');
    const none = computeSettlementTax([line({ amount: '1100', invoiceKind: 'none' })], settings);
    expect([
      s(must(none.lines[0]).taxAmount),
      s(must(none.lines[0]).deductibleTax),
      s(must(none.lines[0]).nonDeductibleTax),
    ]).toEqual(['100', '0', '100']);
  });
  it('AC-5 zero-rate categories carry no tax and no credit ratio', () => {
    const tax = computeSettlementTax(
      [line({ amount: '500', taxCategory: 'non_taxable', invoiceKind: null })],
      settings,
    );
    expect([
      s(must(tax.lines[0]).taxAmount),
      s(must(tax.lines[0]).creditRatio),
      s(must(tax.lines[0]).taxableAmount),
    ]).toEqual(['0', null, '500']);
  });
  it('AC-5 rounding mode follows tax.rounding (up: 1,000 yen → 91)', () => {
    const up = computeSettlementTax([line({ amount: '1000' })], { ...settings, rounding: { mode: 'up', scale: 0 } });
    expect(s(must(up.lines[0]).taxAmount)).toBe('91');
  });
});

describe('invoice fields by kind (AC-5, AC-6, D21)', () => {
  const base = { taxCategory: 'standard', payeeName: 'JR東日本' };
  const paths = (fields: Record<string, unknown>) =>
    invoiceIssues({ ...base, ...fields }, 'lines[0]').map((i) => i.path);
  it('AC-6 a taxable line needs an invoice kind and a payee', () => {
    expect(paths({ invoiceKind: null })).toEqual(['lines[0].invoiceKind']);
    expect(paths({ invoiceKind: 'small_amount', payeeName: ' ' })).toEqual(['lines[0].payeeName']);
  });
  it('AC-6 qualified needs the registration number, books_only its reason; the others need neither', () => {
    expect(paths({ invoiceKind: 'qualified' })).toEqual(['lines[0].invoiceRegistrationNo']);
    expect(paths({ invoiceKind: 'qualified', invoiceRegistrationNo: 'T1234567890123' })).toEqual([]);
    expect(paths({ invoiceKind: 'books_only' })).toEqual(['lines[0].booksOnlyReason']);
    expect(paths({ invoiceKind: 'books_only', booksOnlyReason: 'public_transport' })).toEqual([]);
    expect(paths({ invoiceKind: 'not_qualified' })).toEqual([]);
    expect(paths({ invoiceKind: 'none' })).toEqual([]);
  });
  it('AC-5 zero-rate categories need no invoice fields', () => {
    expect(invoiceIssues({ taxCategory: 'exempt' }, 'lines[0]')).toEqual([]);
    expect(invoiceIssues({ taxCategory: 'out_of_scope', payeeName: null }, 'lines[0]')).toEqual([]);
  });
});
