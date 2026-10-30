// Shared parts of printed documents (docs/specs/print-templates.md AC-5, AC-6): issuer, addressee, line table, tax
// breakdown, totals, remarks, status banner. Pure functions returning HTML fragments with inline styles, so a part works
// inside a full document (printDocument) and on its own (sales' default invoice fragment). Every text argument is
// escaped here; callers pass plain strings (already formatted money, labels, dates), never HTML.
import type { Label, Locale } from '@daifuku/kernel';
import { escapeHtml, formatMoney } from './format.ts';
import type { PrintIssuer } from './issuer.ts';

/** Line-level marker for 軽減税率対象 (適格請求書 記載事項③; docs/domain/japan-tax.md#インボイス制度). */
export const REDUCED_MARK = '※';

export type Align = 'left' | 'right' | 'center';

const L = {
  registrationNo: { ja: '登録番号', en: 'Registration no.' },
  phone: { ja: 'TEL', en: 'Tel' },
  honorific: { ja: ' 御中', en: '' },
  legend: { ja: `${REDUCED_MARK}は軽減税率対象`, en: `${REDUCED_MARK} = reduced tax rate item` },
  seq: { ja: 'No.', en: 'No.' },
  description: { ja: '品名', en: 'Description' },
  quantity: { ja: '数量', en: 'Qty' },
  unitPrice: { ja: '税抜単価', en: 'Unit price (excl. tax)' },
  amount: { ja: '税抜金額', en: 'Amount (excl. tax)' },
  taxCategory: { ja: '税区分', en: 'Tax' },
  summaryRate: { ja: '税率区分', en: 'Tax rate' },
  taxable: { ja: '対価の額（税抜）', en: 'Amount (excl. tax)' },
  tax: { ja: '消費税額', en: 'Tax' },
  gross: { ja: '税込額', en: 'Amount (incl. tax)' },
  total: { ja: '合計', en: 'Total' },
  draft: { ja: '下書き（未確定）', en: 'DRAFT' },
  cancelled: { ja: '取消済み', en: 'CANCELLED' },
  openPeriod: { ja: '締め前（期間途中）', en: 'Period not yet closed' },
} satisfies Record<string, Label>;

const tr = (l: Label, locale: Locale) => l[locale];

export const CELL = 'padding:4px 8px;border-bottom:1px solid #ddd;';
const RIGHT = `${CELL}text-align:right;`;

/** A header cell (escaped). */
export function th(text: string, align: Align = 'left'): string {
  return `<th style="${CELL}text-align:${align};background:#f5f5f5;">${escapeHtml(text)}</th>`;
}

/** A data cell (escaped). */
export function td(text: string, align: Align = 'left', extra = ''): string {
  const base = align === 'right' ? RIGHT : align === 'center' ? `${CELL}text-align:center;` : CELL;
  return `<td style="${base}${extra}">${escapeHtml(text)}</td>`;
}

/** '〒150-0001 東京都渋谷区2-2' (escaped); empty parts are left out. */
export function postalAddress(postalCode: string | undefined, address: string | undefined): string {
  return [postalCode ? `〒${postalCode}` : '', address ?? ''].filter(Boolean).map(escapeHtml).join(' ');
}

/**
 * The issuer (発行者) block, right-aligned: name, registration number (unless `registrationNo: false`; AC-9 leaves it
 * off documents the company sends as the buyer), postal address, phone and email.
 */
export function issuerBlock(issuer: PrintIssuer, locale: Locale, opts: { registrationNo?: boolean } = {}): string {
  const lines = [
    `<strong>${escapeHtml(issuer.name)}</strong>`,
    opts.registrationNo !== false && issuer.invoiceRegistrationNo
      ? `${escapeHtml(tr(L.registrationNo, locale))}: ${escapeHtml(issuer.invoiceRegistrationNo)}`
      : '',
    postalAddress(issuer.postalCode, issuer.address),
    issuer.phone ? `${escapeHtml(tr(L.phone, locale))}: ${escapeHtml(issuer.phone)}` : '',
    issuer.email ? escapeHtml(issuer.email) : '',
  ].filter(Boolean);
  return `<address class="issuer" style="font-style:normal;text-align:right;">${lines.join('<br>')}</address>`;
}

export interface Addressee {
  name: string;
  postalCode?: string;
  address?: string;
  /** Extra plain-text lines under the address (e.g. employee code and site on the payslip). */
  lines?: readonly string[];
}

/** The addressee (宛先) block. The honorific defaults to 御中 (ja only); the payslip passes 様. */
export function addresseeBlock(to: Addressee, locale: Locale, honorific: Label = L.honorific): string {
  const address = postalAddress(to.postalCode, to.address);
  const extra = (to.lines ?? []).map((l) => `<p style="margin:4px 0;">${escapeHtml(l)}</p>`).join('');
  return `<div class="recipient"><p class="recipient-name" style="font-size:1.2em;margin:0;">${escapeHtml(to.name)}${escapeHtml(tr(honorific, locale))}</p>${address ? `<p style="margin:4px 0;">${address}</p>` : ''}${extra}</div>`;
}

