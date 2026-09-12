// retail_closing header hooks (docs/specs/pack-retail.md AC-2/AC-3).
// before_validate: on create the computed fields and the invoice/payment refs are system-owned (reset whatever was sent —
//   this also cleans a copy made by amend), `date` defaults to today (JST) and `warehouseId` to inventory's default
//   warehouse. On update the refs are stripped from the patch unless this pack writes them (hooks/submit.ts).
// before_update (drafts only): subtotal/taxTotal/total/taxSummary re-derived from the stored lines through modules/tax
//   (tax-inclusive, rates of the closing date, the company's rounding once per rate).
// after_lines_saved: one header touch per replace-all line save, then cash + card must equal the total (AC-3). The check is
//   not made on a header-only save: the generic update saves the header BEFORE its lines, so an intermediate state may
//   legitimately differ (same reason as modules/payment). Submit checks again (hooks/submit.ts).
import { DOCSTATUS, registry, repo, todayLocal, ValidationError, type Context, type HookArgs, type LocalDate } from '@daifuku/kernel';
import { resolveDefaultWarehouse } from '@daifuku/mod-inventory';
import { totalsFrom, type InvoiceTotals } from '@daifuku/mod-sales';
import { taxSummaryFor, type TaxCategory } from '@daifuku/mod-tax';
import { RetailClosingLine } from '../entities/retail-closing-line.ts';
import { RetailClosing } from '../entities/retail-closing.ts';
import { decimalOf, tenderCheck, tenderHint } from '../services/closing-totals.ts';
import { isPackWrite } from '../system-write.ts';

export const LINK_FIELDS = ['salesInvoiceId', 'paymentId'] as const;

export async function loadClosingLines(ctx: Context, closingId: string) {
  return (await repo(ctx, RetailClosingLine).list({ where: { closingId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 500 })).items;
}

/** Totals of the stored lines (AC-3): modules/tax with priceIncludesTax fixed to true. */
export async function computeClosing(ctx: Context, closingId: string, date: LocalDate): Promise<{ totals: InvoiceTotals; lineCount: number }> {
  const lines = await loadClosingLines(ctx, closingId);
  const summary = await taxSummaryFor(ctx, { date, priceIncludesTax: true, lines: lines.map((l) => ({ amount: l.amount, category: l.taxCategory as TaxCategory })) });
  return { totals: totalsFrom(summary), lineCount: lines.length };
}

/** ValidationError (AC-3) when cash + card differs from the total; the hint carries the difference. */
export function assertTender(row: { number?: unknown; cashAmount: unknown; cardAmount: unknown; total: unknown }, id: string): void {
  const total = decimalOf(row.total);
  const check = tenderCheck({ cashAmount: decimalOf(row.cashAmount), cardAmount: decimalOf(row.cardAmount), total });
  if (check.difference.isZero()) return;
  throw new ValidationError(
    `retail_closing ${String(row.number ?? id)}: cash + card ${check.tendered.toString()} does not equal the total ${total.toString()} (difference ${check.difference.toString()})`,
    [{ path: 'cardAmount', message: `cash + card must equal total ${total.toString()} (difference ${check.difference.toString()})` }],
    tenderHint(check, total),
  );
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (previous) {
    if (!isPackWrite(ctx)) for (const k of LINK_FIELDS) delete row[k];
    return;
  }
  Object.assign(row, { subtotal: '0', taxTotal: '0', total: '0', taxSummary: [], salesInvoiceId: null, paymentId: null });
  if (row.date === undefined || row.date === null) row.date = todayLocal(ctx.now());
  if (row.warehouseId === undefined || row.warehouseId === null) row.warehouseId = (await resolveDefaultWarehouse(ctx)).id;
}

async function beforeUpdate(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  const { totals } = await computeClosing(ctx, row.id as string, row.date as LocalDate);
  Object.assign(row, { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, taxSummary: totals.taxSummary });
}

async function afterLinesSaved(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  const id = row.id as string;
  const updated = await repo(ctx, RetailClosing).update(id, {});
  assertTender(updated, id);
}

export function registerRecalcHooks(): void {
  registry.registerHook(RetailClosing.name, 'before_validate', beforeValidate);
  registry.registerHook(RetailClosing.name, 'before_update', beforeUpdate);
  registry.registerHook(RetailClosing.name, 'after_lines_saved', afterLinesSaved);
}
