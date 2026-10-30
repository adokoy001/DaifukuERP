// docs/specs/event-delivery.md AC-4, AC-10: the retry schedule shared by outbox rows and delivery rows.
import { describe, expect, it } from 'vitest';
import { MAX_DELIVERY_ATTEMPTS, retryDelaySeconds, safeDiagnostic } from '../src/event-delivery.ts';
import { StateError } from '../src/errors.ts';

describe('event delivery retry schedule', () => {
  it('AC-4 doubles from 60 s and caps at one hour; the 8th attempt is the last', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelaySeconds)).toEqual([60, 120, 240, 480, 960, 1920, 3600]);
    expect(retryDelaySeconds(20)).toBe(3600);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(8);
    const total = [1, 2, 3, 4, 5, 6, 7].reduce((sum, n) => sum + retryDelaySeconds(n), 0);
    expect(total / 3600).toBeCloseTo(2.05, 1);
  });

  it('AC-4 safe diagnostics keep a DaifukuError code and message but only INTERNAL and SQLSTATE otherwise', () => {
    expect(safeDiagnostic(new StateError('period is closed', 'Reopen it'))).toBe('INVALID_STATE: period is closed');
    expect(safeDiagnostic(new Error('select * from secret where token = abc'))).toBe('INTERNAL');
    expect(safeDiagnostic(Object.assign(new Error('duplicate key value abc'), { code: '23505' }))).toBe(
      'INTERNAL (SQLSTATE 23505)',
    );
  });
});
