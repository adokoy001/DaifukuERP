import { Conflict, defineAction, label, repo, StateError, submitDocument, type Context } from '@daifuku/kernel';
import { z } from 'zod';
import { RestaurantClosing } from '../entities/closing.ts';
import { availableDay, draftRequired, validateClosing } from '../services/closing-validation.ts';
import { withClosingReview } from '../system-write.ts';
const reference = z.object({ closingId: z.uuid().meta({ title: '日次締め' }), expectedVersion: z.number().int().positive().optional() });
async function locked(ctx: Context, input: z.output<typeof reference>) {
  const row = await repo(ctx, RestaurantClosing).lock(input.closingId);
  if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) throw new Conflict('日次締めが更新されています', 'Refresh the closing and retry.');
  draftRequired(row);
  return row;
}
export const submitForReviewAction = defineAction({
  name: 'restaurant_chain.submit_for_review', description: label('店舗の締めを提出', 'Submit closing for review'),
  input: reference, output: z.unknown(), permission: { entity: RestaurantClosing.name, op: 'update' }, storeAccess: true,
  handler: async (ctx, input) => {
    const row = await locked(ctx, input);
    if (!['draft', 'returned'].includes(row.reviewStatus)) throw new StateError('この締めは提出済みです', 'Use the review action for submitted closings.');
    await availableDay(ctx, { ...row }); await validateClosing(ctx, { ...row });
    return withClosingReview(ctx, (internal) => repo(internal, RestaurantClosing).update(row.id, { reviewStatus: 'submitted', submittedAt: ctx.now(), submittedBy: ctx.actor.id, reviewedAt: null, reviewedBy: null, reviewNote: null }, { expectedVersion: row.version }));
  },
});
export const reviewClosingAction = defineAction({
  name: 'restaurant_chain.review', description: label('締めの店長確認・差戻し', 'Review or return closing'),
  input: reference.extend({ decision: z.enum(['approve', 'return']).meta({ title: '判定' }), note: z.string().max(1000).optional().meta({ title: '理由（差戻しは必須）' }) }),
  output: z.unknown(), permission: { roles: ['chain_manager', 'sales'] }, storeAccess: true,
  handler: async (ctx, input) => {
    const row = await locked(ctx, input);
    if (!(input.decision === 'return' ? ['submitted', 'approved'] : ['submitted']).includes(row.reviewStatus)) throw new StateError('確認できる提出状態ではありません', 'Review a submitted closing, or return an approved draft.');
    if (input.decision === 'return' && !input.note?.trim()) throw new StateError('差戻し理由を入力してください', 'Explain what needs to be corrected.');
    return withClosingReview(ctx, (internal) => repo(internal, RestaurantClosing).update(row.id, { reviewStatus: input.decision === 'approve' ? 'approved' : 'returned', reviewedAt: ctx.now(), reviewedBy: ctx.actor.id, reviewNote: input.note?.trim() ?? null }, { expectedVersion: row.version }));
  },
});
export const finalizeClosingAction = defineAction({
  name: 'restaurant_chain.finalize', description: label('本部で締めを確定・転記', 'Finalize and post approved closing'),
  input: reference, output: z.unknown(), permission: { entity: RestaurantClosing.name, op: 'submit' },
  handler: async (ctx, input) => {
    const row = await locked(ctx, input);
    if (row.reviewStatus !== 'approved') throw new StateError('店長確認後に本部で確定してください', 'Approve the submitted closing first.');
    return submitDocument(ctx, RestaurantClosing, row.id, { expectedVersion: row.version });
  },
});
