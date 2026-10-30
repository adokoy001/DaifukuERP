// docs/specs/event-delivery.md AC-1, AC-11: the periodic worker logs a tick that did work; a tick that only found rows
// this process cannot send (no encryption key or SMTP here) is logged at most once an hour, not every interval.
import { describe, expect, it } from 'vitest';
import { emptyTick, shouldLogTick, tickDidWork, type TickResult } from '../src/events/worker.ts';

const HOUR = 3_600_000;
const tick = (patch: (result: TickResult) => void): TickResult => {
  const result = emptyTick();
  patch(result);
  return result;
};

describe('event worker tick log', () => {
  it('AC-1 a tick with any delivered, failed, routed, checked or purged count is work', () => {
    expect(tickDidWork(emptyTick())).toBe(false);
    expect(tickDidWork(tick((r) => (r.tenants = 3)))).toBe(false);
    expect(tickDidWork(tick((r) => (r.sends.skipped = 2)))).toBe(false);
    for (const patch of [
      (r: TickResult) => (r.events.delivered = 1),
      (r: TickResult) => (r.events.routed = 1),
      (r: TickResult) => (r.sends.sent = 1),
      (r: TickResult) => (r.sends.cancelled = 1),
      (r: TickResult) => (r.inbox.checked = 1),
      (r: TickResult) => (r.purged = 1),
      (r: TickResult) => (r.failedTenants = 1),
    ])
      expect(tickDidWork(tick(patch))).toBe(true);
  });

  it('AC-11 rows skipped for lack of configuration are logged once an hour; an idle tick never', () => {
    const skipped = tick((r) => {
      r.tenants = 1;
      r.sends.skipped = 4;
    });
    expect(shouldLogTick(emptyTick(), null, 0)).toBe(false);
    expect(
      shouldLogTick(
        tick((r) => (r.tenants = 1)),
        null,
        0,
      ),
    ).toBe(false);
    expect(shouldLogTick(skipped, null, 0)).toBe(true);
    expect(shouldLogTick(skipped, 0, HOUR - 1)).toBe(false);
    expect(shouldLogTick(skipped, 0, HOUR)).toBe(true);
    expect(
      shouldLogTick(
        tick((r) => (r.sends.sent = 1)),
        0,
        1,
      ),
    ).toBe(true);
  });
});
