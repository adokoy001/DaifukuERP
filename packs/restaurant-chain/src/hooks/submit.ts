import { registry, repo, ValidationError, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { RestaurantStore } from '../entities/store.ts';
import { RestaurantClosing } from '../entities/closing.ts';
import { decimal } from '../services/load.ts';
import { availableDay, validateClosing } from '../services/closing-validation.ts';
import { postIngredients, postSales, type PostingHead } from '../services/posting.ts';
import { withClosingLinks } from '../system-write.ts';
async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  await availableDay(ctx, row);
  await validateClosing(ctx, row);
  const store = await repo(ctx, RestaurantStore).get(String(row.storeId));
  const account = await repo(ctx, Account).get(store.cashAccountId);
  const partner = await repo(ctx, Partner).get(store.partnerId);
  if (account.type !== 'asset' || !partner.isCustomer)
    throw new ValidationError('店舗の現金勘定・店頭客を確認してください', [
      { path: 'storeId', message: 'cash asset account and customer required' },
    ]);
  if (row.reviewStatus !== 'approved')
    Object.assign(row, { reviewStatus: 'approved', reviewedAt: ctx.now(), reviewedBy: ctx.actor.id });
}
async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const store = await repo(ctx, RestaurantStore).get(String(row.storeId));
  const head: PostingHead = {
    id: String(row.id),
    number: String(row.number),
    date: row.date as LocalDate,
    warehouseId: store.warehouseId,
    partnerId: store.partnerId,
    cashAccountId: store.cashAccountId,
    cash: decimal(row.cashAmount),
  };
  const sales = row.dayStatus === 'sales' ? await postSales(ctx, head) : { salesInvoiceId: null, paymentId: null };
  const stock = await postIngredients(ctx, head);
  await withClosingLinks(ctx, (internal) => repo(internal, RestaurantClosing).update(head.id, { ...sales, ...stock }));
}
export function registerSubmitHooks(): void {
  registry.registerHook(RestaurantClosing.name, 'before_submit', beforeSubmit);
  registry.registerHook(RestaurantClosing.name, 'after_submit', afterSubmit);
}
