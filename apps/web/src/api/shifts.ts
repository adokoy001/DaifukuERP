import type { MyShifts, ShiftBoard } from '@daifuku/mod-workforce/shift-contract';
import { useWorkforceRead } from './workforce-query.ts';
export type {
  MyShifts,
  ShiftBoard,
  ShiftPlanSummary,
  ShiftProfileSummary,
} from '@daifuku/mod-workforce/shift-contract';
export function useShiftBoard(siteId: string, weekStart: string, enabled = true) {
  return useWorkforceRead<ShiftBoard>('workforce.shift_board', { siteId, weekStart }, enabled && Boolean(siteId));
}
export function useMyShifts(weekStart: string, enabled = true) {
  return useWorkforceRead<MyShifts>('workforce.my_shifts', { weekStart }, enabled);
}

export function useShiftSites(enabled: boolean) {
  return useWorkforceRead<{ items: { id: string; name: string; code: string }[] }>(
    'workforce_site.list',
    { limit: 500, where: { active: true } },
    enabled,
  );
}
