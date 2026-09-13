import fc from 'fast-check';
import type { ShiftProblem } from '../src/scheduling/types.ts';
const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
const person = fc.record({
  active: fc.boolean(),
  skilled: fc.boolean(),
  target: fc.integer({ min: 0, max: 240 }),
  daily: fc.constantFrom(120, 180, 240, 480),
  weekly: fc.constantFrom(240, 360, 480),
  rest: fc.constantFrom(0, 660, 1440),
  maxDays: fc.integer({ min: 1, max: 3 }),
  consecutive: fc.integer({ min: 1, max: 3 }),
  choices: fc.array(fc.constantFrom('preferred', 'available', 'unavailable', 'missing'), {
    minLength: 7,
    maxLength: 7,
  }),
});
const demand = fc.record({
  day: fc.integer({ min: 0, max: 3 }),
  start: fc.constantFrom(540, 660, 780),
  duration: fc.constantFrom(120, 180, 240, 361),
  breakMinutes: fc.constantFrom(0, 45),
  required: fc.integer({ min: 1, max: 2 }),
  skilled: fc.boolean(),
});
export const smallProblem = fc
  .record({
    people: fc.array(person, { minLength: 2, maxLength: 3 }),
    demands: fc.array(demand, { minLength: 2, maxLength: 4 }),
    companyDaily: fc.constantFrom(180, 480),
    companyWeekly: fc.constantFrom(360, 2400),
    leave: fc.boolean(),
    neighbor: fc.boolean(),
  })
  .map(({ people, demands, companyDaily, companyWeekly, leave, neighbor }): ShiftProblem => ({
    weekStart: '2026-09-14',
    employees: people.map((row, index) => ({
      id: `p${index}`,
      code: `p${index}`,
      name: `Person ${index}`,
      active: index === people.length - 1 || row.active,
      hiredOn: '2026-01-01',
      terminatedOn: null,
      profile: {
        employmentType: 'part_time',
        skills: row.skilled ? ['service'] : [],
        targetMinutes: row.target,
        maxDailyMinutes: row.daily,
        maxWeeklyMinutes: row.weekly,
        minRestMinutes: row.rest,
        maxDays: row.maxDays,
        maxConsecutiveDays: row.consecutive,
      },
    })),
    // Every generated problem has a known nonempty feasible placement and an overcapacity counterexample.
    slots: demands.map((row, index) =>
      index === 0
        ? {
            id: 's0',
            date: '2026-09-14',
            label: 'Anchor',
            startMinute: 540,
            endMinute: 660,
            breakMinutes: 0,
            required: 1,
            skill: '',
          }
        : {
            id: `s${index}`,
            date: dates[row.day] ?? '2026-09-14',
            label: `Slot ${index}`,
            startMinute: row.start,
            endMinute: row.start + row.duration,
            breakMinutes: row.breakMinutes,
            required: row.required,
            skill: row.skilled ? 'service' : '',
          },
    ),
    availability: people.flatMap((row, index) =>
      row.choices.flatMap((original, day) => {
        const choice = index === people.length - 1 && day === 0 ? 'available' : original;
        return choice === 'missing'
          ? []
          : [
              {
                employeeId: `p${index}`,
                date: dates[day] ?? '2026-09-14',
                preference: choice as 'preferred' | 'available' | 'unavailable',
                startMinute: 0,
                endMinute: 1440,
              },
            ];
      }),
    ),
    rules: dates.map((date) => ({
      date,
      dailyLimitMinutes: companyDaily,
      weeklyLimitMinutes: companyWeekly,
      breakAfterMinutes: 360,
      breakMinutes: 45,
      longBreakAfterMinutes: 480,
      longBreakMinutes: 60,
    })),
    leave: leave ? [{ employeeId: 'p0', date: '2026-09-15', portion: 'morning', status: 'pending' }] : [],
    existing: neighbor
      ? [{ employeeId: 'p0', date: '2026-09-13', startMinute: 780, endMinute: 1200, breakMinutes: 60 }]
      : [],
  }));
export function denseProblem(): ShiftProblem {
  return {
    weekStart: '2026-09-14',
    employees: Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`,
      code: `p${i}`,
      name: `Person ${i}`,
      active: true,
      hiredOn: '2026-01-01',
      terminatedOn: null,
      profile: {
        employmentType: 'part_time',
        skills: i === 0 ? ['service'] : [],
        targetMinutes: 240,
        maxDailyMinutes: 480,
        maxWeeklyMinutes: 480,
        minRestMinutes: 660,
        maxDays: 2,
        maxConsecutiveDays: 2,
      },
    })),
    slots: Array.from({ length: 4 }, (_, i) => ({
      id: `s${i}`,
      date: dates[i] ?? '2026-09-14',
      label: `Slot ${i}`,
      startMinute: 540,
      endMinute: 780,
      breakMinutes: 0,
      required: 1,
      skill: i === 0 ? 'service' : '',
    })),
    availability: Array.from({ length: 3 }, (_, i) =>
      dates.map((date) => ({
        employeeId: `p${i}`,
        date,
        preference: 'available' as const,
        startMinute: 0,
        endMinute: 1440,
      })),
    ).flat(),
    leave: [],
    existing: [],
    rules: dates.map((date) => ({
      date,
      dailyLimitMinutes: 480,
      weeklyLimitMinutes: 2400,
      breakAfterMinutes: 360,
      breakMinutes: 45,
      longBreakAfterMinutes: 480,
      longBreakMinutes: 60,
    })),
  };
}
