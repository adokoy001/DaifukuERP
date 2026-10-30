// sales.render_statement_html (docs/specs/print-templates.md AC-15, AC-22, D-8, D-12): a 合計請求書 of one customer's
// submitted sales invoices whose invoice date falls in the closing period ending at `closingDate` (the partner's
// closingDay; 31 = month end), opening invoices excluded (docs/specs/opening-balances.md AC-20). Everything is read
// through the caller's Context (row rules, company boundary); amounts are the invoices' stored values added up, never
// recalculated (AC-7).
import {
  defineAction,
  DOCSTATUS,
  label,
  registry,
  repo,
  StateError,
  todayLocal,
  ValidationError,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';
import { closingDateOf, daysInMonth, Partner } from '@daifuku/mod-partner';
import {
  definedProps,
  loadPrintTools,
  statusBanner,
  sumDecimals,
  withStatusBanner,
  type PrintIssuer,
} from '@daifuku/mod-print-layout';
import { TAX_CATEGORIES } from '@daifuku/mod-tax';
import { z } from 'zod';
import { SalesInvoice, type InvoiceTaxSummaryRow } from '../entities/sales-invoice.ts';
import { rateLabel } from '../services/render-html.ts';
import {
  defaultStatementHtml,
  type StatementHtmlRenderer,
  type StatementRenderData,
} from '../services/statement-html.ts';
import { loadIssuer, partnerAddressee } from './render-invoice-html.ts';

/** Override point for the statement layout (ADR-0008). */
export const STATEMENT_HTML_OVERRIDE = 'sales.statement_html';
/** AC-15: more invoices than this in one period is refused (open question 7). */
export const STATEMENT_MAX_INVOICES = 500;

/** AC-15: a period with more than `max` submitted invoices is INVALID_STATE; exactly `max` is still printed. */
export function assertStatementSize(total: number, max: number = STATEMENT_MAX_INVOICES): void {
  if (total > max)
    throw new StateError(
      `The period has ${total} submitted invoices; a statement lists at most ${max}`,
      'Print the invoices individually, or ask for paging of statements (docs/specs/print-templates.md open question 7).',
    );
}

/**
 * The VALIDATION issue under 締め日 when the day is not one of the partner's closing dates (AC-25). Bilingual like the
 * status banners: the request locale follows the browser's Accept-Language, not the language chosen in the web app,
 * so a single-language message could appear in the other language under the field.
 */
export function notClosingDateMessage(previous: LocalDate, next: LocalDate): string {
  return `締め日ではありません（直近の締め日: ${previous} または ${next}） / not a closing date; nearest: ${previous} or ${next}`;
}

function ymd(date: LocalDate): { y: number; m: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
}

function fmt(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The closing date of the month before `closing`'s month (the day clamped to that month's length). */
export function previousClosingDate(closing: LocalDate, closingDay: number): LocalDate {
  const { y, m } = ymd(closing);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return fmt(py, pm, Math.min(closingDay, daysInMonth(py, pm)));
}

/** The day after a LocalDate. */
export function nextDay(date: LocalDate): LocalDate {
  const { y, m } = ymd(date);
  const d = Number(date.slice(8, 10));
  if (d < daysInMonth(y, m)) return fmt(y, m, d + 1);
  return m === 12 ? fmt(y + 1, 1, 1) : fmt(y, m + 1, 1);
}

/** Is `date` one of the partner's closing dates? (closingDateOf maps a closing date to itself.) */
export function isClosingDate(date: LocalDate, closingDay: number): boolean {
  return closingDateOf(date, closingDay) === date;
}

/** D-8: the latest closing date on or before `today`. */
export function latestClosingDate(today: LocalDate, closingDay: number): LocalDate {
  const closing = closingDateOf(today, closingDay);
  return closing === today ? today : previousClosingDate(closing, closingDay);
}

/** The period (previous closing date, closingDate] as inclusive bounds. */
export function statementPeriod(closingDate: LocalDate, closingDay: number): { start: LocalDate; end: LocalDate } {
  return { start: nextDay(previousClosingDate(closingDate, closingDay)), end: closingDate };
}

const CATEGORY_ORDER: readonly string[] = TAX_CATEGORIES;

/** Σ of the stored per-invoice tax summaries by category and rate (addition only; AC-7). */
export function sumTaxSummaries(
  summaries: ReadonlyArray<
    ReadonlyArray<Pick<InvoiceTaxSummaryRow, 'category' | 'rate' | 'taxable' | 'tax' | 'gross'>>
  >,
): Array<{ category: string; rate: string; taxable: string; tax: string; gross: string }> {
  const groups = new Map<
    string,
    { category: string; rate: string; taxable: string[]; tax: string[]; gross: string[] }
  >();
  for (const rows of summaries)
    for (const g of rows) {
      const key = `${g.category}|${g.rate}`;
      const group = groups.get(key) ?? { category: g.category, rate: g.rate, taxable: [], tax: [], gross: [] };
      group.taxable.push(String(g.taxable));
      group.tax.push(String(g.tax));
      group.gross.push(String(g.gross));
      groups.set(key, group);
    }
  return [...groups.values()]
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        Number(b.rate) - Number(a.rate) ||
        a.rate.localeCompare(b.rate),
    )
    .map((g) => ({
      category: g.category,
      rate: g.rate,
      taxable: sumDecimals(g.taxable),
      tax: sumDecimals(g.tax),
      gross: sumDecimals(g.gross),
    }));
}

