// Pure double-entry rules (spec AC-4, AC-6, AC-8, AC-12) — examples + fast-check properties, no DB.
import { Decimal } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isBalanced,
  netByKey,
  reverseLines,
  sumLines,
  validateLines,
  xorIssue,
  type LineCheck,
} from '../src/services/balance.ts';
import { runningBalances, splitOpening, trialBalanceRows, type Movement } from '../src/services/ledger.ts';

const D = (s: string | number) => Decimal.from(s);
const line = (debit: string, credit: string, extra: Partial<LineCheck> = {}): LineCheck => ({
  seq: 1,
  debit: D(debit),
  credit: D(credit),
  partnerId: null,
  partnerRequired: false,
  ...extra,
});

/** Amounts as integer cents (JS integers are exact) rendered as decimal strings. */
const cents = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
const arbCents = fc.integer({ min: 1, max: 100_000_000 });

/** Splits `total` cents into `weights.length` positive parts (each ≥ 1 cent). Requires total ≥ weights.length. */
function splitCents(total: number, weights: number[]): number[] {
  const k = weights.length;
  const rest = total - k;
  const wsum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => 1 + Math.floor((rest * w) / wsum));
  const assigned = parts.reduce((a, b) => a + b, 0);
  parts[k - 1] = (parts[k - 1] ?? 0) + (total - assigned);
  return parts;
}

/** A balanced line set: 1..5 debit lines and 1..5 credit lines with equal totals (never more credit parts than cents). */
const arbBalanced = fc
  .record({
    debits: fc.array(arbCents, { minLength: 1, maxLength: 5 }),
    weights: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
  })
  .map(({ debits, weights }) => {
    const total = debits.reduce((a, b) => a + b, 0);
    const credits = splitCents(total, weights.slice(0, Math.min(weights.length, total)));
    return [...debits.map((c) => line(cents(c), '0')), ...credits.map((c) => line('0', cents(c)))].map((l, i) => ({
      ...l,
      seq: i + 1,
    }));
  });

/** A balanced set with one line disturbed by a non-zero amount. */
const arbUnbalanced = fc
  .tuple(arbBalanced, fc.integer({ min: 1, max: 100_000 }), fc.nat())
  .map(([lines, delta, pick]) => {
    const i = pick % lines.length;
    const target = lines[i] as LineCheck;
    const bump = D(cents(delta));
    const changed = target.debit.gt(0)
      ? { ...target, debit: target.debit.plus(bump) }
      : { ...target, credit: target.credit.plus(bump) };
    return lines.map((l, j) => (j === i ? changed : l));
  });

describe('xorIssue / validateLines (AC-4) — examples', () => {
  it('accepts a line with exactly one positive side and rejects both/none/negative', () => {
    expect(xorIssue({ debit: D('100'), credit: D('0') }, 'l')).toBeNull();
    expect(xorIssue({ debit: D('0'), credit: D('0.01') }, 'l')).toBeNull();
    expect(xorIssue({ debit: D('1'), credit: D('1') }, 'l')?.message).toMatch(/not both/);
    expect(xorIssue({ debit: D('0'), credit: D('0') }, 'l')?.message).toMatch(/greater than 0/);
    expect(xorIssue({ debit: D('-1'), credit: D('0') }, 'l')?.message).toMatch(/negative/);
  });

  it('needs at least 2 lines, equal totals (exact Decimal) and a partner where the account requires one', () => {
    expect(validateLines([line('100', '0')]).issues.map((i) => i.path)).toEqual(['lines', 'lines']);
    const off = validateLines([line('100', '0'), line('0', '99.999999')]);
    expect(off.balanced).toBe(false);
    expect(off.issues).toEqual([{ path: 'lines', message: 'debits (100) and credits (99.999999) differ by 0.000001' }]);
    const noPartner = validateLines([line('100', '0', { partnerRequired: true }), line('0', '100')]);
    expect(noPartner.issues).toEqual([
      { path: 'lines[0].partnerId', message: 'line 1: the account requires a partner' },
    ]);
    const ok = validateLines([
      line('100', '0', { partnerRequired: true, partnerId: 'p' }),
      line('0', '60'),
      line('0', '40'),
    ]);
    expect(ok.issues).toEqual([]);
    expect(ok.totalDebit.toString()).toBe('100');
    expect(ok.totalCredit.toString()).toBe('100');
  });

  it('sumLines/isBalanced are exact (no float drift on 0.1 + 0.2)', () => {
    const lines = [line('0.1', '0'), line('0.2', '0'), line('0', '0.3')];
    expect(sumLines(lines).totalDebit.toString()).toBe('0.3');
    expect(isBalanced(lines)).toBe(true);
  });
});

describe('reverseLines (AC-6) — examples', () => {
  it('swaps debit and credit and keeps every other field', () => {
    const rev = reverseLines([line('100', '0', { seq: 1, partnerId: 'p' }), line('0', '100', { seq: 2 })]);
    expect(rev.map((l) => [l.seq, l.debit.toString(), l.credit.toString(), l.partnerId])).toEqual([
      [1, '0', '100', 'p'],
      [2, '100', '0', null],
    ]);
  });
});

