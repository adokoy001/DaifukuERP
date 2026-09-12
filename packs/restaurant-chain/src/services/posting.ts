import { Decimal, repo, saveLines, submitDocument, ValidationError, type Context, type LocalDate } from '@daifuku/kernel';
import { StockEntry, StockEntryLine } from '@daifuku/mod-inventory';
import { Payment, PaymentAllocation } from '@daifuku/mod-payment';
import { SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { RestaurantRecipe } from '../entities/recipe.ts';
import { addIngredient } from './calculation.ts';
import { closingLines, ingredients, wasteLines } from './load.ts';

export interface PostingHead { id: string; number: string; date: LocalDate; warehouseId: string; partnerId: string; cashAccountId: string; cash: Decimal }
export async function postSales(ctx: Context, head: PostingHead): Promise<{ salesInvoiceId: string; paymentId: string | null }> {
  const lines = await closingLines(ctx, head.id);
  const invoice = await repo(ctx, SalesInvoice).create({ partnerId: head.partnerId, date: head.date, priceIncludesTax: true, note: `飲食店日次締め ${head.number}` });
  const salesLines = [];
  for (const line of lines) {
    const recipe = await repo(ctx, RestaurantRecipe).get(line.recipeId);
    salesLines.push({ productId: recipe.productId, description: line.description ?? recipe.name, quantity: line.quantity, unitPrice: line.unitPrice, taxCategory: line.taxCategory });
  }
  await saveLines(ctx, SalesInvoice, invoice.id, { [SalesInvoiceLine.name]: salesLines });
  await submitDocument(ctx, SalesInvoice, invoice.id);
  if (head.cash.isZero()) return { salesInvoiceId: invoice.id, paymentId: null };
  const payment = await repo(ctx, Payment).create({ direction: 'receive', partnerId: head.partnerId, date: head.date, amount: head.cash, method: 'cash', accountId: head.cashAccountId, note: `飲食店日次締め ${head.number} 現金` });
  await saveLines(ctx, Payment, payment.id, { [PaymentAllocation.name]: [{ invoiceEntity: SalesInvoice.name, invoiceId: invoice.id, amount: head.cash }] });
  await submitDocument(ctx, Payment, payment.id);
  return { salesInvoiceId: invoice.id, paymentId: payment.id };
}
async function consumedIngredients(ctx: Context, closingId: string): Promise<Map<string, Decimal>> {
  const consumed = new Map<string, Decimal>();
  for (const line of await closingLines(ctx, closingId)) {
    for (const ingredient of await ingredients(ctx, line.recipeId)) addIngredient(consumed, ingredient.productId, ingredient.quantity.times(line.quantity));
  }
  return consumed;
}
async function postIssue(ctx: Context, head: PostingHead, items: Map<string, Decimal>, label: string): Promise<{ id: string | null; cost: Decimal }> {
  if (!items.size) return { id: null, cost: Decimal.zero() };
  if (items.size > 500) throw new ValidationError('材料種類数が上限を超えています', [{ path: 'lines', message: 'at most 500 ingredients' }]);
  const entry = await repo(ctx, StockEntry).create({ type: 'issue', warehouseId: head.warehouseId, date: head.date, note: `飲食店日次締め ${head.number} ${label}` });
  await saveLines(ctx, StockEntry, entry.id, { [StockEntryLine.name]: [...items].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity })) });
  await submitDocument(ctx, StockEntry, entry.id);
  const lines = await repo(ctx, StockEntryLine).list({ where: { entryId: entry.id }, limit: 500 });
  return { id: entry.id, cost: Decimal.sum(lines.items.map((line) => line.amount)) };
}
export async function postIngredients(ctx: Context, head: PostingHead) {
  const consumed = await postIssue(ctx, head, await consumedIngredients(ctx, head.id), '材料消費');
  const waste = new Map<string, Decimal>();
  for (const line of await wasteLines(ctx, head.id)) addIngredient(waste, line.productId, line.quantity);
  const discarded = await postIssue(ctx, head, waste, '材料廃棄');
  return { consumptionEntryId: consumed.id, wasteEntryId: discarded.id, consumptionCost: consumed.cost, wasteCost: discarded.cost };
}
