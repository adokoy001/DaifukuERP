// Unit golden of the settlement posting (docs/specs/expense-settlement.md AC-7, AC-8): modules/expense/test/golden/
// settlement.json drives the pure tax computation, the journal lines and the clearing plan. Account ids are the codes
// themselves and the partner is "P"; settlement.db.test.ts checks the same golden against real postings.
import { Decimal, type LocalDate } from '@daifuku/kernel';
import { SEED_TAX_RATES, type RateRow } from '@daifuku/mod-tax';
import { describe, expect, it } from 'vitest';
import {
  clearingPlan,
  computeSettlementTax,
  settlementAmounts,
  settlementJournalLines,
  type TaxSettings,
} from '../src/index.ts';
import { testCreditRatioForDate } from './ratio.ts';
import { goldenCases, type GoldenCase } from './golden.ts';

const RATES = SEED_TAX_RATES.map((r) => ({ ...r, validTo: r.validTo ?? null })) as unknown as RateRow[];
const settings = (mode: GoldenCase['rounding']): TaxSettings => ({
  rates: RATES,
  rounding: { mode, scale: 0 },
  transitionalRatio: (date: LocalDate) => testCreditRatioForDate(date),
});
const s = (d: Decimal | string | number | null | undefined) =>
  d === null || d === undefined ? '0' : Decimal.from(d).toString();

function compute(c: GoldenCase) {
  const lines = c.receipts.flatMap((r) =>
    r.lines.map((l) => ({ ...l, expenseId: r.ref, expenseDate: r.expenseDate as LocalDate })),
  );
  const tax = computeSettlementTax(
    lines.map((l, i) => ({
      seq: i + 1,
      expenseId: l.expenseId,
      expenseDate: l.expenseDate,
      accountId: l.account,
      taxCategory: l.taxCategory,
      amount: Decimal.from(l.amount),
      invoiceKind: l.invoiceKind,
    })),
    settings(c.rounding),
  );
  const advance = Decimal.from(c.advance ?? '0');
  const journal = settlementJournalLines({
    kind: c.kind,
    partnerId: 'P',
    total: tax.totals.total,
    advanceAmount: advance,
    lines: lines.map((l, i) => ({
      accountId: l.account,
      taxCategory: l.taxCategory,
      taxRate: tax.lines[i]?.taxRate ?? Decimal.zero(),
      taxableAmount: tax.lines[i]?.taxableAmount ?? Decimal.zero(),
      nonDeductibleTax: tax.lines[i]?.nonDeductibleTax ?? Decimal.zero(),
    })),
    groups: tax.groups,
    accounts: { payable: '2150', advance: '1800', taxReceivable: '1500' },
  });
  return { tax, advance, journal };
}

describe('expense settlement posting golden (AC-8)', () => {
  for (const c of goldenCases())
    it(`AC-7 AC-8 golden ${c.id}: line tax, totals, journal lines and the clearing payment`, () => {
      const { tax, advance, journal } = compute(c);
      if (c.expect.lineTax)
        expect(tax.lines.map((l) => [s(l.taxAmount), s(l.deductibleTax), s(l.nonDeductibleTax)])).toEqual(
          c.expect.lineTax,
        );
      if (c.expect.creditRatio) expect(tax.lines.map((l) => s(l.creditRatio))).toEqual(c.expect.creditRatio);
      expect(Object.fromEntries(Object.entries(tax.totals).map(([k, v]) => [k, s(v)]))).toEqual(c.expect.totals);
      const amounts = settlementAmounts(c.kind, tax.totals.total, advance);
      expect({
        advanceAmount: s(advance),
        payAmount: s(amounts.payAmount),
        refundAmount: s(amounts.refundAmount),
      }).toEqual(c.expect.amounts);
      expect(
        journal.map((l) => [
          l.accountId,
          s(l.debit as Decimal | undefined),
          s(l.credit as Decimal | undefined),
          l.taxCategory ?? null,
          l.taxRate === undefined || l.taxRate === null ? null : s(l.taxRate as Decimal),
          l.memo ?? null,
          l.partnerId ?? null,
        ]),
      ).toEqual(c.expect.journal);
      const debit = Decimal.sum(journal.map((l) => Decimal.from((l.debit as Decimal | undefined) ?? 0)));
      const credit = Decimal.sum(journal.map((l) => Decimal.from((l.credit as Decimal | undefined) ?? 0)));
      expect(s(debit)).toBe(s(credit));
      if (journal.length > 0) expect(s(debit)).toBe(c.expect.totals.total);
      const plan = clearingPlan(c.kind, tax.totals.total, advance);
      expect(
        plan
          ? {
              direction: plan.direction,
              amount: s(plan.amount),
              counter: plan.counter === 'payable' ? '2150' : '1800',
            }
          : null,
      ).toEqual(c.expect.payment);
    });
});

describe('clearing plan (AC-7)', () => {
  it('AC-7 pays a reimbursement in full, never pays a corporate card, and settles the advance difference', () => {
    const d = (v: string) => Decimal.from(v);
    expect(clearingPlan('reimbursement', d('100'), d('0'))).toMatchObject({ direction: 'pay', counter: 'payable' });
    expect(clearingPlan('corporate_card', d('100'), d('0'))).toBeNull();
    expect(clearingPlan('advance', d('100'), d('100'))).toBeNull();
    expect(s(clearingPlan('advance', d('130'), d('100'))?.amount)).toBe('30');
    expect(clearingPlan('advance', d('70'), d('100'))).toMatchObject({ direction: 'receive', counter: 'advance' });
    expect(settlementAmounts('advance', d('0'), d('500'))).toMatchObject({ refundAmount: d('500') });
  });
});
