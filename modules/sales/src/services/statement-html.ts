// Default 合計請求書 (statement invoice) layout (docs/specs/print-templates.md AC-15, D-12). Pure: StatementRenderData
// + PrintTools -> a complete HTML document. Every listed sales invoice is itself the qualified invoice and was rounded
// per rate when it was issued (Q&A 問57; docs/domain/japan-tax.md#rounding); this page only adds the stored values up
// for display, so no rounding rule applies here and no ※ marks are printed. Replaceable at `sales.statement_html`.
import type { Label } from '@daifuku/kernel';
import {
  addresseeBlock,
  amountBlock,
  dataTable,
  documentHeader,
  formatMoney,
  issuerBlock,
  noteLine,
  partiesSection,
  printDocument,
  remarksSection,
  taxBreakdownTable,
  type PrintIssuer,
  type PrintTools,
} from '@daifuku/mod-print-layout';

export interface StatementRenderData {
  issuer: PrintIssuer;
  recipient: { name: string; postalCode?: string; address?: string };
  statement: {
    /** The closing date that ends the period. */
    closingDate: string;
    /** First day of the period (the day after the previous closing date). */
    periodStart: string;
    /** Today in Japan time. */
    issueDate: string;
    /** The common due date of every listed invoice, else null. */
    dueDate: string | null;
    /** The closing date is after today (AC-15: 「締め前（期間途中）」 banner). */
    openPeriod: boolean;
  };
  /** Submitted sales invoices of the period, by date then number; money as stored Decimal strings. */
  invoices: Array<{
    number: string;
    date: string;
    dueDate: string | null;
    subtotal: string;
    taxTotal: string;
    total: string;
  }>;
  /** Σ of each invoice's stored taxSummary by category and rate; `label` names the category and rate. */
  taxSummary: Array<{ category: string; rate: string; label: string; taxable: string; tax: string; gross: string }>;
  totals: { subtotal: string; taxTotal: string; total: string };
  locale: 'ja' | 'en';
}
export type StatementHtmlRenderer = (data: StatementRenderData, tools: PrintTools) => string;

const L = {
  title: { ja: '合計請求書', en: 'Statement of invoices' },
  closingDate: { ja: '締め日', en: 'Closing date' },
  period: { ja: '対象期間', en: 'Period' },
  issueDate: { ja: '発行日', en: 'Issue date' },
  dueDate: { ja: 'お支払期限', en: 'Payment due' },
  headline: { ja: '当期ご請求額合計（税込）', en: 'Total of invoices this period' },
  paidIncluded: { ja: '入金済みの請求書を含みます', en: 'Includes invoices already paid' },
  summaryOf: { ja: '各請求書（適格請求書）の合計です', en: 'Summary of the listed qualified invoices' },
  invoiceDate: { ja: '請求日', en: 'Invoice date' },
  invoiceNo: { ja: '請求書番号', en: 'Invoice no.' },
  invoiceDue: { ja: '支払期日', en: 'Due date' },
  subtotal: { ja: '税抜金額', en: 'Amount (excl. tax)' },
  tax: { ja: '消費税額', en: 'Tax' },
  total: { ja: '税込金額', en: 'Amount (incl. tax)' },
  sum: { ja: '合計', en: 'Total' },
  byRate: { ja: '税率ごとの合計', en: 'Totals by tax rate' },
  none: { ja: 'この期間の確定済みの請求書はありません', en: 'No submitted invoices in this period' },
  bank: { ja: 'お振込先', en: 'Bank details' },
} satisfies Record<string, Label>;

export const defaultStatementHtml: StatementHtmlRenderer = (d, tools) => {
  const t = tools.t;
  const s = d.statement;
  const meta: Array<readonly [string, string]> = [
    [t(L.closingDate), tools.date(s.closingDate)],
    [t(L.period), `${tools.date(s.periodStart)} 〜 ${tools.date(s.closingDate)}`],
    [t(L.issueDate), tools.date(s.issueDate)],
  ];
  if (s.dueDate) meta.push([t(L.dueDate), tools.date(s.dueDate)]);
  const invoices = dataTable(
    [
      { label: t(L.invoiceDate) },
      { label: t(L.invoiceNo) },
      { label: t(L.invoiceDue) },
      { label: t(L.subtotal), align: 'right' },
      { label: t(L.tax), align: 'right' },
      { label: t(L.total), align: 'right' },
    ],
    d.invoices.map((i) => [
      tools.date(i.date),
      i.number,
      i.dueDate ? tools.date(i.dueDate) : '—',
      formatMoney(i.subtotal),
      formatMoney(i.taxTotal),
      formatMoney(i.total),
    ]),
    {
      className: 'statement-invoices',
      minWidth: '600px',
      empty: t(L.none),
      foot: [
        t(L.sum),
        '',
        '',
        formatMoney(d.totals.subtotal),
        formatMoney(d.totals.taxTotal),
        formatMoney(d.totals.total),
      ],
    },
  );
  const body = [
    documentHeader(t(L.title), meta),
    partiesSection(addresseeBlock(d.recipient, d.locale), issuerBlock(d.issuer, d.locale)),
    amountBlock(t(L.headline), d.totals.total, d.locale),
    noteLine(t(L.paidIncluded)),
    noteLine(t(L.summaryOf)),
    invoices,
    d.taxSummary.length
      ? taxBreakdownTable(d.taxSummary, d.locale, {
          caption: t(L.byRate),
          total: { taxable: d.totals.subtotal, tax: d.totals.taxTotal, gross: d.totals.total },
        })
      : '',
    remarksSection(t(L.bank), d.issuer.bankInfo, 'bank'),
  ].filter(Boolean);
  return printDocument({
    title: `${t(L.title)} ${d.recipient.name} ${s.closingDate}`,
    locale: d.locale,
    body: body.join('\n'),
    className: 'statement',
  });
};
