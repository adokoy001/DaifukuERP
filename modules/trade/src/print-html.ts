// Default layouts of 見積書, 注文書 and 納品書 (docs/specs/print-templates.md AC-10〜AC-12, AC-18). Pure: render data +
// PrintTools -> a complete HTML document built from @daifuku/mod-print-layout. Amounts and the tax breakdown are the
// stored values of the quotation / order / fulfillment lines (AC-7). Replaceable at trade.quotation_html,
// trade.order_html and trade.delivery_note_html (ADR-0008). Tax rate display and ※ follow the qualified-invoice items
// (国税庁 タックスアンサー No.6625; docs/domain/japan-tax.md#インボイス制度) without claiming to be a qualified invoice.
import type { Label } from '@daifuku/kernel';
import {
  addresseeBlock,
  amountBlock,
  dataTable,
  documentHeader,
  formatMoney,
  issuerBlock,
  lineTable,
  noteLine,
  partiesSection,
  printDocument,
  reducedLegend,
  remarksSection,
  taxBreakdownTable,
  totalsTable,
  type Addressee,
  type PrintIssuer,
  type PrintTools,
} from '@daifuku/mod-print-layout';

/** One item line as stored (money / quantity as Decimal strings); `taxLabel` names the category (and rate). */
export interface TradePrintLine {
  seq: number;
  description: string;
  quantity: string;
  uomCode?: string;
  unitPrice: string;
  amount: string;
  taxCategory: string;
  taxLabel: string;
}

/** 見積書 / 注文書: the estimate fields of a quotation or purchase order. */
export interface TradeEstimateRenderData {
  issuer: PrintIssuer;
  recipient: Addressee;
  document: {
    number: string;
    date: string;
    docstatus: number;
    /** 見積書: 有効期限. */
    validUntil: string | null;
    /** 注文書: 希望納期. */
    requiredDate: string | null;
    note: string | null;
  };
  lines: TradePrintLine[];
  /** The stored taxSummary rows, `label` naming category and rate. */
  taxSummary: Array<{ category: string; rate: string; label: string; taxable: string; tax: string; gross: string }>;
  totals: { subtotal: string; taxTotal: string; total: string };
  locale: 'ja' | 'en';
}

/** 納品書: lines without tax amounts or rates (AC-12), totals per tax category added from the stored line amounts. */
export interface DeliveryNoteRenderData {
  issuer: PrintIssuer;
  recipient: Addressee;
  document: { number: string; date: string; docstatus: number; orderNumber: string | null; note: string | null };
  lines: TradePrintLine[];
  categoryTotals: Array<{ category: string; label: string; amount: string }>;
  total: string;
  locale: 'ja' | 'en';
}

export type QuotationHtmlRenderer = (data: TradeEstimateRenderData, tools: PrintTools) => string;
export type OrderHtmlRenderer = (data: TradeEstimateRenderData, tools: PrintTools) => string;
export type DeliveryNoteHtmlRenderer = (data: DeliveryNoteRenderData, tools: PrintTools) => string;

const L = {
  quotation: { ja: '見積書', en: 'Quotation' },
  order: { ja: '注文書', en: 'Purchase order' },
  deliveryNote: { ja: '納品書', en: 'Delivery note' },
  quotationNo: { ja: '見積番号', en: 'Quotation no.' },
  quotationDate: { ja: '見積日', en: 'Quotation date' },
  validUntil: { ja: '有効期限', en: 'Valid until' },
  orderNo: { ja: '注文番号', en: 'Order no.' },
  orderDate: { ja: '注文日', en: 'Order date' },
  requiredDate: { ja: '希望納期', en: 'Required date' },
  deliveryNo: { ja: '納品番号', en: 'Delivery no.' },
  deliveryDate: { ja: '納品日', en: 'Delivery date' },
  salesOrderNo: { ja: '受注番号', en: 'Sales order no.' },
  quotationTotal: { ja: '御見積金額（税込）', en: 'Quotation total (incl. tax)' },
  orderTotal: { ja: 'ご注文金額（税込）', en: 'Order total (incl. tax)' },
  deliveryTotal: { ja: '納品金額（税抜）', en: 'Delivered amount (excl. tax)' },
  quotationLead: { ja: '下記のとおり御見積申し上げます。', en: 'We are pleased to quote as follows.' },
  orderLead: { ja: '下記のとおり注文いたします。', en: 'Please supply the following.' },
  deliveryLead: { ja: '下記のとおり納品いたしました。', en: 'We have delivered the following.' },
  byRate: { ja: '税率ごとの内訳', en: 'Breakdown by tax rate' },
  subtotal: { ja: '税抜合計', en: 'Subtotal' },
  taxTotal: { ja: '消費税額', en: 'Tax' },
  total: { ja: '合計（税込）', en: 'Total (incl. tax)' },
  byCategory: { ja: '税区分ごとの税抜合計', en: 'Net totals by tax category' },
  category: { ja: '税区分', en: 'Tax category' },
  net: { ja: '税抜金額', en: 'Amount (excl. tax)' },
  grandTotal: { ja: '合計', en: 'Total' },
  taxOnInvoice: { ja: '消費税額は請求書に記載します', en: 'Consumption tax is stated on the invoice' },
  note: { ja: '備考', en: 'Remarks' },
  draftNo: { ja: '（未採番）', en: '(not numbered)' },
  noLines: { ja: '明細なし', en: 'No lines' },
} satisfies Record<string, Label>;

