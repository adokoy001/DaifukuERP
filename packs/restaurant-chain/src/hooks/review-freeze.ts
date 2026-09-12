import { hasWriteCapability, registry, repo, StateError, type Context, type HookArgs } from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantClosingLine } from '../entities/closing-line.ts';
import { RestaurantWasteLine } from '../entities/waste-line.ts';
function frozen(row: { reviewStatus?: unknown }): boolean { return row.reviewStatus === 'submitted' || row.reviewStatus === 'approved'; }
async function header(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (hasWriteCapability(ctx, RestaurantClosing.name, 'update')) return;
  if (frozen(previous ?? row)) throw new StateError('提出・確認済みの締めは編集できません', 'Ask a manager to return the closing with a reason before editing.');
}
async function child(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const ids = [...new Set([row.closingId, previous?.closingId].filter((x): x is string => typeof x === 'string'))].sort();
  for (const id of ids) {
    const parent = await repo(ctx, RestaurantClosing).lock(id, 'read');
    if (parent.docstatus !== 0 || frozen(parent)) throw new StateError('提出・確認済みまたは確定済み締めの明細は編集できません', 'Return the draft for editing; confirmed documents must be cancelled and amended.');
  }
}
export function registerReviewFreeze(): void {
  registry.registerHook(RestaurantClosing.name, 'before_validate', header);
  registry.registerHook(RestaurantClosing.name, 'before_delete', header);
  for (const entity of [RestaurantClosingLine, RestaurantWasteLine]) {
    registry.registerHook(entity.name, 'before_validate', child);
    registry.registerHook(entity.name, 'before_delete', child);
  }
}
