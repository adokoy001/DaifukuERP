// 適格請求書 (qualified invoice) HTML in the Japanese layout (spec AC-4; docs/domain/japan-tax.md#インボイス制度: the six
// required items — 発行者名＋登録番号, 取引年月日, 取引内容（軽減税率対象の明示）, 税率ごとに区分した対価の額と適用税率,
// 税率ごとの消費税額, 交付先). Pure: validates the render data with zod, escapes every user string, emits self-contained HTML.
import { ValidationError, label, t, type Label, type Locale } from '@daifuku/kernel';
import { formatJpy, formatNumber, formatRatePercent } from './format.ts';
import { INVOICE_CSS } from './invoice-html-style.ts';
import {
  invoiceRenderDataSchema,
  type InvoiceHtmlRenderer,
  type ParsedInvoiceRenderData,
} from './invoice-render-data.ts';
import { formatDateJa, toWareki } from './wareki.ts';

type Line = ParsedInvoiceRenderData['lines'][number];
type Group = ParsedInvoiceRenderData['taxSummary'][number];

/** Marks a line/group as 軽減税率対象. Keyed on the category, not on "8%" (standard 8% existed 2014–2019). */
export const REDUCED_CATEGORY = 'reduced';
export const REDUCED_MARK = '※';

const L = {
  title: label('請求書', 'Invoice'),
  honorific: label('御中', ''),
  regNo: label('登録番号', 'Registration No.'),
  postal: label('〒', 'Postal code'),
  tel: label('TEL', 'Tel'),
  email: label('E-mail', 'E-mail'),
  invoiceNo: label('請求書番号', 'Invoice No.'),
  issueDate: label('発行日', 'Issue date'),
  dueDate: label('支払期限', 'Due date'),
  amountDue: label('ご請求金額（税込）', 'Amount due (tax incl.)'),
  seq: label('No.', 'No.'),
  description: label('品名', 'Description'),
  quantity: label('数量', 'Qty'),
  unitPrice: label('単価', 'Unit price'),
  amount: label('金額', 'Amount'),
  taxIncl: label('（税込）', ' (tax incl.)'),
  taxCategory: label('税区分', 'Tax'),
  legend: label('※印は軽減税率対象品目', '※ marks items subject to the reduced tax rate'),
  byRate: label('税率ごとの合計', 'Totals by tax rate'),
  rate: label('税率', 'Rate'),
  taxable: label('税抜金額', 'Net'),
  tax: label('消費税額', 'Tax'),
  gross: label('税込金額', 'Gross'),
  subject: label('対象', ''),
  reduced: label('軽減税率対象', 'reduced rate'),
  total: label('合計', 'Total'),
  bank: label('振込先', 'Bank transfer'),
  remarks: label('備考', 'Remarks'),
  noLines: label('明細なし', 'No lines'),
} satisfies Record<string, Label>;

const CATEGORY_LABELS: Record<string, Label> = {
  exempt: label('免税', 'Exempt'),
  non_taxable: label('非課税', 'Non-taxable'),
  out_of_scope: label('不課税', 'Out of scope'),
};

/** HTML-escapes text nodes and attribute values (XSS: every string from the render data passes through here). */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

const esc = escapeHtml;

function dateWithWareki(date: string, locale: Locale): string {
  const western = locale === 'ja' ? formatDateJa(date) : date;
  return `${western}（${toWareki(date)}）`;
}

/** '0.10' + category → '10%' / '8%（軽減）' / '免税' … for the line 税区分 column. */
function categoryCell(category: string, rate: string, locale: Locale): string {
  const named = CATEGORY_LABELS[category];
  if (named) return esc(t(named, locale));
  const pct = formatRatePercent(rate);
  return category === REDUCED_CATEGORY ? esc(`${pct}（${t(L.reduced, locale)}）`) : esc(pct);
}

function lineRow(line: Line, locale: Locale): string {
  const mark = line.taxCategory === REDUCED_CATEGORY ? REDUCED_MARK : '';
  return [
    '<tr>',
    `<td class="center">${esc(String(line.seq))}</td>`,
    `<td>${esc(line.description)}${mark}</td>`,
    `<td class="num">${esc(formatNumber(line.quantity))}</td>`,
    `<td class="num">${esc(formatJpy(line.unitPrice))}</td>`,
    `<td class="num">${esc(formatJpy(line.amount))}</td>`,
    `<td class="center">${categoryCell(line.taxCategory, line.rate, locale)}</td>`,
    '</tr>',
  ].join('');
}

function groupLabel(g: Group, locale: Locale): string {
  const named = CATEGORY_LABELS[g.category];
  if (named) return esc(t(named, locale));
  const base = `${formatRatePercent(g.rate)}${t(L.subject, locale)}`;
  return g.category === REDUCED_CATEGORY ? esc(`${base}（${t(L.reduced, locale)}）`) : esc(base);
}

function groupRow(g: Group, locale: Locale): string {
  return `<tr><th scope="row">${groupLabel(g, locale)}</th><td class="num">${esc(formatJpy(g.taxable))}</td><td class="num">${esc(formatJpy(g.tax))}</td><td class="num">${esc(formatJpy(g.gross))}</td></tr>`;
}

function optionalP(cls: string, prefix: string, value: string | undefined): string {
  if (value === undefined || value === '') return '';
  return `<p class="${cls}">${prefix}${esc(value)}</p>`;
}

