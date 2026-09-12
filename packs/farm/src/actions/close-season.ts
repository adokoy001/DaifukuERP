import { defineAction, DOCSTATUS, isLocalDate, label, repo, StateError, todayLocal, type Context } from '@daifuku/kernel';
import { z } from 'zod';
import { FarmHarvest } from '../entities/harvest.ts';
import { FarmSeason } from '../entities/season.ts';
import { FarmWork } from '../entities/work.ts';
import { invalid } from '../services/validation.ts';
import { asFarm } from '../system-write.ts';

export const closeSeasonInput = z.object({
  seasonId: z.string().uuid().meta({ title: '作期' }),
  closedDate: z.string().refine(isLocalDate).meta({ title: '作期終了日' }),
});
export async function closeSeason(ctx: Context, input: z.output<typeof closeSeasonInput>) {
  const season = await repo(ctx, FarmSeason).lock(input.seasonId);
  if (season.docstatus !== DOCSTATUS.submitted) throw new StateError('Only an active season can be closed', 'Submit the season first.');
  if (season.closedDate) {
    if (season.closedDate === input.closedDate) return { seasonId: season.id, closedDate: season.closedDate };
    throw new StateError('The season has already been closed', 'The recorded close date is immutable.');
  }
  if (input.closedDate < season.startDate || input.closedDate > season.endDate || input.closedDate > todayLocal(ctx.now())) invalid('closedDate', 'Choose a non-future date within the growing season.');
  for (const entity of [FarmWork, FarmHarvest]) {
    if (await repo(ctx, entity).count({ seasonId: season.id, docstatus: DOCSTATUS.draft })) throw new StateError('Draft work or harvests remain', 'Submit or delete every draft before closing the season.');
    if (await repo(ctx, entity).count({ seasonId: season.id, docstatus: DOCSTATUS.submitted, date: { $gt: input.closedDate } })) invalid('closedDate', 'The close date must be on or after the latest submitted work and harvest.');
  }
  await asFarm(ctx, async (internal) => { await repo(internal, FarmSeason).update(season.id, { closedDate: input.closedDate }); });
  return { seasonId: season.id, closedDate: input.closedDate };
}
export const closeSeasonAction = defineAction({
  name: 'farm.close_season', description: label('作期を終了し、新しい作業・収穫の登録を止めます。下書きを処理してから実行してください。', 'Close a growing season after all draft work and harvests have been resolved.'),
  input: closeSeasonInput, output: z.object({ seasonId: z.string().uuid(), closedDate: z.string() }),
  permission: { entity: FarmSeason.name, op: 'update' }, handler: closeSeason,
});
