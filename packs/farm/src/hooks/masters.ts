import { registry, repo, type Context, type HookArgs } from '@daifuku/kernel';
import { FarmCrop, FarmField } from '../entities/masters.ts';
import { FarmSeason } from '../entities/season.ts';
import { goods, invalid } from '../services/validation.ts';

async function crop(ctx: Context, { row, previous }: HookArgs): Promise<void> { await goods(ctx, row.productId ?? previous?.productId); }
async function season(_ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const merged = { ...previous, ...row };
  if (String(merged.startDate) > String(merged.endDate)) invalid('endDate', 'The planned end date must be on or after the start date.');
}
async function submitSeason(ctx: Context, { row }: HookArgs): Promise<void> {
  const field = await repo(ctx, FarmField).get(String(row.fieldId));
  if (!field.isActive) invalid('fieldId', 'Choose an active field.');
  const crop = await repo(ctx, FarmCrop).get(String(row.cropId));
  await goods(ctx, crop.productId);
  // Draft work may already reference this plan; changing its crop/period would reinterpret it.
  // Each work/harvest is revalidated at its own submit before anything posts.
}
export function registerMasterHooks(): void {
  registry.registerHook(FarmCrop.name, 'before_validate', crop);
  registry.registerHook(FarmSeason.name, 'before_validate', season);
  registry.registerHook(FarmSeason.name, 'before_submit', submitSeason);
}
