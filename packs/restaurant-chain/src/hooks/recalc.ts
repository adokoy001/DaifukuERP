import { Decimal, DOCSTATUS, registry, repo, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { totalsFrom } from '@daifuku/mod-sales';
import { taxSummaryFor } from '@daifuku/mod-tax';
import { RestaurantClosing } from '../entities/closing.ts';
import { closingLines } from '../services/load.ts';

export async function closingTotals(ctx: Context, id: string, date: LocalDate) {
  const lines = await closingLines(ctx, id);
  const summary = await taxSummaryFor(ctx, { date, priceIncludesTax: true, lines: lines.map((line) => ({ amount: line.amount, category: line.taxCategory ?? 'standard' })) });
  return { ...totalsFrom(summary), quantity: Decimal.sum(lines.map((line) => line.quantity)), lineCount: lines.length };
}
async function recalc(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  const totals = await closingTotals(ctx, String(row.id), row.date as LocalDate);
  Object.assign(row, { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, taxSummary: totals.taxSummary, quantity: totals.quantity });
}
export function registerRecalcHooks(): void {
  registry.registerHook(RestaurantClosing.name, 'before_validate', async (_ctx, { row, previous }) => {
    if (!previous) Object.assign(row, { subtotal: '0', taxTotal: '0', total: '0', quantity: '0', taxSummary: [], consumptionCost: '0', wasteCost: '0', salesInvoiceId: null, paymentId: null, consumptionEntryId: null, wasteEntryId: null, cancelledDate: null });
  });
  registry.registerHook(RestaurantClosing.name, 'before_update', recalc);
  registry.registerHook(RestaurantClosing.name, 'after_lines_saved', async (ctx, { row }) => {
    if (row.docstatus === DOCSTATUS.draft) await repo(ctx, RestaurantClosing).update(String(row.id), {});
  });
}