describe('trial balance rows / running balance (AC-8, AC-9) — examples', () => {
  const accounts = [
    { id: 'cash', code: '1000', name: '現金', type: 'asset' },
    { id: 'sales', code: '4000', name: '売上', type: 'revenue' },
    { id: 'idle', code: '9000', name: '未使用', type: 'expense' },
  ];
  it('shows the opening net on one side, adds the period, and totals every amount column', () => {
    const opening = new Map<string, Movement>([
      ['cash', { debit: D('500'), credit: D('200') }],
      ['sales', { debit: D('200'), credit: D('500') }],
    ]);
    const period = new Map<string, Movement>([
      ['cash', { debit: D('100'), credit: D('0') }],
      ['sales', { debit: D('0'), credit: D('100') }],
    ]);
    const { rows, totals } = trialBalanceRows(accounts, opening, period);
    expect(
      rows.map((r) => [r.code, r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit, r.closingBalance]),
    ).toEqual([
      ['1000', '300', '0', '100', '0', '400'],
      ['4000', '0', '300', '0', '100', '-400'],
      ['9000', '0', '0', '0', '0', '0'],
    ]);
    expect(totals).toEqual({
      openingDebit: '300',
      openingCredit: '300',
      periodDebit: '100',
      periodCredit: '100',
      closingBalance: '0',
    });
    expect(splitOpening({ debit: D('1'), credit: D('1') })).toEqual({ openingDebit: D('0'), openingCredit: D('0') });
  });

  it('running balance starts from the opening balance and is debit-positive', () => {
    const b = runningBalances(D('10'), [line('5', '0'), line('0', '20'), line('0', '0')]);
    expect(b.map((x) => x.toString())).toEqual(['15', '-5', '-5']);
    expect(runningBalances(D('3'), [])).toEqual([]);
  });
});

describe('properties (AC-12)', () => {
  it('random balanced line sets pass validation with equal totals', () => {
    fc.assert(
      fc.property(arbBalanced, (lines) => {
        const v = validateLines(lines);
        expect(v.issues).toEqual([]);
        expect(v.balanced).toBe(true);
        expect(v.totalDebit.eq(v.totalCredit)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('random unbalanced line sets always fail with a totals issue', () => {
    fc.assert(
      fc.property(arbUnbalanced, (lines) => {
        const v = validateLines(lines);
        expect(v.balanced).toBe(false);
        expect(v.issues.some((i) => i.path === 'lines' && /differ by/.test(i.message))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('a reversal swaps the totals, is an involution, and leaves every key’s net (debit − credit) at zero', () => {
    const arbKeyed = arbBalanced.map((lines) => lines.map((l, i) => ({ ...l, key: `a${i % 3}` })));
    fc.assert(
      fc.property(arbKeyed, (lines) => {
        const rev = reverseLines(lines);
        const t = sumLines(lines);
        const r = sumLines(rev);
        expect(r.totalDebit.eq(t.totalCredit) && r.totalCredit.eq(t.totalDebit)).toBe(true);
        expect(isBalanced(rev)).toBe(true);
        expect(reverseLines(rev)).toEqual(lines);
        const net = netByKey([...lines, ...rev], (l) => l.key);
        for (const v of net.values()) expect(v.isZero()).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('trial balance totals: closing sums to zero whenever opening and period movements are balanced', () => {
    const arbMov = fc.array(fc.record({ id: fc.constantFrom('a', 'b', 'c', 'd'), lines: arbBalanced }), {
      minLength: 0,
      maxLength: 6,
    });
    const toMap = (chunks: { id: string; lines: LineCheck[] }[]) => {
      const m = new Map<string, Movement>();
      for (const c of chunks) {
        const t = sumLines(c.lines);
        const prev = m.get(c.id) ?? { debit: D(0), credit: D(0) };
        // Balanced sets are spread over two accounts so the map itself stays balanced overall.
        const other = c.id === 'a' ? 'b' : 'a';
        const po = m.get(other) ?? { debit: D(0), credit: D(0) };
        m.set(c.id, { debit: prev.debit.plus(t.totalDebit), credit: prev.credit });
        m.set(other, { debit: po.debit, credit: po.credit.plus(t.totalCredit) });
      }
      return m;
    };
    const accounts = ['a', 'b', 'c', 'd'].map((id) => ({ id, code: id, name: id, type: 'asset' }));
    fc.assert(
      fc.property(arbMov, arbMov, (o, p) => {
        const { rows, totals } = trialBalanceRows(accounts, toMap(o), toMap(p));
        expect(rows).toHaveLength(4);
        expect(D(totals.closingBalance).isZero()).toBe(true);
        expect(D(totals.openingDebit).eq(D(totals.openingCredit))).toBe(true);
        expect(D(totals.periodDebit).eq(D(totals.periodCredit))).toBe(true);
        for (const r of rows) expect(D(r.openingDebit).isZero() || D(r.openingCredit).isZero()).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
