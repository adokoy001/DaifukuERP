import { describe, expect, it } from 'vitest';
import { businessToday, chartRatio, maximumMagnitude, parseOperationsSearch, validDate } from './operations.ts';
describe('operations dates and exact chart scaling', () => {
  it('uses Tokyo dates across the UTC month boundary', () => {
    expect(businessToday(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10-01');
    expect(parseOperationsSearch({}, new Date('2026-09-30T15:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-01', asOf: '2026-10-01' });
  });
  it('rejects impossible dates instead of silently shifting month', () => {
    expect(validDate('2026-02-29')).toBe(false);
    expect(validDate('2028-02-29')).toBe(true);
    expect(validDate('2026-13-01')).toBe(false);
    expect(validDate('2026-2-01')).toBe(false);
  });
  it('preserves explicit criteria and discards malformed store selectors', () => {
    expect(parseOperationsSearch({ from: '2026-09-01', to: '2026-09-05', asOf: '2026-09-06', storeId: 'bad' })).toEqual({ from: '2026-09-01', to: '2026-09-05', asOf: '2026-09-06' });
  });
  it('compares amounts beyond safe Number precision', () => {
    expect(maximumMagnitude(['-9007199254740993.000001', '9007199254740993', '0.0000001'])).toBe('9007199254740993.000001');
    expect(chartRatio('4503599627370496.5000005', '9007199254740993.000001')).toBe(0.5);
    expect(chartRatio('-5.25', '10.5')).toBe(-0.5);
  });
  it('handles zero, tiny and invalid amounts with finite bounded coordinates', () => {
    expect(chartRatio('0', '0')).toBe(0);
    expect(chartRatio('0.000001', '0.000002')).toBe(0.5);
    expect(chartRatio('99', '1')).toBe(1);
    expect(chartRatio('not-money', '1')).toBe(0);
  });
});
