import { Decimal } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { netByKey, validateLines } from '../src/services/balance.ts';

const line = (debit: number, credit: number) => ({
  debit: Decimal.from(debit),
  credit: Decimal.from(credit),
  seq: 1,
  partnerId: null,
  partnerRequired: false,
});

describe('AC-6 independent accounting references', () => {
  it('reports actionable errors even when invalid lines have equal debit and credit totals', () => {
    expect(validateLines([]).issues).toEqual([{ path: 'lines', message: 'a journal entry needs at least 2 lines' }]);
    for (const amounts of [
      [0, 0],
      [1, 1],
      [-1, -1],
    ] as const) {
      const result = validateLines([line(amounts[0], amounts[1]), line(amounts[0], amounts[1])]);
      expect(result.balanced).toBe(true);
      expect(result.issues).toHaveLength(2);
      expect(result.issues.map((issue) => issue.path)).toEqual(['lines[0]', 'lines[1]']);
      for (const issue of result.issues) expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it('retains the keys and exact nonzero net of independent integer postings', () => {
    const entry = fc.record({
      key: fc.constantFrom('cash', 'sales', 'cost'),
      debit: fc.integer({ min: 0, max: 1000000 }),
      credit: fc.integer({ min: 0, max: 1000000 }),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 25 }), (generated) => {
        // The prefix guarantees positive, negative and zero-net keys even if the tail shrinks to empty.
        const entries = [
          { key: 'positive', debit: 17, credit: 3 },
          { key: 'negative', debit: 1, credit: 9 },
          { key: 'zero', debit: 4, credit: 4 },
          ...generated,
        ];
        const expected = new Map<string, bigint>();
        for (const entry of entries)
          expected.set(entry.key, (expected.get(entry.key) ?? 0n) + BigInt(entry.debit) - BigInt(entry.credit));
        const actual = netByKey(
          entries.map((entry) => ({ ...line(entry.debit, entry.credit), key: entry.key })),
          (entry) => entry.key,
        );
        expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
        for (const [key, amount] of expected) expect(actual.get(key)?.toString()).toBe(amount.toString());
      }),
      { seed: 930604, numRuns: 150 },
    );
    expect(netByKey([], () => 'unused').size).toBe(0);
  });
});
