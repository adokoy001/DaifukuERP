// Pure browser/server scheduling contract. No framework, database or employee secrets.
export type ShiftPreference = 'preferred' | 'available' | 'unavailable';
export interface ShiftProfile {
  skills: string[]; employmentType: 'full_time' | 'part_time' | 'contract';
  targetMinutes: number; maxWeeklyMinutes: number; maxDailyMinutes: number;
  maxDays: number; maxConsecutiveDays: number; minRestMinutes: number;
}
export interface ShiftEmployee {
  id: string; code: string; name: string; active: boolean; hiredOn: string;
  terminatedOn: string | null; profile: ShiftProfile | null;
}
export interface ShiftAvailabilityDay {
  date: string; preference: ShiftPreference; startMinute: number; endMinute: number;
}
export interface ShiftAvailability extends ShiftAvailabilityDay { employeeId: string }
export interface ShiftSlot {
  id: string; date: string; label: string; startMinute: number; endMinute: number;
  breakMinutes: number; required: number; skill: string;
}
export interface ShiftAssignment { slotId: string; employeeId: string; locked: boolean }
export interface ShiftExisting {
  employeeId: string; date: string; startMinute: number; endMinute: number; breakMinutes: number;
}
export interface ShiftLeave { employeeId: string; date: string; portion: 'full' | 'morning' | 'afternoon'; status: 'pending' | 'approved' }
export interface ShiftDayRule {
  date: string; dailyLimitMinutes: number; weeklyLimitMinutes: number;
  breakAfterMinutes: number; breakMinutes: number; longBreakAfterMinutes: number; longBreakMinutes: number;
}
export interface ShiftProblem {
  weekStart: string; employees: ShiftEmployee[]; slots: ShiftSlot[];
  availability: ShiftAvailability[]; leave: ShiftLeave[]; existing: ShiftExisting[]; rules: ShiftDayRule[];
}
export type ShiftIssueCode = 'invalid_input' | 'unknown_employee' | 'unknown_slot' | 'duplicate' | 'over_capacity' | 'inactive' | 'missing_profile' | 'missing_availability' | 'unavailable' | 'leave' | 'skill' | 'overlap' | 'daily_limit' | 'weekly_limit' | 'days_limit' | 'consecutive_limit' | 'rest' | 'break';
export interface ShiftIssue { code: ShiftIssueCode; employeeId?: string; slotId?: string }
export interface ShiftCoverage { slotId: string; required: number; assigned: number; shortage: number; exclusions: Partial<Record<ShiftIssueCode, number>> }
export interface ShiftEmployeeMetric { employeeId: string; minutes: number; targetMinutes: number; days: number; preferred: number; assignments: number }
export interface ShiftEvaluation {
  issues: ShiftIssue[]; coverage: ShiftCoverage[]; employees: ShiftEmployeeMetric[];
  shortage: number; preferenceRate: number; fairness: number; score: number;
}
export interface ShiftRecommendation { assignments: ShiftAssignment[]; evaluation: ShiftEvaluation; iterations: number; seed: number }
export interface ShiftOptimizeOptions { seed: number; iterations?: number; assignments?: ShiftAssignment[] }
