// Default 適格請求書 renderer (spec AC-5): minimal semantic HTML with inline CSS. Pure: takes InvoiceRenderData,
// returns a string. l10n/jp or a pack may replace it via registry.registerOverride('sales.invoice_html', fn).
// 記載事項 (国税庁 タックスアンサー No.6625; docs/domain/japan-tax.md#インボイス制度): ①発行者の名称・登録番号 ②取引年月日
// ③取引内容（軽減税率対象は ※） ④税率ごとに区分した対価の額（税抜/税込）と適用税率 ⑤税率ごとの消費税額 ⑥交付を受ける者の名称.
import { Decimal, type Label, type Locale } from '@daifuku/kernel';
import { TAX_CATEGORY_LABELS, isTaxCategory } from '@daifuku/mod-tax';

export interface InvoiceRenderData {
  issuer: {
    name: string;
    invoiceRegistrationNo?: string;
    postalCode?: string;
    address?: string;
    phone?: string;
    email?: string;
    bankInfo?: string;
  };
  invoice: {
    docstatus?: number;
    number: string;
    date: string;
    dueDate: string | null;
    note: string | null;
    priceIncludesTax: boolean;
  };
  recipient: { name: string; postalCode?: string; address?: string };
  lines: Array<{
    uomCode?: string;
    seq: number;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    taxCategory: string;
    rate: string;
  }>;
  /** rate '0.10' etc.; money as Decimal strings */
  taxSummary: Array<{ category: string; rate: string; taxable: string; tax: string; gross: string }>;
  totals: { subtotal: string; taxTotal: string; total: string };
  locale: 'ja' | 'en';
}
export type InvoiceHtmlRenderer = (data: InvoiceRenderData) => string;

/** Line-level marker for 軽減税率対象 (記載事項③). */
export const REDUCED_MARK = '※';

