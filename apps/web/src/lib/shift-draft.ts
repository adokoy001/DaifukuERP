import type { ShiftAssignment, ShiftSlot } from '@daifuku/mod-workforce/scheduling';
import type { ShiftBoard, ShiftPlanSummary } from '../api/shifts.ts';
export interface ShiftDraft {
  slots: ShiftSlot[];
  assignments: ShiftAssignment[];
  seed: number;
  sourceRevision: string;
  planId?: string;
  expectedVersion: number;
}
/** Keep the saved draft's evidence revision: loading fresh sources never silently endorses an older draft. */
export function draftFromBoard(board: ShiftBoard): ShiftDraft {
  const plan = board.draft ?? board.published;
  return {
    slots: plan?.slots ?? [],
    assignments: plan?.assignments ?? [],
    seed: plan?.seed ?? 1,
    sourceRevision: board.draft?.sourceRevision ?? board.sourceRevision,
    ...(plan ? { planId: plan.id } : {}),
    expectedVersion: plan?.version ?? 0,
  };
}
/** A published revision is a new draft, never an update to the published row. */
export function revisePublished(plan: ShiftPlanSummary, sourceRevision: string): ShiftDraft {
  return { slots: plan.slots, assignments: plan.assignments, seed: plan.seed, sourceRevision, expectedVersion: 0 };
}
export function draftWasReplaced(draft: ShiftDraft, board: ShiftBoard, editing: boolean): boolean {
  return (
    editing &&
    (draft.planId
      ? board.draft?.id !== draft.planId || board.draft?.version !== draft.expectedVersion
      : Boolean(board.draft))
  );
}
