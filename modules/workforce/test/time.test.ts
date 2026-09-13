import { describe, expect, it } from 'vitest';
import {
  addDays,
  assertBreaks,
  assertPayrollCalendarDay,
  jstDate,
  measureWork,
  periodBounds,
  weekStart,
} from '../src/services/time.ts';
const time = (value: string) => new Date(value);
const minute = 60000;
const policy = { breakAfterMinutes: 360, breakMinutes: 45, longBreakAfterMinutes: 480, longBreakMinutes: 60 };
describe('exact work intervals and domestic calendar boundaries', () => {
  it('deducts actual breaks from both work and the intersecting night window', () => {
    expect(
      measureWork(
        time('2026-09-12T09:00:00+09:00'),
        time('2026-09-12T18:00:00+09:00'),
        [{ start: '2026-09-12T12:00:00+09:00', end: '2026-09-12T13:00:00+09:00' }],
        1320,
        300,
      ),
    ).toEqual({ workedMs: 480 * minute, breakMs: 60 * minute, nightMs: 0 });
    expect(
      measureWork(
        time('2026-09-12T21:30:00+09:00'),
        time('2026-09-13T05:30:00+09:00'),
        [{ start: '2026-09-12T23:30:00+09:00', end: '2026-09-13T00:15:00+09:00' }],
        1320,
        300,
      ),
    ).toEqual({ workedMs: 435 * minute, breakMs: 45 * minute, nightMs: 375 * minute });
  });
  it('keeps milliseconds at 22:00 and 05:00 boundaries without minute truncation', () => {
    for (const [start, end] of [
      ['2026-09-12T21:59:59.500+09:00', '2026-09-12T22:00:00.500+09:00'],
      ['2026-09-13T04:59:59.500+09:00', '2026-09-13T05:00:00.500+09:00'],
    ]) {
      expect(measureWork(time(String(start)), time(String(end)), [], 1320, 300)).toEqual({
        workedMs: 1000,
        breakMs: 0,
        nightMs: 500,
      });
    }
  });
  it('rejects overlapping / external / reversed breaks, but accepts adjacent unsorted breaks', () => {
    const start = time('2026-09-12T09:00:00+09:00');
    const end = time('2026-09-12T18:00:00+09:00');
    const breaks = [
      { start: '2026-09-12T12:30:00+09:00', end: '2026-09-12T13:00:00+09:00' },
      { start: '2026-09-12T12:00:00+09:00', end: '2026-09-12T12:30:00+09:00' },
    ];
    expect(measureWork(start, end, breaks, 1320, 300).breakMs).toBe(60 * minute);
    for (const bad of [
      [...breaks, { start: '2026-09-12T12:20:00+09:00', end: '2026-09-12T12:40:00+09:00' }],
      [{ start: '2026-09-12T08:59:00+09:00', end: '2026-09-12T10:00:00+09:00' }],
      [{ start: '2026-09-12T13:00:00+09:00', end: '2026-09-12T12:00:00+09:00' }],
    ])
      expect(() => measureWork(start, end, bad, 1320, 300)).toThrow();
  });
  it('bounds one shift and rejects invalid or nonadvancing clock intervals', () => {
    const start = time('2026-09-12T09:00:00+09:00');
    expect(measureWork(start, time('2026-09-13T09:00:00+09:00'), [], 1320, 300).workedMs).toBe(24 * 60 * minute);
    for (const end of [
      start,
      time('2026-09-12T08:59:59+09:00'),
      time('2026-09-13T09:00:00.001+09:00'),
      time('invalid'),
    ])
      expect(() => measureWork(start, end, [], 1320, 300)).toThrow();
  });
  it('applies break thresholds to exact worked time, strictly above six / eight hours', () => {
    expect(() => assertBreaks({ workedMs: 360 * minute, breakMs: 0 }, policy)).not.toThrow();
    expect(() => assertBreaks({ workedMs: 360 * minute + 1, breakMs: 0 }, policy)).toThrow();
    expect(() => assertBreaks({ workedMs: 480 * minute, breakMs: 45 * minute }, policy)).not.toThrow();
    expect(() => assertBreaks({ workedMs: 480 * minute + 1, breakMs: 45 * minute }, policy)).toThrow();
    expect(() => assertBreaks({ workedMs: 480 * minute + 1, breakMs: 60 * minute }, policy)).not.toThrow();
  });
  it('refuses to auto-calculate payroll across a calendar-day holiday boundary while retaining measurable punches', () => {
    const start = time('2026-09-12T22:00:00+09:00');
    const end = time('2026-09-13T06:00:00+09:00');
    expect(measureWork(start, end, [], 1320, 300).workedMs).toBe(480 * minute);
    expect(() => assertPayrollCalendarDay(start, end)).toThrow();
    expect(() => assertPayrollCalendarDay(start, time('2026-09-13T00:00:00.001+09:00'))).toThrow();
    expect(() =>
      assertPayrollCalendarDay(time('2026-09-30T22:00:00+09:00'), time('2026-10-01T05:00:00+09:00')),
    ).toThrow();
  });
  it('allows same-calendar payroll and exact midnight clock-out without charging time on the next day', () => {
    const start = time('2026-09-12T22:00:00+09:00');
    expect(() => assertPayrollCalendarDay(start, time('2026-09-12T23:59:59.999+09:00'))).not.toThrow();
    expect(() => assertPayrollCalendarDay(start, time('2026-09-13T00:00:00.000+09:00'))).not.toThrow();
    expect(() =>
      assertPayrollCalendarDay(time('2026-09-13T00:00:00+09:00'), time('2026-09-13T05:00:00+09:00')),
    ).not.toThrow();
  });
  it('uses JST date and a configured week origin across month and year boundaries', () => {
    expect(jstDate(time('2026-09-11T14:59:59.999Z'))).toBe('2026-09-11');
    expect(jstDate(time('2026-09-11T15:00:00.000Z'))).toBe('2026-09-12');
    expect(weekStart('2026-09-01', 1)).toBe('2026-08-31');
    expect(weekStart('2026-09-06', 1)).toBe('2026-08-31');
    expect(weekStart('2026-09-06', 0)).toBe('2026-09-06');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(periodBounds('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(() => periodBounds('2026-13')).toThrow();
  });
});
