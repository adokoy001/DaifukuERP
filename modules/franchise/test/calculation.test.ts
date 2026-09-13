import { describe, it, expect } from 'vitest';
import { royalty, monthBounds, type FranchiseContractSnapshot } from '../src/index.ts';
const contract: FranchiseContractSnapshot = {
  code: 'F',
  name: 'Agreement',
  partnerId: 'test',
  direction: 'bill',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  basis: 'net',
  rate: '0.025',
  fixedAmount: '100',
  rounding: 'down',
  taxCategory: 'standard',
  expenseAccountId: null,
  version: 1,
};
describe('franchise declared-sales calculation', () => {
  it('uses the explicitly chosen gross/net basis and fixed fee, with exact contractual rounding', () => {
    expect(royalty(contract, '2026-08', '110011', '100010').toString()).toBe('2600');
    expect(royalty({ ...contract, rounding: 'up' }, '2026-08', '110011', '100010').toString()).toBe('2601');
    expect(
      royalty({ ...contract, basis: 'gross', rounding: 'half_up' }, '2026-08', '110020', '100000').toString(),
    ).toBe('2851');
  });
  it('does not silently prorate partial contract months or invert declared tax totals', () => {
    expect(() => royalty({ ...contract, startDate: '2026-08-02' }, '2026-08', '100', '100')).toThrow('契約期間');
    expect(() => royalty(contract, '2026-08', '99', '100')).toThrow('税込');
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
