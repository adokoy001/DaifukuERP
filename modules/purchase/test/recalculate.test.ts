// Pure services of modules/purchase: credit split (AC-2), journal lines (AC-3), aging and payment arithmetic (AC-5), the
// default credit ratio (AC-2) and the hand-derived golden file (AC-7). No DB.
import { Decimal, ROUNDING_MODES, StateError, ValidationError, type RoundingMode } from '@daifuku/kernel';
import { summarizeTax, type TaxCategory } from '@daifuku/mod-tax';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { agingBucket, agingRows, daysBetween } from '../src/services/aging.ts';
import { golden } from './golden.ts';
import { assertCreditRatio, defaultCreditRatio, PURCHASE_CREDIT_RATIO_POINT } from '../src/services/credit-ratio.ts';
import { applyPaymentAmounts, isPaymentIssue } from '../src/services/payment.ts';
import { buildJournalLines, lineAccount, NON_DEDUCTIBLE_MEMO, type PostingAccounts, type PostingLine } from '../src/services/posting.ts';
import { applyCreditRatio, calculationToJson, lineAmount, splitTax, type TaxSummaryLike } from '../src/services/recalculate.ts';

const ACCOUNTS: PostingAccounts = { purchases: 'acc-5000', payable: 'acc-2100', taxReceivable: 'acc-1500' };
const CODE_OF: Record<string, string> = { 'acc-5000': '5000', 'acc-2100': '2100', 'acc-1500': '1500', 'acc-6400': '6400' };
const RATE: Record<TaxCategory, string> = { standard: '0.1', reduced: '0.08', exempt: '0', non_taxable: '0', out_of_scope: '0' };
const LABEL: Record<TaxCategory, string> = { standard: '標準10%', reduced: '軽減8%', exempt: '免税', non_taxable: '非課税', out_of_scope: '不課税' };

/** A tax summary the way modules/tax produces it (one rounding per rate), for the given lines. */
function summaryOf(lines: readonly { amount: string; category: TaxCategory }[], priceIncludesTax: boolean, mode: RoundingMode = 'down', scale = 0): TaxSummaryLike {
  const s = summarizeTax(
    lines.map((l) => ({ amount: l.amount, category: l.category, rate: RATE[l.category] })),
    { roundingMode: mode, scale, priceIncludesTax },
  );
  return { priceIncludesTax, rounding: { mode, scale }, groups: s.groups.map((g) => ({ ...g, code: g.category.toUpperCase(), label: LABEL[g.category] })) };
}

const dec = (s: string) => Decimal.from(s);
const str = (d: Decimal | string | undefined | null) => (d === undefined || d === null ? '0' : Decimal.from(d).toString());

describe('credit ratio (AC-2)', () => {
  it('default: registered → 1, exempt → 0, anything else → VALIDATION; the point name is fixed', () => {
    expect(PURCHASE_CREDIT_RATIO_POINT).toBe('purchase.exempt_supplier_credit_ratio');
    expect(defaultCreditRatio({ supplierTaxStatus: 'registered', date: '2026-10-15' }).toString()).toBe('1');
    expect(defaultCreditRatio({ supplierTaxStatus: 'exempt', date: '2026-10-15' }).toString()).toBe('0');
    expect(() => defaultCreditRatio({ supplierTaxStatus: 'other' as 'exempt', date: '2026-10-15' })).toThrow(ValidationError);
  });
  it('assertCreditRatio rejects non-Decimal, negative and > 1 results from an override', () => {
    const input = { supplierTaxStatus: 'exempt' as const, date: '2026-10-15' };
    expect(assertCreditRatio(dec('0.7'), input).toString()).toBe('0.7');
    for (const bad of [0.7, '0.7', dec('-0.1'), dec('1.5'), null, undefined]) expect(() => assertCreditRatio(bad, input), String(bad)).toThrow(StateError);
  });
});