const L = {
  title: { ja: '請求書（適格請求書）', en: 'Invoice (Qualified invoice)' },
  number: { ja: '請求書番号', en: 'Invoice no.' },
  draft: { ja: '（下書き）', en: '(draft)' },
  date: { ja: '請求日', en: 'Invoice date' },
  dueDate: { ja: '支払期日', en: 'Due date' },
  recipientSuffix: { ja: ' 御中', en: '' },
  registrationNo: { ja: '登録番号', en: 'Registration no.' },
  phone: { ja: 'TEL', en: 'Tel' },
  seq: { ja: 'No.', en: 'No.' },
  description: { ja: '品名', en: 'Description' },
  quantity: { ja: '数量', en: 'Qty' },
  unitPrice: { ja: '単価', en: 'Unit price' },
  amount: { ja: '金額', en: 'Amount' },
  rate: { ja: '税率', en: 'Rate' },
  summaryRate: { ja: '税率区分', en: 'Tax rate' },
  taxableExcl: { ja: '対価の額（税抜）', en: 'Amount (excl. tax)' },
  taxableIncl: { ja: '対価の額（税込）', en: 'Amount (incl. tax)' },
  tax: { ja: '消費税額', en: 'Tax' },
  subtotal: { ja: '税抜合計', en: 'Subtotal' },
  taxTotal: { ja: '消費税合計', en: 'Total tax' },
  total: { ja: '合計金額（税込）', en: 'Total (incl. tax)' },
  legend: { ja: `${REDUCED_MARK}は軽減税率対象`, en: `${REDUCED_MARK} = reduced tax rate item` },
  bank: { ja: 'お振込先', en: 'Bank details' },
  note: { ja: '備考', en: 'Note' },
} satisfies Record<string, Label>;

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** '1234567.5' -> '1,234,567.5' (string arithmetic only, ADR-0010). Non-decimal input is returned as-is. */
export function formatMoney(s: string): string {
  if (!Decimal.isDecimalString(s)) return s;
  const canonical = Decimal.from(s).toString();
  const negative = canonical.startsWith('-');
  const [int = '', frac] = (negative ? canonical.slice(1) : canonical).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** '0.1' -> '10%'. */
export function formatRate(rate: string): string {
  return Decimal.isDecimalString(rate) ? `${Decimal.from(rate).times(100).toString()}%` : rate;
}

function rateLabel(category: string, rate: string, locale: Locale): string {
  const name = isTaxCategory(category) ? TAX_CATEGORY_LABELS[category][locale] : category;
  return category === 'standard' || category === 'reduced' ? `${name} ${formatRate(rate)}` : name;
}

const CELL = 'padding:4px 8px;border-bottom:1px solid #ddd;';
const RIGHT = `${CELL}text-align:right;`;
const th = (text: string, right = false) =>
  `<th style="${right ? RIGHT : CELL}text-align:${right ? 'right' : 'left'};background:#f5f5f5;">${escapeHtml(text)}</th>`;
const td = (text: string, right = false) => `<td style="${right ? RIGHT : CELL}">${escapeHtml(text)}</td>`;

function partiesHtml(d: InvoiceRenderData, t: (l: Label) => string): string {
  const r = d.recipient;
  const i = d.issuer;
  const addr = (postal: string | undefined, address: string | undefined) =>
    [postal ? `〒${postal}` : '', address ?? ''].filter(Boolean).map(escapeHtml).join(' ');
  const issuerLines = [
    `<strong>${escapeHtml(i.name)}</strong>`,
    i.invoiceRegistrationNo ? `${escapeHtml(t(L.registrationNo))}: ${escapeHtml(i.invoiceRegistrationNo)}` : '',
    addr(i.postalCode, i.address),
    i.phone ? `${escapeHtml(t(L.phone))}: ${escapeHtml(i.phone)}` : '',
    i.email ? escapeHtml(i.email) : '',
  ].filter(Boolean);
  return `<section class="parties" style="display:flex;justify-content:space-between;gap:24px;margin:16px 0;">
<div class="recipient"><p class="recipient-name" style="font-size:1.2em;margin:0;">${escapeHtml(r.name)}${escapeHtml(t(L.recipientSuffix))}</p><p style="margin:4px 0;">${addr(r.postalCode, r.address)}</p></div>
<address class="issuer" style="font-style:normal;text-align:right;">${issuerLines.join('<br>')}</address>
</section>`;
}

function linesHtml(d: InvoiceRenderData, t: (l: Label) => string): string {
  const rows = d.lines
    .map((l) => {
      const name = `${l.taxCategory === 'reduced' ? REDUCED_MARK : ''}${l.description}`;
      return `<tr>${td(String(l.seq), true)}${td(name)}${td([l.quantity, l.uomCode].filter(Boolean).join(' '), true)}${td(formatMoney(l.unitPrice), true)}${td(formatMoney(l.amount), true)}${td(formatRate(l.rate), true)}</tr>`;
    })
    .join('\n');
  return `<table class="lines" style="width:100%;border-collapse:collapse;margin:16px 0;">
<thead><tr>${th(t(L.seq), true)}${th(t(L.description))}${th(t(L.quantity), true)}${th(t(L.unitPrice), true)}${th(t(L.amount), true)}${th(t(L.rate), true)}</tr></thead>
<tbody>
${rows}
</tbody></table>`;
}

function summaryHtml(d: InvoiceRenderData, t: (l: Label) => string): string {
  const amountHead = d.invoice.priceIncludesTax ? t(L.taxableIncl) : t(L.taxableExcl);
  const rows = d.taxSummary
    .map(
      (g) =>
        `<tr>${td(rateLabel(g.category, g.rate, d.locale))}${td(formatMoney(d.invoice.priceIncludesTax ? g.gross : g.taxable), true)}${td(formatMoney(g.tax), true)}</tr>`,
    )
    .join('\n');
  return `<table class="tax-summary" style="border-collapse:collapse;margin:16px 0;min-width:50%;">
<thead><tr>${th(t(L.summaryRate))}${th(amountHead, true)}${th(t(L.tax), true)}</tr></thead>
<tbody>
${rows}
</tbody></table>`;
}

function totalsHtml(d: InvoiceRenderData, t: (l: Label) => string): string {
  const row = (label: string, value: string, strong = false) =>
    `<tr>${th(label)}<td style="${RIGHT}${strong ? 'font-weight:bold;font-size:1.1em;' : ''}">${escapeHtml(formatMoney(value))}</td></tr>`;
  return `<table class="totals" style="border-collapse:collapse;margin:16px 0 16px auto;min-width:40%;">
<tbody>
${row(t(L.subtotal), d.totals.subtotal)}
${row(t(L.taxTotal), d.totals.taxTotal)}
${row(t(L.total), d.totals.total, true)}
</tbody></table>`;
}

/** The default layout. Money strings are grouped with commas; everything user-supplied is HTML-escaped. */
export const defaultInvoiceHtml: InvoiceHtmlRenderer = (d) => {
  const t = (l: Label) => l[d.locale];
  const number = d.invoice.number || t(L.draft);
  const meta = [
    `<tr>${th(t(L.number))}${td(number)}</tr>`,
    `<tr>${th(t(L.date))}${td(d.invoice.date)}</tr>`,
    d.invoice.dueDate ? `<tr>${th(t(L.dueDate))}${td(d.invoice.dueDate)}</tr>` : '',
  ].join('\n');
  const hasReduced = d.lines.some((l) => l.taxCategory === 'reduced');
  const bank = d.issuer.bankInfo
    ? `<section class="bank"><h2 style="font-size:1em;margin:16px 0 4px;">${escapeHtml(t(L.bank))}</h2><p style="margin:0;white-space:pre-line;">${escapeHtml(d.issuer.bankInfo)}</p></section>`
    : '';
  const note = d.invoice.note
    ? `<section class="note"><h2 style="font-size:1em;margin:16px 0 4px;">${escapeHtml(t(L.note))}</h2><p style="margin:0;white-space:pre-line;">${escapeHtml(d.invoice.note)}</p></section>`
    : '';
  return `<article class="invoice" lang="${d.locale}" style="font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#111;">
<header style="display:flex;justify-content:space-between;align-items:flex-start;">
<h1 style="font-size:1.6em;margin:0;">${escapeHtml(t(L.title))}</h1>
<table class="meta" style="border-collapse:collapse;"><tbody>
${meta}
</tbody></table>
</header>
${partiesHtml(d, t)}
${linesHtml(d, t)}
${summaryHtml(d, t)}
${totalsHtml(d, t)}
${hasReduced ? `<p class="legend" style="font-size:0.9em;margin:0;">${escapeHtml(t(L.legend))}</p>` : ''}
${bank}
${note}
</article>`;
};