function hasReduced(lines: readonly TradePrintLine[]): boolean {
  return lines.some((l) => l.taxCategory === 'reduced');
}

function printLines(lines: readonly TradePrintLine[], tools: PrintTools): string {
  return lineTable(
    lines.map((l) => ({
      seq: l.seq,
      description: l.description,
      quantity: l.quantity,
      ...(l.uomCode ? { uomCode: l.uomCode } : {}),
      unitPrice: l.unitPrice,
      amount: l.amount,
      taxLabel: l.taxLabel,
      reduced: l.taxCategory === 'reduced',
    })),
    tools.locale,
    { empty: tools.t(L.noLines) },
  );
}

function estimateHtml(
  d: TradeEstimateRenderData,
  tools: PrintTools,
  kind: 'quotation' | 'order',
  issuerOpts: { registrationNo: boolean },
): string {
  const t = tools.t;
  const doc = d.document;
  const quotation = kind === 'quotation';
  const meta: Array<readonly [string, string]> = [
    [t(quotation ? L.quotationNo : L.orderNo), doc.number || t(L.draftNo)],
    [t(quotation ? L.quotationDate : L.orderDate), tools.date(doc.date)],
  ];
  if (quotation && doc.validUntil) meta.push([t(L.validUntil), tools.date(doc.validUntil)]);
  if (!quotation && doc.requiredDate) meta.push([t(L.requiredDate), tools.date(doc.requiredDate)]);
  const body = [
    documentHeader(t(quotation ? L.quotation : L.order), meta),
    partiesSection(addresseeBlock(d.recipient, d.locale), issuerBlock(d.issuer, d.locale, issuerOpts)),
    noteLine(t(quotation ? L.quotationLead : L.orderLead), 'lead'),
    amountBlock(t(quotation ? L.quotationTotal : L.orderTotal), d.totals.total, d.locale),
    printLines(d.lines, tools),
    hasReduced(d.lines) ? reducedLegend(d.locale) : '',
    taxBreakdownTable(d.taxSummary, d.locale, { caption: t(L.byRate) }),
    totalsTable([
      { label: t(L.subtotal), value: d.totals.subtotal },
      { label: t(L.taxTotal), value: d.totals.taxTotal },
      { label: t(L.total), value: d.totals.total, strong: true },
    ]),
    remarksSection(t(L.note), doc.note),
  ].filter(Boolean);
  return printDocument({
    title: `${t(quotation ? L.quotation : L.order)} ${doc.number}`.trim(),
    locale: d.locale,
    body: body.join('\n'),
    className: quotation ? 'quotation' : 'purchase-order',
  });
}

/** 見積書 (AC-10): issuer with the registration number (the company sells). */
export const defaultQuotationHtml: QuotationHtmlRenderer = (d, tools) =>
  estimateHtml(d, tools, 'quotation', { registrationNo: true });

/** 注文書 (AC-11): the company buys, so its registration number is left out (D-3). */
export const defaultOrderHtml: OrderHtmlRenderer = (d, tools) =>
  estimateHtml(d, tools, 'order', { registrationNo: false });

/** 納品書 (AC-12): no tax amount, no rate %, no warehouse; per-category net totals and the 「請求書に記載」 note. */
export const defaultDeliveryNoteHtml: DeliveryNoteHtmlRenderer = (d, tools) => {
  const t = tools.t;
  const doc = d.document;
  const meta: Array<readonly [string, string]> = [
    [t(L.deliveryNo), doc.number || t(L.draftNo)],
    [t(L.deliveryDate), tools.date(doc.date)],
  ];
  if (doc.orderNumber) meta.push([t(L.salesOrderNo), doc.orderNumber]);
  const body = [
    documentHeader(t(L.deliveryNote), meta),
    partiesSection(addresseeBlock(d.recipient, d.locale), issuerBlock(d.issuer, d.locale)),
    noteLine(t(L.deliveryLead), 'lead'),
    amountBlock(t(L.deliveryTotal), d.total, d.locale),
    printLines(d.lines, tools),
    hasReduced(d.lines) ? reducedLegend(d.locale) : '',
    dataTable(
      [{ label: t(L.category) }, { label: t(L.net), align: 'right' }],
      d.categoryTotals.map((c) => [c.label, formatMoney(c.amount)]),
      { className: 'category-totals', caption: t(L.byCategory), foot: [t(L.grandTotal), formatMoney(d.total)] },
    ),
    noteLine(t(L.taxOnInvoice)),
    remarksSection(t(L.note), doc.note),
  ].filter(Boolean);
  return printDocument({
    title: `${t(L.deliveryNote)} ${doc.number}`.trim(),
    locale: d.locale,
    body: body.join('\n'),
    className: 'delivery-note',
  });
};