describe('recalculate (AC-2)', () => {
  it('lineAmount = quantity × unitPrice, unrounded', () => {
    expect(lineAmount('3', '333.33').toString()).toBe('999.99');
    expect(lineAmount(dec('1.5'), '1000').toString()).toBe('1500');
  });
  it('splitTax rounds the deductible part once with the given mode; the remainder is non-deductible', () => {
    expect(splitTax(dec('1001'), dec('0.7'), 'down', 0)).toMatchObject({ deductibleTax: dec('700'), nonDeductibleTax: dec('301') });
    expect(splitTax(dec('1001'), dec('0.7'), 'half_up', 0)).toMatchObject({ deductibleTax: dec('701'), nonDeductibleTax: dec('300') });
    expect(splitTax(dec('1001'), dec('0.7'), 'up', 0)).toMatchObject({ deductibleTax: dec('701'), nonDeductibleTax: dec('300') });
    expect(splitTax(dec('123.45'), dec('0.8'), 'down', 2)).toMatchObject({ deductibleTax: dec('98.76'), nonDeductibleTax: dec('24.69') });
    expect(splitTax(dec('0'), dec('0.7'), 'down', 0).deductibleTax.toString()).toBe('0');
  });
  it('applyCreditRatio splits per rate group and totals the header; JSON carries decimal strings', () => {
    const s = summaryOf([{ amount: '11000', category: 'standard' }, { amount: '5400', category: 'reduced' }, { amount: '1000', category: 'non_taxable' }], true);
    const c = applyCreditRatio(s, dec('0.7'));
    expect(c.groups.map((g) => [g.category, str(g.taxable), str(g.tax), str(g.deductibleTax), str(g.nonDeductibleTax)])).toEqual([
      ['standard', '10000', '1000', '700', '300'],
      ['reduced', '5000', '400', '280', '120'],
      ['non_taxable', '1000', '0', '0', '0'],
    ]);
    expect({ subtotal: str(c.totals.subtotal), taxTotal: str(c.totals.taxTotal), deductibleTax: str(c.totals.deductibleTax), nonDeductibleTax: str(c.totals.nonDeductibleTax), total: str(c.totals.total) }).toEqual({ subtotal: '16000', taxTotal: '1400', deductibleTax: '980', nonDeductibleTax: '420', total: '17400' });
    const j = calculationToJson(c);
    expect(j.creditRatio).toBe('0.7');
    expect(j.totals).toEqual({ subtotal: '16000', taxTotal: '1400', deductibleTax: '980', nonDeductibleTax: '420', total: '17400' });
    expect(j.groups[0]).toMatchObject({ category: 'standard', code: 'STANDARD', label: '標準10%', rate: '0.1', gross: '11000', lineCount: 1, deductibleTax: '700' });
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  });
  it('empty summary → all zero', () => {
    const c = applyCreditRatio(summaryOf([], true), dec('0.7'));
    expect(c.groups).toEqual([]);
    expect(str(c.totals.total)).toBe('0');
  });
});

