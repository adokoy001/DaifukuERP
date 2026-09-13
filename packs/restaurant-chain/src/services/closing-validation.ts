import { DOCSTATUS, repo, StateError, ValidationError, withLock, type Context, type LocalDate } from '@daifuku/kernel';
import { assertJpySettlement } from '@daifuku/mod-accounting';
import { Product } from '@daifuku/mod-product';
import { RestaurantStore } from '../entities/store.ts';
import { RestaurantClosing } from '../entities/closing.ts';
import { submittedRecipe } from '../hooks/recipe.ts';
import { closingTotals } from '../hooks/recalc.ts';
import { closingLines, decimal, wasteLines } from './load.ts';
import { tenderTotal } from './calculation.ts';
import { today } from './operation-dates.ts';
export const dayLock = (storeId: string, date: string): string => `restaurant_chain.day:${storeId}:${date}`;
export async function availableDay(ctx: Context, row: Record<string, unknown>): Promise<void> {
  await withLock(ctx, dayLock(String(row.storeId), String(row.date)), async () => {
    const count = await repo(ctx, RestaurantClosing).count({
      storeId: String(row.storeId),
      date: String(row.date),
      id: { $ne: String(row.id) },
      $or: [{ docstatus: 1 }, { docstatus: 0, reviewStatus: { $in: ['submitted', 'approved'] } }],
    });
    if (count)
      throw new StateError(
        '同じ店舗・営業日の提出または確定済み締めがあります',
        'Return or cancel the existing closing before submitting another.',
      );
  });
}
export async function validateClosing(ctx: Context, row: Record<string, unknown>): Promise<void> {
  if (String(row.date) > today(ctx))
    throw new ValidationError('未来の営業日は提出できません', [
      { path: 'date', message: 'must be today or earlier in Asia/Tokyo' },
    ]);
  const store = await repo(ctx, RestaurantStore).lock(String(row.storeId), 'read');
  if (!store.isActive) throw new StateError('この店舗は営業停止中です', 'Select an active store.');
  const lines = await closingLines(ctx, String(row.id));
  for (const id of [...new Set(lines.map((line) => line.recipeId))].sort()) {
    const recipe = await submittedRecipe(ctx, id);
    const product = await repo(ctx, Product).get(recipe.productId);
    if (product.kind !== 'service' || !product.isActive || !product.isSold)
      throw new ValidationError('メニューの販売品目を確認してください', [
        { path: 'recipeId', message: 'active service product available for sale required' },
      ]);
  }
  const totals = await closingTotals(ctx, String(row.id), row.date as LocalDate);
  const cash = decimal(row.cashAmount),
    card = decimal(row.cardAmount),
    qr = decimal(row.qrAmount);
  if ((row.dayStatus ?? 'sales') === 'sales') {
    if (!totals.lineCount || !totals.total.gt(0))
      throw new ValidationError('売上明細と正の合計を入力してください', [
        { path: 'lines', message: 'positive sales total required' },
      ]);
  } else {
    if (totals.lineCount || !cash.plus(card).plus(qr).isZero() || !String(row.note ?? '').trim())
      throw new ValidationError('売上ゼロ・休業は売上明細なし・決済額ゼロと理由が必要です', [
        { path: 'dayStatus', message: 'no sales lines, zero tenders and a reason required' },
      ]);
    if (row.dayStatus === 'closed' && (await wasteLines(ctx, String(row.id))).length)
      throw new ValidationError('休業記録に材料廃棄は入力できません', [
        { path: 'dayStatus', message: 'use no_sales for an open day with waste' },
      ]);
  }
  for (const [path, amount] of Object.entries({
    total: totals.total,
    cashAmount: cash,
    cardAmount: card,
    qrAmount: qr,
  }))
    await assertJpySettlement(ctx, amount, path);
  if (row.cashSalesCounted !== null && row.cashSalesCounted !== undefined)
    await assertJpySettlement(ctx, decimal(row.cashSalesCounted), 'cashSalesCounted');
  tenderTotal(cash, card, qr, totals.total);
  Object.assign(row, {
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    taxSummary: totals.taxSummary,
    quantity: totals.quantity,
  });
}
export function draftRequired(row: { docstatus: number }): void {
  if (row.docstatus !== DOCSTATUS.draft)
    throw new StateError('下書きの日次締めだけ操作できます', 'Open the current draft.');
}
