import { describe, expect, it } from 'vitest';
import type { ShiftBoard, ShiftPlanSummary } from '../api/shifts.ts';
import { draftFromBoard, draftWasReplaced, revisePublished } from './shift-draft.ts';
const published: ShiftPlanSummary = { id: 'published', siteId: 'site', weekStart: '2026-09-14', version: 2, status: 'published', sourceRevision: 'original', slots: [], assignments: [{ slotId: 'slot', employeeId: 'employee', locked: true }], seed: 13, acknowledgeShortage: false, reason: 'approved', publishedAt: '2026-09-12T09:00:00+09:00' };
const board: ShiftBoard = { site: { id: 'site', code: 'S', name: 'Main' }, weekStart: '2026-09-14', sourceRevision: 'latest', problem: { weekStart: '2026-09-14', employees: [], slots: [], availability: [], leave: [], existing: [], rules: [] }, employeeVersions: [], profiles: [], availability: [], draft: null, published, publishedEvaluation: null };
describe('shift draft concurrency and publication boundaries', () => {
  it('does not silently accept a saved draft after profiles or availability changed', () => {
    const current = { ...board, draft: { ...published, id: 'draft', status: 'draft' as const, sourceRevision: 'older-sources' } };
    const draft = draftFromBoard(current);
    expect(draft.sourceRevision).toBe('older-sources');
    expect(draft.sourceRevision).not.toBe(current.sourceRevision);
    expect(draft.expectedVersion).toBe(2);
  });
  it('makes a revision new while preserving the published allocation and locks', () => {
    const revision = revisePublished(published, board.sourceRevision);
    expect(revision).not.toHaveProperty('planId'); expect(revision.expectedVersion).toBe(0);
    expect(revision.assignments).toEqual(published.assignments); expect(revision.sourceRevision).toBe('latest');
    expect(published.status).toBe('published');
  });
  it('detects concurrent cancellation, replacement and update without mistaking viewing a publication for a draft conflict', () => {
    const draft = { ...revisePublished(published, 'latest'), planId: 'draft', expectedVersion: 2 };
    expect(draftWasReplaced(draft, board, true)).toBe(true);
    expect(draftWasReplaced(draft, { ...board, draft: { ...published, id: 'draft', status: 'draft', version: 3 } }, true)).toBe(true);
    expect(draftWasReplaced(draft, { ...board, draft: { ...published, id: 'other', status: 'draft' } }, true)).toBe(true);
    expect(draftWasReplaced(draft, { ...board, draft: { ...published, id: 'draft', status: 'draft' } }, true)).toBe(false);
    expect(draftWasReplaced(draftFromBoard(board), board, false)).toBe(false);
    const unsaved = revisePublished(published, 'latest');
    expect(draftWasReplaced(unsaved, board, true)).toBe(false);
    expect(draftWasReplaced(unsaved, { ...board, draft: { ...published, id: 'concurrent', status: 'draft' } }, true)).toBe(true);
  });
});
