// `sales.recalculate` (spec AC-2): the one place that derives an invoice's totals. Reads the lines through the
// repository port, asks the tax module for the per-rate summary (rates valid on the invoice date, the company's
// rounding: once per rate, 国税庁 Q&A 問57) and shapes the result for the header. Called by the header's
// before_update / before_submit hooks; line saves reach it by touching the header (once per saveLines through
// after_lines_saved in hooks/recalc.ts, once per direct line write through hooks/lines.ts).
import { repo, type Context, type Infer, type LocalDate } from '@daifuku/kernel';
import { taxSummaryFor } from '@daifuku/mod-tax';
import { SalesInvoiceLine } from './entities/sales-invoice-line.ts';
import { totalsFrom, type InvoiceTotals } from './services/recalculate.ts';

export type SalesInvoiceLineRow = Infer<typeof SalesInvoiceLine>;

export interface RecalculateInput {
  id: string;
  date: LocalDate;
  priceIncludesTax: boolean;
}

export interface RecalculateResult {
  totals: InvoiceTotals;
  lines: SalesInvoiceLineRow[];
}

export async function loadInvoiceLines(ctx: Context, invoiceId: string): Promise<SalesInvoiceLineRow[]> {
  return (
    await repo(ctx, SalesInvoiceLine).list({
      where: { invoiceId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 500,
    })
  ).items;
}

export async function recalculateInvoice(ctx: Context, input: RecalculateInput): Promise<RecalculateResult> {
  const lines = await loadInvoiceLines(ctx, input.id);
  const summary = await taxSummaryFor(ctx, {
    date: input.date,
    priceIncludesTax: input.priceIncludesTax,
    lines: lines.map((l) => ({ amount: l.amount, category: l.taxCategory })),
  });
  return { totals: totalsFrom(summary), lines };
}