describe('posting (AC-3)', () => {
  const post = (lines: PostingLine[], priceIncludesTax: boolean, ratio: string, mode: RoundingMode = 'down') => {
    const s = summaryOf(
      lines.map((l) => ({ amount: l.amount.toString(), category: l.taxCategory })),
      priceIncludesTax,
      mode,
    );
    const c = applyCreditRatio(s, dec(ratio));
    return { calc: c, lines: buildJournalLines({ partnerId: 'p1', priceIncludesTax, rounding: c.rounding, lines, groups: c.groups, totals: c.totals, accounts: ACCOUNTS }) };
  };
  const flat = (l: { accountId: string; debit?: Decimal | string | undefined; credit?: Decimal | string | undefined; memo?: string | null | undefined }) => [CODE_OF[l.accountId] ?? l.accountId, str(l.debit), str(l.credit), l.memo ?? null];

  it('product lines go to the purchases account, expense lines to their account; partner on the payable line', () => {
    expect(lineAccount({ productId: 'prod', accountId: null }, ACCOUNTS)).toBe('acc-5000');
    expect(lineAccount({ productId: 'prod', accountId: 'acc-6400' }, ACCOUNTS)).toBe('acc-6400');
    const { lines } = post([{ productId: 'prod', accountId: null, amount: dec('10000'), taxCategory: 'standard' }, { productId: null, accountId: 'acc-6400', amount: dec('2000'), taxCategory: 'standard' }], false, '1');
    expect(lines.map(flat)).toEqual([
      ['5000', '10000', '0', null],
      ['6400', '2000', '0', null],
      ['1500', '1200', '0', '仮払消費税 標準10%'],
      ['2100', '0', '13200', null],
    ]);
    expect(lines[0]).toMatchObject({ taxCategory: 'standard', taxRate: dec('0.1') });
    expect(lines[3]).toMatchObject({ partnerId: 'p1' });
  });
  it('税込 with several accounts in one rate group: the rounded tax is allocated and the debits sum to the group taxable exactly', () => {
    // 3 × 3,667 = 11,001 gross → tax = round(11001 × 0.1 / 1.1) = 1000 (1000.09…), taxable 10,001
    const { lines, calc } = post(
      [
        { productId: 'p', accountId: null, amount: dec('3667'), taxCategory: 'standard' },
        { productId: null, accountId: 'acc-6400', amount: dec('3667'), taxCategory: 'standard' },
        { productId: null, accountId: 'acc-6400', amount: dec('3667'), taxCategory: 'standard' },
      ],
      true,
      '0.7',
    );
    expect(str(calc.totals.subtotal)).toBe('10001');
    expect(str(calc.totals.taxTotal)).toBe('1000');
    // 5000: 3667 − round(3667×0.1/1.1 = 333.36) = 3334; 6400: 7334 − (1000 − 333) = 6667; Σ = 10001
    expect(lines.map(flat)).toEqual([
      ['5000', '3334', '0', null],
      ['6400', '6667', '0', null],
      ['1500', '700', '0', '仮払消費税 標準10%'],
      ['5000', '300', '0', NON_DEDUCTIBLE_MEMO],
      ['2100', '0', '11001', null],
    ]);
  });
  it('zero-rate lines post no tax line; a zero total posts nothing on the payable; negative totals (credit notes) mirror sides', () => {
    const a = post([{ productId: 'p', accountId: null, amount: dec('500'), taxCategory: 'non_taxable' }], true, '0.7');
    expect(a.lines.map(flat)).toEqual([
      ['5000', '500', '0', null],
      ['2100', '0', '500', null],
    ]);
    const b = post([{ productId: 'p', accountId: null, amount: dec('-11000'), taxCategory: 'standard' }], true, '0.7');
    expect(b.lines.map(flat)).toEqual([
      ['5000', '0', '10000', null],
      ['1500', '0', '700', '仮払消費税 標準10%'],
      ['5000', '0', '300', NON_DEDUCTIBLE_MEMO],
      ['2100', '11000', '0', null],
    ]);
    expect(post([], true, '0.7').lines).toEqual([]);
  });

  const arbCategory = fc.constantFrom<TaxCategory>('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope');
  const arbLine = fc.record({ account: fc.constantFrom('acc-5000', 'acc-6400', 'acc-7000', null), amount: fc.integer({ min: -100000, max: 1000000 }), category: arbCategory });
  const arbRatio = fc.constantFrom('0', '0.3', '0.5', '0.7', '0.8', '1');
  it('property: the entry always balances, Σ debit on the payable side equals total, and every line is debit XOR credit ≥ 0', () => {
    fc.assert(
      fc.property(fc.array(arbLine, { minLength: 1, maxLength: 8 }), fc.boolean(), arbRatio, fc.constantFrom<RoundingMode>(...ROUNDING_MODES), (rows, inclusive, ratio, mode) => {
        const lines: PostingLine[] = rows.map((r) => ({ productId: r.account ? null : 'prod', accountId: r.account, amount: dec(String(r.amount)), taxCategory: r.category }));
        const { lines: jl, calc } = post(lines, inclusive, ratio, mode);
        const debit = Decimal.sum(jl.map((l) => Decimal.from(l.debit ?? '0')));
        const credit = Decimal.sum(jl.map((l) => Decimal.from(l.credit ?? '0')));
        expect(debit.toString()).toBe(credit.toString());
        for (const l of jl) {
          expect(l.debit !== undefined && l.credit !== undefined).toBe(false);
          expect(Decimal.from(l.debit ?? l.credit ?? '0').isNegative()).toBe(false);
          expect(Decimal.from(l.debit ?? l.credit ?? '0').isZero()).toBe(false);
        }
        const payable = jl.filter((l) => l.accountId === ACCOUNTS.payable);
        const payableNet = Decimal.sum(payable.map((l) => Decimal.from(l.credit ?? '0').minus(l.debit ?? '0')));
        expect(payableNet.toString()).toBe(calc.totals.total.toString());
        const inputTax = Decimal.sum(jl.filter((l) => l.accountId === ACCOUNTS.taxReceivable).map((l) => Decimal.from(l.debit ?? '0').minus(l.credit ?? '0')));
        expect(inputTax.toString()).toBe(calc.totals.deductibleTax.toString());
      }),
      { numRuns: 300 },
    );
  });
  it('property: per group deductible + nonDeductible = tax and |deductible| ≤ |tax|', () => {
    fc.assert(
      fc.property(fc.array(arbLine, { minLength: 1, maxLength: 6 }), fc.boolean(), arbRatio, (rows, inclusive, ratio) => {
        const s = summaryOf(
          rows.map((r) => ({ amount: String(r.amount), category: r.category })),
          inclusive,
        );
        const c = applyCreditRatio(s, dec(ratio));
        for (const g of c.groups) {
          expect(g.deductibleTax.plus(g.nonDeductibleTax).toString()).toBe(g.tax.toString());
          expect(g.deductibleTax.abs().lte(g.tax.abs())).toBe(true);
        }
        expect(c.totals.subtotal.plus(c.totals.taxTotal).toString()).toBe(c.totals.total.toString());
      }),
      { numRuns: 300 },
    );
  });
});

