import { repo, StateError, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { cancelShiftPlanInput, publishShiftPlanInput, saveShiftPlanInput } from '../shift-contract.ts';
import { WorkforceShiftAssignment, WorkforceShiftPlan } from '../entities/index.ts';
import { H, M } from '../entities/common.ts';
import { command, expectVersion, identity } from '../common.ts';
import { internalWrite } from '../internal.ts';
import { planSummary } from '../shift-source.ts';
import { assertDraft, checkedEvaluation, checkedSource, currentPlan, deactivateAssignments, shiftPlanLock } from '../shift-plan-state.ts';
import { workflowAction } from './define.ts';
async function save(ctx: Context, input: z.infer<typeof saveShiftPlanInput>) {
  return shiftPlanLock(ctx, input.siteId, input.weekStart, async () => {
    const source = await checkedSource(ctx, input.siteId, input.weekStart, input.sourceRevision);
    const current = input.planId ? await currentPlan(ctx, input.planId, input.expectedVersion) : null;
    if (current && (current.siteId !== input.siteId || current.weekStart !== input.weekStart)) throw new StateError('計画の拠点・週は変更できません', '対象の週に新しい下書きを作成してください。');
    if (current) assertDraft(current.status);
    else {
      expectVersion(0, input.expectedVersion);
      if (source.plans.some((row) => row.status === 'draft')) throw new StateError('この週には下書きがあります', '既存の下書きを読み直して編集してください。');
    }
    checkedEvaluation({ ...source.problem, slots: input.slots }, input.assignments);
    const body = { slots: input.slots, assignments: input.assignments, sourceRevision: source.sourceRevision, seed: input.seed };
    return command(await internalWrite(ctx, WorkforceShiftPlan, (write) => current
      ? repo(write, WorkforceShiftPlan).update(current.id, body, { expectedVersion: current.version })
      : repo(write, WorkforceShiftPlan).create({ ...body, siteId: input.siteId, weekStart: input.weekStart })));
  });
}
async function publish(ctx: Context, input: z.infer<typeof publishShiftPlanInput>) {
  const initial = await repo(ctx, WorkforceShiftPlan).get(input.planId);
  return shiftPlanLock(ctx, initial.siteId, initial.weekStart, async () => {
    const row = await currentPlan(ctx, initial.id, input.expectedVersion); assertDraft(row.status);
    const source = await checkedSource(ctx, row.siteId, row.weekStart, input.sourceRevision), draft = planSummary(row);
    if (row.sourceRevision !== source.sourceRevision) throw new StateError('下書きの基礎情報が更新されています', '最新の情報で再計算し、下書きを保存してから公開してください。');
    const evaluation = checkedEvaluation({ ...source.problem, slots: draft.slots }, draft.assignments);
    if (evaluation.shortage && !input.acknowledgeShortage) throw new StateError('必要人数を満たさない勤務枠があります', '不足人数を確認し、欠員のある公開を明示的に了承してください。');
    const prior = source.plans.find((plan) => plan.status === 'published');
    if (prior) {
      await deactivateAssignments(ctx, prior.id);
      await internalWrite(ctx, WorkforceShiftPlan, (write) => repo(write, WorkforceShiftPlan).update(prior.id, { status: 'superseded' }, { expectedVersion: prior.version }));
    }
    for (const assignment of draft.assignments) {
      const employee = source.employees.find((person) => person.id === assignment.employeeId), slot = draft.slots.find((item) => item.id === assignment.slotId);
      if (!employee || !slot) throw new StateError('割当の社員または勤務枠が見つかりません', '最新の計画を読み直してください。');
      await internalWrite(ctx, WorkforceShiftAssignment, (write) => repo(write, WorkforceShiftAssignment).create({ ...identity(employee), planId: row.id, slotId: slot.id, date: slot.date, label: slot.label, startMinute: slot.startMinute, endMinute: slot.endMinute, breakMinutes: slot.breakMinutes, skill: slot.skill }));
    }
    return command(await internalWrite(ctx, WorkforceShiftPlan, (write) => repo(write, WorkforceShiftPlan).update(row.id, { status: 'published', publishedAt: ctx.now(), acknowledgeShortage: input.acknowledgeShortage, reason: input.reason }, { expectedVersion: row.version })));
  });
}
async function cancel(ctx: Context, input: z.infer<typeof cancelShiftPlanInput>) {
  const initial = await repo(ctx, WorkforceShiftPlan).get(input.planId);
  return shiftPlanLock(ctx, initial.siteId, initial.weekStart, async () => {
    const row = await currentPlan(ctx, initial.id, input.expectedVersion);
    if (!['draft', 'published'].includes(row.status)) throw new StateError('この計画は既に終了しています', '最新の計画を読み直してください。');
    await deactivateAssignments(ctx, row.id);
    return command(await internalWrite(ctx, WorkforceShiftPlan, (write) => repo(write, WorkforceShiftPlan).update(row.id, { status: 'cancelled', reason: input.reason }, { expectedVersion: row.version })));
  });
}
export const saveShiftPlanAction = workflowAction('save_shift_plan', '週間シフトの下書きを保存', saveShiftPlanInput, [M, H], save);
export const publishShiftPlanAction = workflowAction('publish_shift_plan', '週間シフトを理由付きで公開・改訂', publishShiftPlanInput, [M, H], publish);
export const cancelShiftPlanAction = workflowAction('cancel_shift_plan', '週間シフトを理由付きで取り消し', cancelShiftPlanInput, [M, H], cancel);