export async function buildStatementRenderData(
  ctx: Context,
  input: { partnerId: string; closingDate?: string | undefined },
): Promise<StatementRenderData> {
  const partner = await repo(ctx, Partner).get(input.partnerId);
  if (!partner.isCustomer)
    throw new StateError(
      'A statement is printed for a customer only',
      'Mark the partner as a customer (isCustomer), or print the supplier documents from the payments screen.',
    );
  const closingDay = partner.closingDay;
  const today = todayLocal(ctx.now());
  let closingDate: LocalDate;
  if (input.closingDate === undefined) closingDate = latestClosingDate(today, closingDay);
  else if (!isClosingDate(input.closingDate, closingDay)) {
    const next = closingDateOf(input.closingDate, closingDay);
    const previous = previousClosingDate(next, closingDay);
    throw new ValidationError(
      `${input.closingDate} is not a closing date of this partner (closing day ${closingDay})`,
      [{ path: 'closingDate', message: notClosingDateMessage(previous, next) }],
      `Use a closing date of the partner: ${previous} or ${next}, or leave it blank for the latest one.`,
    );
  } else closingDate = input.closingDate;
  const period = statementPeriod(closingDate, closingDay);
  const result = await repo(ctx, SalesInvoice).list({
    where: {
      partnerId: partner.id,
      docstatus: DOCSTATUS.submitted,
      // docs/specs/opening-balances.md AC-20 / D-5: an opening invoice is an internal record of a balance the previous
      // system already billed, dated the opening date; listing it would bill that amount again.
      openingBalance: false,
      date: { $gte: period.start, $lte: period.end },
    },
    orderBy: [
      { field: 'date', dir: 'asc' },
      { field: 'number', dir: 'asc' },
    ],
    limit: STATEMENT_MAX_INVOICES,
  });
  assertStatementSize(result.total);
  // closingDateOf is the defining rule (AC-15); the date range above is the same set, this guards the boundary.
  const invoices = result.items.filter((inv) => closingDateOf(inv.date, closingDay) === closingDate);
  const dueDates = new Set(invoices.map((inv) => inv.dueDate ?? ''));
  const commonDue = dueDates.size === 1 ? [...dueDates][0] : '';
  const issuer = definedProps<PrintIssuer>(await loadIssuer(ctx));
  return {
    issuer,
    recipient: partnerAddressee(partner),
    statement: {
      closingDate,
      periodStart: period.start,
      issueDate: today,
      dueDate: commonDue ? commonDue : null,
      openPeriod: closingDate > today,
    },
    invoices: invoices.map((inv) => ({
      number: inv.number ?? '',
      date: inv.date,
      dueDate: inv.dueDate ?? null,
      subtotal: inv.subtotal.toString(),
      taxTotal: inv.taxTotal.toString(),
      total: inv.total.toString(),
    })),
    taxSummary: sumTaxSummaries(invoices.map((inv) => inv.taxSummary ?? [])).map((g) => ({
      ...g,
      label: rateLabel(g.category, g.rate, ctx.locale),
    })),
    totals: {
      subtotal: sumDecimals(invoices.map((inv) => inv.subtotal.toString())),
      taxTotal: sumDecimals(invoices.map((inv) => inv.taxTotal.toString())),
      total: sumDecimals(invoices.map((inv) => inv.total.toString())),
    },
    locale: ctx.locale,
  };
}

export const renderStatementHtmlAction = defineAction({
  name: 'sales.render_statement_html',
  description: label(
    '得意先の締め日で区切った期間の確定済み売上請求書をまとめた合計請求書の HTML を描画します（各請求書の保存値の合計。期首残高の請求書は含めません。closingDate 省略時は直近の締め日）。レイアウトは差し替え点 sales.statement_html で置き換えられます。',
    "Render a statement (合計請求書) of a customer's submitted sales invoices in one closing period (sums of the stored invoice values; opening balance invoices are not listed; closingDate defaults to the latest closing date). The layout is replaceable at override point sales.statement_html.",
  ),
  input: z.object({ partnerId: z.uuid(), closingDate: z.iso.date().optional() }),
  output: z.object({ html: z.string() }),
  permission: { entity: SalesInvoice.name, op: 'read' },
  tx: 'none',
  mutates: false,
  print: {
    entity: Partner.name,
    label: label('合計請求書を表示', 'View statement'),
    idInput: 'partnerId',
    when: { isCustomer: true },
    fields: {
      closingDate: {
        label: label('締め日', 'Closing date'),
        description: label(
          '空欄なら今日以前の直近の締め日を使います。取引先の締め日（31 は月末）以外の日は指定できません',
          "Leave blank to use the latest closing date up to today. Only the partner's closing dates are accepted (31 means month end)",
        ),
      },
    },
  },
  handler: async (ctx, input) => {
    const data = await buildStatementRenderData(ctx, input);
    const tools = await loadPrintTools(ctx);
    const render = registry.override<StatementHtmlRenderer>(STATEMENT_HTML_OVERRIDE, defaultStatementHtml);
    return {
      html: withStatusBanner(render(data, tools), data.statement.openPeriod ? statusBanner('open_period') : ''),
    };
  },
});