/** Addressee left, issuer right; wraps on a narrow screen. */
export function partiesSection(addressee: string, issuer: string): string {
  return `<section class="parties" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:24px;margin:16px 0;">
${addressee}
${issuer}
</section>`;
}

/** Number / date pairs at the top right. */
export function metaTable(rows: ReadonlyArray<readonly [string, string]>): string {
  return `<table class="meta" style="border-collapse:collapse;"><tbody>
${rows.map(([k, v]) => `<tr>${th(k)}${td(v)}</tr>`).join('\n')}
</tbody></table>`;
}

/** Title and meta table. */
export function documentHeader(title: string, meta: ReadonlyArray<readonly [string, string]>): string {
  return `<header style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-start;">
<h1 style="font-size:1.6em;margin:0;">${escapeHtml(title)}</h1>
${metaTable(meta)}
</header>`;
}

/** The headline amount (御見積金額, 領収金額 …): label and grouped amount with the currency unit. */
export function amountBlock(label: string, amount: string, locale: Locale): string {
  const value = locale === 'ja' ? `${formatMoney(amount)}円` : `JPY ${formatMoney(amount)}`;
  return `<p class="amount" style="font-size:1.2em;margin:16px 0;padding:4px 0;border-bottom:2px solid #111;display:inline-block;"><span>${escapeHtml(label)}</span> <strong style="margin-left:16px;">${escapeHtml(value)}</strong></p>`;
}

export interface Column {
  label: string;
  align?: Align;
}

/**
 * A table of plain-text cells inside a horizontally scrolling frame (AC-25: on a 390px screen only the table scrolls).
 * `foot` is an optional totals row; `empty` is shown as one row when there are no rows.
 */
export function dataTable(
  columns: readonly Column[],
  rows: ReadonlyArray<readonly string[]>,
  opts: { className: string; caption?: string; foot?: readonly string[]; empty?: string; minWidth?: string },
): string {
  const head = `<thead><tr>${columns.map((c) => th(c.label, c.align)).join('')}</tr></thead>`;
  const body =
    rows.length === 0 && opts.empty
      ? `<tr><td colspan="${columns.length}" style="${CELL}text-align:center;">${escapeHtml(opts.empty)}</td></tr>`
      : rows.map((r) => `<tr>${r.map((cell, i) => td(cell, columns[i]?.align)).join('')}</tr>`).join('\n');
  const foot = opts.foot
    ? `\n<tfoot><tr>${opts.foot.map((cell, i) => td(cell, columns[i]?.align, 'font-weight:bold;border-top:1px solid #999;')).join('')}</tr></tfoot>`
    : '';
  const caption = opts.caption
    ? `<caption style="text-align:left;font-weight:bold;padding:4px 0;">${escapeHtml(opts.caption)}</caption>`
    : '';
  return `<div class="table-wrap" style="overflow-x:auto;max-width:100%;margin:16px 0;">
<table class="${escapeHtml(opts.className)}" style="width:100%;border-collapse:collapse;min-width:${opts.minWidth ?? '0'};">${caption}
${head}
<tbody>
${body}
</tbody>${foot}</table>
</div>`;
}

/** One item line as printed: money / quantity as stored Decimal strings, the tax column already labelled by the caller. */
export interface PrintLine {
  seq: number;
  description: string;
  quantity: string;
  uomCode?: string;
  unitPrice: string;
  amount: string;
  /** Tax category name, with the rate when the caller shows one (e.g. '課税（標準） 10%', or just '課税（軽減）'). */
  taxLabel: string;
  /** 軽減税率対象: the description gets ※. */
  reduced: boolean;
}

/**
 * The item line table (明細表): No., 品名 (※ for reduced-rate lines), 数量 単位, 税抜単価, 税抜金額, 税区分. `labels`
 * renames the price / amount / tax headers (a tax-inclusive invoice prints 単価・金額, its tax column 税率).
 */
export function lineTable(
  lines: readonly PrintLine[],
  locale: Locale,
  opts: { empty?: string; labels?: { unitPrice?: string; amount?: string; tax?: string } } = {},
): string {
  return dataTable(
    [
      { label: tr(L.seq, locale), align: 'right' },
      { label: tr(L.description, locale) },
      { label: tr(L.quantity, locale), align: 'right' },
      { label: opts.labels?.unitPrice ?? tr(L.unitPrice, locale), align: 'right' },
      { label: opts.labels?.amount ?? tr(L.amount, locale), align: 'right' },
      { label: opts.labels?.tax ?? tr(L.taxCategory, locale) },
    ],
    lines.map((l) => [
      String(l.seq),
      `${l.reduced ? REDUCED_MARK : ''}${l.description}`,
      [formatMoney(l.quantity), l.uomCode].filter(Boolean).join(' '),
      formatMoney(l.unitPrice),
      formatMoney(l.amount),
      l.taxLabel,
    ]),
    { className: 'lines', minWidth: '560px', ...(opts.empty ? { empty: opts.empty } : {}) },
  );
}

