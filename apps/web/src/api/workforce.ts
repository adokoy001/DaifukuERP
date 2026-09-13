// Type-only public wire contract; no module/kernel runtime enters the browser bundle.
import type {
  AttendanceSummary,
  EmployeeSummary,
  ManagementPortal,
  MyPortal,
  PayrollSummary,
} from '@daifuku/mod-workforce/contract';
import { useWorkforceRead } from './workforce-query.ts';
export type { AttendanceSummary, EmployeeSummary, ManagementPortal, MyPortal, PayrollSummary };
export type LeaveSummary = MyPortal['leaveRequests'][number];
export type ExpenseSummary = MyPortal['expenses'][number];
export type CorrectionSummary = MyPortal['corrections'][number];
export function useMyPortal(period: string, enabled: boolean) {
  return useWorkforceRead<MyPortal>('workforce.my_portal', { period }, enabled);
}
export function useManagementPortal(period: string, enabled: boolean) {
  return useWorkforceRead<ManagementPortal>('workforce.management_portal', { period }, enabled);
}

export function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** datetime-local is explicitly a Tokyo wall time; never use the browser's current timezone to reinterpret it. */
export function tokyoTimestamp(value: string): string {
  return value.length === 16 ? value + ':00+09:00' : value + '+09:00';
}