describe('aging and payments (AC-5)', () => {
  it('agingBucket by days overdue; daysBetween is calendar days', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1);
    expect(agingBucket('2026-10-31', '2026-10-31')).toBe('notDue');
    expect(agingBucket('2026-10-31', '2026-11-01')).toBe('days1to30');
    expect(agingBucket('2026-10-31', '2026-11-30')).toBe('days1to30');
    expect(agingBucket('2026-10-31', '2026-12-01')).toBe('days31to60');
    expect(agingBucket('2026-10-31', '2026-12-30')).toBe('days31to60');
    expect(agingBucket('2026-10-31', '2026-12-31')).toBe('days61to90');
    expect(agingBucket('2026-10-31', '2027-01-29')).toBe('days61to90');
    expect(agingBucket('2026-10-31', '2027-01-30')).toBe('over90');
  });
  it('agingRows: one row per partner sorted by code, buckets, totals; missing due date uses the bill date; unknown partner shown by id', () => {
    const partners = new Map([
      ['pB', { code: 'B01', name: 'B社' }],
      ['pA', { code: 'A01', name: 'A社' }],
    ]);
    const r = agingRows(
      [
        { partnerId: 'pB', date: '2026-09-01', dueDate: '2026-09-30', balance: dec('1000') },
        { partnerId: 'pB', date: '2026-07-01', dueDate: '2026-07-31', balance: dec('50') },
        { partnerId: 'pA', date: '2026-10-01', dueDate: null, balance: dec('300') },
        { partnerId: 'pX', date: '2026-01-01', dueDate: '2026-01-31', balance: dec('7') },
      ],
      partners,
      '2026-10-15',
    );
    expect(r.rows.map((x) => [x.partnerCode, x.partnerName, x.billCount, x.notDue, x.days1to30, x.days31to60, x.days61to90, x.over90, x.balance])).toEqual([
      ['A01', 'A社', 1, '0', '300', '0', '0', '0', '300'],
      ['B01', 'B社', 2, '0', '1000', '0', '50', '0', '1050'],
      [null, 'pX', 1, '0', '0', '0', '0', '7', '7'],
    ]);
    expect(r.totals).toEqual({ notDue: '0', days1to30: '1300', days31to60: '0', days61to90: '50', over90: '7', balance: '1357' });
    expect(agingRows([], partners, '2026-10-15')).toEqual({ rows: [], totals: { notDue: '0', days1to30: '0', days31to60: '0', days61to90: '0', over90: '0', balance: '0' } });
  });
  it('applyPaymentAmounts: partial → open, full → paid, negative un-applies; zero / overshoot / below zero are issues', () => {
    const t = dec('11000');
    expect(applyPaymentAmounts(t, dec('0'), dec('4000'))).toMatchObject({ paidAmount: dec('4000'), balance: dec('7000'), status: 'open' });
    expect(applyPaymentAmounts(t, dec('4000'), dec('7000'))).toMatchObject({ paidAmount: dec('11000'), balance: dec('0'), status: 'paid' });
    expect(applyPaymentAmounts(t, dec('11000'), dec('-11000'))).toMatchObject({ paidAmount: dec('0'), balance: dec('11000'), status: 'open' });
    expect(isPaymentIssue(applyPaymentAmounts(t, dec('0'), dec('0')))).toBe(true);
    expect(isPaymentIssue(applyPaymentAmounts(t, dec('4000'), dec('7001')))).toBe(true);
    expect(isPaymentIssue(applyPaymentAmounts(t, dec('0'), dec('-1')))).toBe(true);
    // credit note (negative total): the range is total..0
    expect(applyPaymentAmounts(dec('-500'), dec('0'), dec('-500'))).toMatchObject({ status: 'paid' });
    expect(isPaymentIssue(applyPaymentAmounts(dec('-500'), dec('0'), dec('100')))).toBe(true);
  });
});

