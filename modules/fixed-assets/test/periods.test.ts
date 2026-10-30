// Default period of the preview and the inbox (docs/specs/fixed-assets.md AC-11, AC-31; D14).
import { describe, expect, it } from 'vitest';
import { defaultPeriod, lastEndedPeriod } from '../src/index.ts';

const p = (id: string, start: string, end: string) => ({
  id,
  code: id,
  startDate: start,
  endDate: end,
  isClosed: false,
});
const periods = [
  p('2026-03', '2026-03-01', '2026-03-31'),
  p('2026-04', '2026-04-01', '2026-04-30'),
  p('2026-05', '2026-05-01', '2026-05-31'),
];

describe('default period (AC-11)', () => {
  it('AC-11: the last period that ended before today', () => {
    expect(defaultPeriod(periods, '2026-05-10')?.id).toBe('2026-04');
    expect(defaultPeriod(periods, '2026-05-01')?.id).toBe('2026-04');
    expect(lastEndedPeriod(periods, '2026-05-10')?.id).toBe('2026-04');
  });
  it('AC-11: else the period containing today, else the earliest (future) period, else null', () => {
    expect(defaultPeriod(periods, '2026-03-15')?.id).toBe('2026-03');
    expect(defaultPeriod(periods, '2026-01-15')?.id).toBe('2026-03');
    expect(lastEndedPeriod(periods, '2026-03-15')).toBeNull();
    expect(defaultPeriod([], '2026-03-15')).toBeNull();
  });
});
