import type { DecimalInput } from '@daifuku/kernel';
import type { WorkSystemInput } from '../work-system-contract.ts';

// Shared calculation inputs are a leaf dependency for wage and time classification.
export interface PayPolicy {
  id: string;
  weekStartsOn: number;
  dailyLimitMinutes: number;
  weeklyLimitMinutes: number;
  monthlyOvertimeThresholdMinutes: number;
  overtimePremiumRate: DecimalInput;
  highOvertimePremiumRate: DecimalInput;
  holidayPremiumRate: DecimalInput;
  nightPremiumRate: DecimalInput;
}
export interface PayTerms {
  id: string;
  validFrom: string;
  validTo: string;
  payType: 'hourly' | 'monthly';
  hourlyRate: DecimalInput;
  monthlySalary: DecimalInput;
  monthlyBaseMinutes: number;
  paidLeaveDayMinutes: number;
}
export interface PayDay {
  date: string;
  workedMs: number;
  nightMs: number;
  dayKind: 'workday' | 'statutory_holiday';
  policy: PayPolicy;
}
export interface PayLeave {
  date: string;
  days: DecimalInput;
}
export interface PayInput {
  period: string;
  employmentStart: string;
  employmentEnd: string;
  terms: readonly PayTerms[];
  days: readonly PayDay[];
  leaves: readonly PayLeave[];
  workSystems?: readonly WorkSystemInput[];
  boundaryLeaves?: readonly PayLeave[];
}