// ---- golden (AC-7): file parsed in ./golden.ts (shared with the DB test) ---------------------------

describe('golden test/golden/exempt-supplier.json (AC-7)', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      expect(RATE.standard).toBe(golden.bill.rate);
      const s = summaryOf(golden.bill.lines, golden.bill.priceIncludesTax, golden.bill.rounding.mode, golden.bill.rounding.scale);
      const calc = applyCreditRatio(s, dec(c.creditRatio));
      const j = calculationToJson(calc);
      expect(j.totals).toEqual({ subtotal: c.expected.subtotal, taxTotal: c.expected.taxTotal, deductibleTax: c.expected.deductibleTax, nonDeductibleTax: c.expected.nonDeductibleTax, total: c.expected.total });
      const lines = buildJournalLines({
        partnerId: 'supplier',
        priceIncludesTax: golden.bill.priceIncludesTax,
        rounding: calc.rounding,
        lines: golden.bill.lines.map((l) => ({ productId: 'prod', accountId: null, amount: dec(l.amount), taxCategory: l.category })),
        groups: calc.groups,
        totals: calc.totals,
        accounts: ACCOUNTS,
      });
      expect(lines.map((l) => ({ account: CODE_OF[l.accountId], debit: str(l.debit), credit: str(l.credit), memo: l.memo ?? null }))).toEqual(c.expected.journal);
      const byAccount: Record<string, string> = {};
      for (const l of lines) {
        const code = CODE_OF[l.accountId] ?? l.accountId;
        byAccount[code] = Decimal.from(byAccount[code] ?? '0').plus(l.debit ?? '0').minus(l.credit ?? '0').toString();
      }
      expect(byAccount).toEqual(c.expected.byAccount);
    });
  }
});
