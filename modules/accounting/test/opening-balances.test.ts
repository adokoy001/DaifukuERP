// Unit tests for the pure opening-balance rules (docs/specs/opening-balances.md AC-1, AC-9..AC-11, AC-15, AC-23, AC-27).
import { Decimal } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import {
  accountRowIssue,
  classifyJournalAmounts,
  clearingMemo,
  journalIssues,
  journalTotals,
  openingDateOf,
  readCode,
  readDate,
  readOpeningAmount,
  readOpeningQuantity,
  readOpeningUnitCost,
  summarize,
  type OpeningMessage,
} from '../src/services/opening.ts';

const code = (v: unknown) => (v as OpeningMessage | undefined)?.code;
const D = (s: string) => Decimal.from(s);

describe('AC-1 openingDateOf', () => {
  it('AC-1: is the calendar day before the start (month start, year start, leap day)', () => {
    expect(openingDateOf('2026-04-01')).toBe('2026-03-31');
    expect(openingDateOf('2026-01-01')).toBe('2025-12-31');
    expect(openingDateOf('2024-03-01')).toBe('2024-02-29');
    expect(openingDateOf('2023-03-01')).toBe('2023-02-28');
    expect(openingDateOf('2026-10-01')).toBe('2026-09-30');
  });
});

describe('AC-9 classifyJournalAmounts', () => {
  it('AC-9: blank/0 skip, unreadable, negative, both sides and fractions in the spec order', () => {
    expect(classifyJournalAmounts({ debit: '', credit: null })).toMatchObject({ status: 'skipped' });
    expect(classifyJournalAmounts({ debit: '0', credit: '0.00' })).toMatchObject({
      status: 'skipped',
      messages: [{ code: 'zero_amount' }],
    });
    expect(classifyJournalAmounts({ debit: '1a' })).toMatchObject({
      status: 'error',
      messages: [{ code: 'invalid_value', field: 'debit', column: 'debit' }],
    });
    // unreadable comes before zero/negative checks, even when the other side is fine
    expect(classifyJournalAmounts({ debit: '-1', credit: 'x' })).toMatchObject({
      messages: [{ code: 'invalid_value', field: 'credit' }],
    });
    expect(classifyJournalAmounts({ credit: '−500' })).toMatchObject({ messages: [{ code: 'negative_amount' }] });
    expect(classifyJournalAmounts({ debit: '1', credit: '1' })).toMatchObject({ messages: [{ code: 'both_sides' }] });
    expect(classifyJournalAmounts({ debit: '10.5' })).toMatchObject({ messages: [{ code: 'not_whole_yen' }] });
  });

  it('AC-9: B5 cell conversion — commas, full-width digits, no float', () => {
    const r = classifyJournalAmounts({ debit: '１，２３４，５６７' });
    expect(r).toMatchObject({ status: 'ok', side: 'debit' });
    expect(r.status === 'ok' && r.amount.toString()).toBe('1234567');
    const big = classifyJournalAmounts({ credit: '12345678901234567890' });
    expect(big.status === 'ok' && big.amount.toString()).toBe('12345678901234567890');
    expect(classifyJournalAmounts({ credit: '100.00' })).toMatchObject({ status: 'ok', side: 'credit' });
  });
});

describe('AC-9 AC-10 accounts', () => {
  const base = { id: 'a', code: '1300', name: '売掛金', type: 'asset', partnerRequired: true };
  it('AC-9: revenue/expense accounts and the clearing account are refused', () => {
    expect(accountRowIssue({ ...base, type: 'revenue' }, 'c')?.code).toBe('pl_account');
    expect(accountRowIssue({ ...base, type: 'expense' }, 'c')?.code).toBe('pl_account');
    expect(accountRowIssue({ ...base, id: 'c', type: 'equity' }, 'c')?.code).toBe('clearing_account');
    expect(accountRowIssue(base, 'c')).toBeNull();
  });
  it('AC-10: the clearing memo names the original account', () => {
    expect(clearingMemo(base)).toBe('期首残高 1300 売掛金（取引先別は期首請求書）');
    expect(clearingMemo(base, '合計')).toBe('期首残高 1300 売掛金（取引先別は期首請求書） 合計');
    expect(clearingMemo({ code: 'X', name: 'あ'.repeat(300) })).toHaveLength(200);
  });
});

