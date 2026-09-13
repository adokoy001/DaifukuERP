import { registry, repo, StateError, todayLocal, type Context, type HookArgs } from '@daifuku/kernel';
import { FarmMaterialLine, FarmWork } from '../entities/work.ts';
import { decimal, goods, invalid, openSeason } from '../services/validation.ts';
import { createStock, cancelStock, cancellationDate } from '../services/stock.ts';

async function workDraft(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (!previous && !row.date) row.date = todayLocal(ctx.now());
  const merged = { ...previous, ...row };
  if (!previous || previous.docstatus === 0) await openSeason(ctx, merged.seasonId, merged.date, false);
}
async function material(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const merged = { ...previous, ...row };
  if (!decimal(merged.quantity).gt(0)) invalid('quantity', 'Material quantity must be positive.');
  const product = await goods(ctx, merged.productId);
  row.uomCode = product.uomCode;
}
async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  await openSeason(ctx, row.seasonId, row.date, true);
  const lines = await repo(ctx, FarmMaterialLine).list({ where: { workId: String(row.id) }, limit: 500 });
  if (lines.total > 500) invalid('lines', 'At most 500 material lines are supported.');
  if (!decimal(row.laborHours).gt(0) && lines.total === 0)
    invalid('laborHours', 'Enter labor hours or material input.');
  if (lines.total > 0 && !row.warehouseId) invalid('warehouseId', 'Material input needs a source warehouse.');
  for (const line of lines.items) await goods(ctx, line.productId);
}
async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const lines = (
    await repo(ctx, FarmMaterialLine).list({
      where: { workId: String(row.id) },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 500,
    })
  ).items;
  if (lines.length > 0)
    await createStock(
      ctx,
      FarmWork,
      row,
      'issue',
      lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    );
}
async function beforeCancel(ctx: Context, args: HookArgs): Promise<void> {
  await cancellationDate(ctx, args);
  if (!args.row.stockEntryId && (await repo(ctx, FarmMaterialLine).count({ workId: String(args.row.id) })))
    throw new StateError(
      'Submitted material input has no stock issue',
      'Restore the missing linkage before cancelling.',
    );
}
export function registerWorkHooks(): void {
  registry.registerHook(FarmWork.name, 'before_validate', workDraft);
  registry.registerHook(FarmMaterialLine.name, 'before_validate', material);
  registry.registerHook(FarmWork.name, 'before_submit', beforeSubmit);
  registry.registerHook(FarmWork.name, 'after_submit', afterSubmit);
  registry.registerHook(FarmWork.name, 'before_cancel', beforeCancel);
  registry.registerHook(FarmWork.name, 'after_cancel', cancelStock);
}
