// Default 適格請求書 renderer (spec AC-5): minimal semantic HTML with inline CSS. Pure: takes InvoiceRenderData,
// returns a string. l10n/jp or a pack may replace it via registry.registerOverride('sales.invoice_html', fn).
// 記載事項 (国税庁 タックスアンサー No.6625; docs/domain/japan-tax.md#インボイス制度): ①発行者の名称・登録番号 ②取引年月日
// ③取引内容（軽減税率対象は ※） ④税率ごとに区分した対価の額（税抜/税込）と適用税率 ⑤税率ごとの消費税額 ⑥交付を受ける者の名称.
// The parts come from @daifuku/mod-print-layout (docs/specs/print-templates.md AC-5); the output keeps its fragment form.
import type { Label, Locale } from '@daifuku/kernel';
import {
  addresseeBlock,
  documentHeader,
  escapeHtml,
  formatMoney,
  formatRate,
  issuerBlock,
  lineTable,
  partiesSection,
  reducedLegend,
  remarksSection,
  REDUCED_MARK,
  taxBreakdownTable,
  totalsTable,
} from '@daifuku/mod-print-layout';
import { TAX_CATEGORY_LABELS, isTaxCategory } from '@daifuku/mod-tax';

/** Kept for existing importers of this file (recalculate.test.ts and the package index). */
export { escapeHtml, formatMoney, formatRate, REDUCED_MARK };

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

const L = {
  title: { ja: '請求書（適格請求書）', en: 'Invoice (Qualified invoice)' },
  number: { ja: '請求書番号', en: 'Invoice no.' },
  draft: { ja: '（下書き）', en: '(draft)' },
  date: { ja: '請求日', en: 'Invoice date' },
  dueDate: { ja: '支払期日', en: 'Due date' },
  recipientSuffix: { ja: ' 御中', en: '' },
  unitPrice: { ja: '単価', en: 'Unit price' },
  amount: { ja: '金額', en: 'Amount' },
  rate: { ja: '税率', en: 'Rate' },
  taxableExcl: { ja: '対価の額（税抜）', en: 'Amount (excl. tax)' },
  taxableIncl: { ja: '対価の額（税込）', en: 'Amount (incl. tax)' },
  subtotal: { ja: '税抜合計', en: 'Subtotal' },
  taxTotal: { ja: '消費税合計', en: 'Total tax' },
  total: { ja: '合計金額（税込）', en: 'Total (incl. tax)' },
  bank: { ja: 'お振込先', en: 'Bank details' },
  note: { ja: '備考', en: 'Note' },
} satisfies Record<string, Label>;

/** Category name with the rate for taxable categories: '課税（標準） 10%'. */
export function rateLabel(category: string, rate: string, locale: Locale): string {
  const name = isTaxCategory(category) ? TAX_CATEGORY_LABELS[category][locale] : category;
  return category === 'standard' || category === 'reduced' ? `${name} ${formatRate(rate)}` : name;
}

/** The default layout. Money strings are grouped with commas; everything user-supplied is HTML-escaped. */
export const defaultInvoiceHtml: InvoiceHtmlRenderer = (d) => {
  const t = (l: Label) => l[d.locale];
  const meta: Array<readonly [string, string]> = [
    [t(L.number), d.invoice.number || t(L.draft)],
    [t(L.date), d.invoice.date],
  ];
  if (d.invoice.dueDate) meta.push([t(L.dueDate), d.invoice.dueDate]);
  const lines = lineTable(
    d.lines.map((l) => ({
      seq: l.seq,
      description: l.description,
      quantity: l.quantity,
      ...(l.uomCode ? { uomCode: l.uomCode } : {}),
      unitPrice: l.unitPrice,
      amount: l.amount,
      taxLabel: formatRate(l.rate),
      reduced: l.taxCategory === 'reduced',
    })),
    d.locale,
    { labels: { unitPrice: t(L.unitPrice), amount: t(L.amount), tax: t(L.rate) } },
  );
  const incl = d.invoice.priceIncludesTax;
  const summary = taxBreakdownTable(
    d.taxSummary.map((g) => ({
      label: rateLabel(g.category, g.rate, d.locale),
      taxable: incl ? g.gross : g.taxable,
      tax: g.tax,
      gross: g.gross,
    })),
    d.locale,
    { amountLabel: incl ? t(L.taxableIncl) : t(L.taxableExcl), gross: false },
  );
  const totals = totalsTable([
    { label: t(L.subtotal), value: d.totals.subtotal },
    { label: t(L.taxTotal), value: d.totals.taxTotal },
    { label: t(L.total), value: d.totals.total, strong: true },
  ]);
  const hasReduced = d.lines.some((l) => l.taxCategory === 'reduced');
  return `<article class="invoice" lang="${d.locale}" style="font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#111;">
${documentHeader(t(L.title), meta)}
${partiesSection(addresseeBlock(d.recipient, d.locale, L.recipientSuffix), issuerBlock(d.issuer, d.locale))}
${lines}
${summary}
${totals}
${hasReduced ? reducedLegend(d.locale) : ''}
${remarksSection(t(L.bank), d.issuer.bankInfo, 'bank')}
${remarksSection(t(L.note), d.invoice.note, 'note')}
</article>`;
};