export interface TaxBreakdownRow {
  /** e.g. '課税（標準） 10%' (the caller names the category and rate). */
  label: string;
  taxable: string;
  tax: string;
  gross: string;
}

/** 税率ごとの対価の額・消費税額・税込額 from stored values (AC-7: printed as stored; `total` is the caller's sum). */
export function taxBreakdownTable(
  rows: readonly TaxBreakdownRow[],
  locale: Locale,
  opts: {
    caption?: string;
    total?: Omit<TaxBreakdownRow, 'label'>;
    /** Header of the amount column (a tax-inclusive invoice prints 対価の額（税込） with the gross amount there). */
    amountLabel?: string;
    /** false: no 税込額 column (the invoice's 3-column summary). */
    gross?: boolean;
  } = {},
): string {
  const gross = opts.gross !== false;
  const cells = (label: string, r: Omit<TaxBreakdownRow, 'label'>) => [
    label,
    formatMoney(r.taxable),
    formatMoney(r.tax),
    ...(gross ? [formatMoney(r.gross)] : []),
  ];
  return dataTable(
    [
      { label: tr(L.summaryRate, locale) },
      { label: opts.amountLabel ?? tr(L.taxable, locale), align: 'right' },
      { label: tr(L.tax, locale), align: 'right' },
      ...(gross ? [{ label: tr(L.gross, locale), align: 'right' as const }] : []),
    ],
    rows.map((r) => cells(r.label, r)),
    {
      className: 'tax-summary',
      ...(opts.caption ? { caption: opts.caption } : {}),
      ...(opts.total ? { foot: cells(tr(L.total, locale), opts.total) } : {}),
    },
  );
}

/** Right-aligned totals (税抜合計 / 消費税 / 合計 …); `strong` marks the grand total. Values are grouped Decimal strings. */
export function totalsTable(rows: ReadonlyArray<{ label: string; value: string; strong?: boolean }>): string {
  const row = (r: { label: string; value: string; strong?: boolean }) =>
    `<tr>${th(r.label)}<td style="${RIGHT}${r.strong ? 'font-weight:bold;font-size:1.1em;' : ''}">${escapeHtml(formatMoney(r.value))}</td></tr>`;
  return `<table class="totals" style="border-collapse:collapse;margin:16px 0 16px auto;min-width:40%;">
<tbody>
${rows.map(row).join('\n')}
</tbody></table>`;
}

/** A headed paragraph (備考, お振込先, 但し書き …); '' when the text is empty. Line breaks are kept. */
export function remarksSection(heading: string, text: string | null | undefined, className = 'note'): string {
  if (text === null || text === undefined || text.trim() === '') return '';
  return `<section class="${escapeHtml(className)}"><h2 style="font-size:1em;margin:16px 0 4px;">${escapeHtml(heading)}</h2><p style="margin:0;white-space:pre-line;">${escapeHtml(text)}</p></section>`;
}

/** The ※ legend line. */
export function reducedLegend(locale: Locale): string {
  return `<p class="legend" style="font-size:0.9em;margin:0;">${escapeHtml(tr(L.legend, locale))}</p>`;
}

/** A fixed note line (small print). */
export function noteLine(text: string, className = 'fixed-note'): string {
  return `<p class="${escapeHtml(className)}" style="font-size:0.9em;margin:4px 0;">${escapeHtml(text)}</p>`;
}

export type BannerKind = 'draft' | 'cancelled' | 'open_period';

const BANNER_COLOR: Record<BannerKind, string> = { draft: '#b45309', cancelled: '#b91c1c', open_period: '#1d4ed8' };
const BANNER_TEXT: Record<BannerKind, Label> = { draft: L.draft, cancelled: L.cancelled, open_period: L.openPeriod };

/**
 * The state banner (AC-17): 「下書き（未確定） / DRAFT」, 「取消済み / CANCELLED」 (the invoice's existing banner, same
 * markup), 「締め前（期間途中） / Period not yet closed」. Bilingual on purpose: it must be read whatever the locale.
 */
export function statusBanner(kind: BannerKind): string {
  const color = BANNER_COLOR[kind];
  const text = `${BANNER_TEXT[kind].ja} / ${BANNER_TEXT[kind].en}`;
  return `<p role="status" style="border:2px solid ${color};padding:12px;color:${color};font-weight:bold">${escapeHtml(text)}</p>`;
}