function headSection(d: ParsedInvoiceRenderData, locale: Locale): string {
  const { issuer, recipient } = d;
  const honorific = t(L.honorific, locale);
  return [
    '<section class="head">',
    '<div class="recipient">',
    optionalP('postal', `${t(L.postal, locale)} `, recipient.postalCode),
    optionalP('address', '', recipient.address),
    `<p class="name">${esc(recipient.name)}${honorific ? ` ${honorific}` : ''}</p>`,
    '</div>',
    '<div class="issuer">',
    `<p class="name">${esc(issuer.name)}</p>`,
    optionalP('regno', `${t(L.regNo, locale)} `, issuer.invoiceRegistrationNo),
    optionalP('postal', `${t(L.postal, locale)} `, issuer.postalCode),
    optionalP('address', '', issuer.address),
    optionalP('phone', `${t(L.tel, locale)} `, issuer.phone),
    optionalP('email', `${t(L.email, locale)} `, issuer.email),
    '</div>',
    '</section>',
  ].join('');
}

function metaSection(d: ParsedInvoiceRenderData, locale: Locale): string {
  const inv = d.invoice;
  const due = inv.dueDate === null ? '—' : esc(dateWithWareki(inv.dueDate, locale));
  return [
    '<table class="meta">',
    `<tr><th scope="row">${t(L.invoiceNo, locale)}</th><td>${esc(inv.number)}</td></tr>`,
    `<tr><th scope="row">${t(L.issueDate, locale)}</th><td>${esc(dateWithWareki(inv.date, locale))}</td></tr>`,
    `<tr><th scope="row">${t(L.dueDate, locale)}</th><td>${due}</td></tr>`,
    '</table>',
    `<div class="amount-due"><span class="label">${t(L.amountDue, locale)}</span><span class="value">${esc(formatJpy(d.totals.total))}</span></div>`,
  ].join('');
}

function linesSection(d: ParsedInvoiceRenderData, locale: Locale): string {
  const incl = d.invoice.priceIncludesTax ? t(L.taxIncl, locale) : '';
  const body =
    d.lines.length === 0
      ? `<tr><td colspan="6" class="center">${t(L.noLines, locale)}</td></tr>`
      : d.lines.map((l) => lineRow(l, locale)).join('');
  return [
    '<table class="lines">',
    `<thead><tr><th>${t(L.seq, locale)}</th><th>${t(L.description, locale)}</th><th>${t(L.quantity, locale)}</th><th>${t(L.unitPrice, locale)}${incl}</th><th>${t(L.amount, locale)}${incl}</th><th>${t(L.taxCategory, locale)}</th></tr></thead>`,
    `<tbody>${body}</tbody>`,
    '</table>',
    `<p class="legend">${t(L.legend, locale)}</p>`,
  ].join('');
}

function taxSummarySection(d: ParsedInvoiceRenderData, locale: Locale): string {
  const { subtotal, taxTotal, total } = d.totals;
  return [
    '<table class="tax-summary">',
    `<caption>${t(L.byRate, locale)}</caption>`,
    `<thead><tr><th>${t(L.rate, locale)}</th><th>${t(L.taxable, locale)}</th><th>${t(L.tax, locale)}</th><th>${t(L.gross, locale)}</th></tr></thead>`,
    `<tbody>${d.taxSummary.map((g) => groupRow(g, locale)).join('')}</tbody>`,
    `<tfoot><tr><th scope="row">${t(L.total, locale)}</th><td class="num">${esc(formatJpy(subtotal))}</td><td class="num">${esc(formatJpy(taxTotal))}</td><td class="num">${esc(formatJpy(total))}</td></tr></tfoot>`,
    '</table>',
  ].join('');
}

function footerSections(d: ParsedInvoiceRenderData, locale: Locale): string {
  const bank = d.issuer.bankInfo;
  const note = d.invoice.note;
  return [
    bank === undefined || bank === ''
      ? ''
      : `<section class="bank"><h2>${t(L.bank, locale)}</h2><p>${esc(bank)}</p></section>`,
    note === null || note === ''
      ? ''
      : `<section class="remarks"><h2>${t(L.remarks, locale)}</h2><p>${esc(note)}</p></section>`,
  ].join('');
}

/** Validates the render data (VALIDATION on mismatch) and returns the parsed value. */
export function parseInvoiceRenderData(data: unknown): ParsedInvoiceRenderData {
  const r = invoiceRenderDataSchema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(
      'sales.invoice_html: render data does not match the InvoiceRenderData contract',
      r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      'Compare docs/specs/sales.md#InvoiceRenderData with l10n/jp/src/services/invoice-render-data.ts',
    );
  }
  return r.data;
}

/** The override registered under `sales.invoice_html`. Output: a complete HTML document with inline CSS only. */
export const renderInvoiceHtml: InvoiceHtmlRenderer = (data) => {
  const d = parseInvoiceRenderData(data);
  const locale = d.locale;
  const title = `${t(L.title, locale)} ${d.invoice.number}`;
  return [
    '<!DOCTYPE html>',
    `<html lang="${locale}">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${INVOICE_CSS}</style></head>`,
    '<body>',
    '<article class="invoice">',
    `<h1>${t(L.title, locale)}</h1>`,
    headSection(d, locale),
    metaSection(d, locale),
    linesSection(d, locale),
    taxSummarySection(d, locale),
    footerSections(d, locale),
    '</article>',
    '</body>',
    '</html>',
  ].join('\n');
};
