import { registry, repo, todayLocal, type Context, type HookArgs } from '@daifuku/kernel';
import { FarmHarvest } from '../entities/harvest.ts';
import { FarmCrop } from '../entities/masters.ts';
import { decimal, goods, invalid, openSeason } from '../services/validation.ts';
import { createStock, cancelStock, cancellationDate } from '../services/stock.ts';

async function draft(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (previous && previous.docstatus !== 0) return;
  if (!previous && !row.date) row.date = todayLocal(ctx.now());
  const merged = { ...previous, ...row };
  if (!decimal(merged.quantity).gt(0)) invalid('quantity', 'Harvest quantity must be positive.');
  const season = await openSeason(ctx, merged.seasonId, merged.date, false);
  const crop = await repo(ctx, FarmCrop).get(season.cropId);
  Object.assign(row, await goods(ctx, crop.productId));
  row.valuationAmount = decimal(merged.quantity).times(decimal(merged.valuationUnitCost)).roundHalfUp(6);
}
async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const season = await openSeason(ctx, row.seasonId, row.date, true);
  const crop = await repo(ctx, FarmCrop).get(season.cropId);
  Object.assign(row, await goods(ctx, crop.productId));
  row.valuationAmount = decimal(row.quantity).times(decimal(row.valuationUnitCost)).roundHalfUp(6);
}
async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  await createStock(ctx, FarmHarvest, row, 'receipt', [
    { productId: String(row.productId), quantity: decimal(row.quantity), unitCost: decimal(row.valuationUnitCost) },
  ]);
}
export function registerHarvestHooks(): void {
  registry.registerHook(FarmHarvest.name, 'before_validate', draft);
  registry.registerHook(FarmHarvest.name, 'before_submit', beforeSubmit);
  registry.registerHook(FarmHarvest.name, 'after_submit', afterSubmit);
  registry.registerHook(FarmHarvest.name, 'before_cancel', cancellationDate);
  registry.registerHook(FarmHarvest.name, 'after_cancel', cancelStock);
}