describe('AC-11 totals and issues', () => {
  it('AC-11: exact Decimal totals; unbalanced and fewer than 2 lines are issues', () => {
    const lines = [
      { side: 'debit' as const, amount: D('0.1') },
      { side: 'debit' as const, amount: D('0.2') },
      { side: 'credit' as const, amount: D('0.3') },
    ];
    expect(journalTotals(lines).difference.toString()).toBe('0');
    expect(journalIssues(lines)).toEqual([]);
    expect(journalIssues(lines.slice(0, 1))[0]?.code).toBe('no_lines');
    const off = journalIssues([
      { side: 'debit', amount: D('1000') },
      { side: 'credit', amount: D('999') },
    ]);
    expect(off[0]).toMatchObject({ code: 'unbalanced' });
    expect(off[0]?.message).toContain('differ by 1');
  });
});

describe('AC-15 AC-23 cells', () => {
  it('AC-15: opening amounts are positive whole yen', () => {
    expect(code(readOpeningAmount('amount', ''))).toBe('zero_amount');
    expect(code(readOpeningAmount('amount', '0'))).toBe('zero_amount');
    expect(code(readOpeningAmount('amount', '-3'))).toBe('negative_amount');
    expect(code(readOpeningAmount('amount', '3.1'))).toBe('not_whole_yen');
    expect(code(readOpeningAmount('amount', 'abc'))).toBe('invalid_value');
    expect(readOpeningAmount('amount', '1,000').toString()).toBe('1000');
  });
  it('AC-15: dates read as YYYY-MM-DD or YYYY/M/D; impossible dates are invalid_value', () => {
    expect(readDate('dueDate', '2026/4/5')).toBe('2026-04-05');
    expect(readDate('dueDate', ' ')).toBeUndefined();
    expect(code(readDate('dueDate', '2026-02-30'))).toBe('invalid_value');
  });
  it('AC-9 AC-15 AC-23 D-12: $ctx. codes are refused without a query; others are trimmed', () => {
    expect(code(readCode('partnerCode', '$ctx.companyId'))).toBe('invalid_value');
    expect(readCode('partnerCode', '  C001 ')).toBe('C001');
    expect(readCode('partnerCode', null)).toBeUndefined();
  });
  it('AC-23: quantity > 0 and unit cost ≥ 0, at most 6 decimals', () => {
    expect(code(readOpeningQuantity('0'))).toBe('non_positive_quantity');
    expect(code(readOpeningQuantity(''))).toBe('non_positive_quantity');
    expect(code(readOpeningQuantity('1.0000001'))).toBe('scale_exceeded');
    expect(code(readOpeningQuantity('q'))).toBe('invalid_value');
    expect(readOpeningQuantity('1.000000').toString()).toBe('1');
    expect(code(readOpeningUnitCost(''))).toBe('invalid_value');
    expect(code(readOpeningUnitCost('-0.5'))).toBe('negative_amount');
    expect(code(readOpeningUnitCost('0.1234567'))).toBe('scale_exceeded');
    expect(readOpeningUnitCost('0').toString()).toBe('0');
  });
});

describe('AC-27 summarize', () => {
  it('AC-27: accepted counts ok and clearing rows', () => {
    expect(
      summarize([
        { line: 1, status: 'ok' },
        { line: 2, status: 'clearing' },
        { line: 3, status: 'skipped' },
        { line: 4, status: 'error' },
      ]),
    ).toEqual({ rows: 4, accepted: 2, clearing: 1, skipped: 1, errors: 1 });
  });
});
