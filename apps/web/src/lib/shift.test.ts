import { describe, expect, it } from 'vitest';
import { emptyAvailability, minuteTime, removeShiftSlot, shiftMonday, shiftWeek, timeMinute } from './shift.ts';
describe('shift UI boundaries', () => {
  it('uses Monday and seven exact dates across month/year boundaries', () => {
    expect(shiftMonday('2027-01-03')).toBe('2026-12-28');
    expect(shiftWeek('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
  it('never initializes unsubmitted preferences as available', () => {
    const days = emptyAvailability('2026-09-14');
    expect(days).toHaveLength(7);
    expect(days.every((day) => day.preference === 'unavailable')).toBe(true);
  });
  it('preserves midnight boundary minute notation', () => {
    expect(minuteTime(1440)).toBe('24:00');
    expect(timeMinute('23:59')).toBe(1439);
    expect(timeMinute('')).toBeNaN();
    expect(timeMinute('25:00')).toBeNaN();
    expect(minuteTime(Number.NaN)).toBe('');
  });
  it('removes orphaned assignments when deleting a slot and preserves unrelated locks', () => {
    const rows = [
      { slotId: 'a', employeeId: 'one', locked: true },
      { slotId: 'b', employeeId: 'two', locked: true },
    ];
    expect(removeShiftSlot([], rows, 'a').assignments).toEqual([rows[1]]);
  });
});
