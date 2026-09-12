import { Conflict, repo, StateError, ValidationError, withLock, type Context } from '@daifuku/kernel';
import { allRows, employeeLock } from './common.ts';
import { WorkforceEmployee, WorkforceShiftAssignment, WorkforceShiftPlan } from './entities/index.ts';
import { internalWrite } from './internal.ts';
import { shiftSource } from './shift-source.ts';
import { evaluateShift } from './scheduling/index.ts';
import type { ShiftAssignment, ShiftProblem } from './scheduling/types.ts';
export async function shiftPlanLock<T>(ctx: Context, siteId: string, weekStart: string, work: () => Promise<T>): Promise<T> {
  return withLock(ctx, 'workforce:policies', () => withLock(ctx, `workforce:shift:${siteId}:${weekStart}`, async () => {
    const people = await allRows(ctx, WorkforceEmployee, { siteId }, [{ field: 'id' }]);
    async function next(index: number): Promise<T> {
      const employee = people[index];
      return employee ? employeeLock(ctx, employee.id, () => next(index + 1)) : work();
    }
    return next(0);
  }));
}
export async function checkedSource(ctx: Context, siteId: string, weekStart: string, revision: string) {
  const source = await shiftSource(ctx, siteId, weekStart);
  if (source.sourceRevision !== revision) throw new Conflict('シフトの基礎情報が更新されています', '最新の社員情報・勤務希望・休暇・周辺の公開シフトを読み直して再計算し、保存してください。');
  return source;
}
export function assertDraft(status: string): void {
  if (status !== 'draft') throw new StateError('公開済みの計画は直接変更できません', '新しい下書きを作成して改訂してください。');
}
export function checkedEvaluation(problem: ShiftProblem, assignments: ShiftAssignment[]) {
  const evaluation = evaluateShift(problem, assignments);
  if (evaluation.issues.length) throw new ValidationError('シフトに勤務条件違反があります', evaluation.issues.map((issue) => ({ path: 'assignments', message: `${issue.code}${issue.employeeId ? ` (${issue.employeeId})` : ''}${issue.slotId ? ` [${issue.slotId}]` : ''}` })));
  return evaluation;
}
export async function deactivateAssignments(ctx: Context, planId: string): Promise<void> {
  const rows = await allRows(ctx, WorkforceShiftAssignment, { planId, active: true });
  for (const row of rows) await internalWrite(ctx, WorkforceShiftAssignment, (write) => repo(write, WorkforceShiftAssignment).update(row.id, { active: false }, { expectedVersion: row.version }));
}
export async function currentPlan(ctx: Context, id: string, expectedVersion: number) {
  const row = await repo(ctx, WorkforceShiftPlan).get(id);
  if (row.version !== expectedVersion) throw new Conflict('シフト計画が更新されています', '最新の計画を読み直してください。');
  return row;
}
