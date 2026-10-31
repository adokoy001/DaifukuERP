// Default layouts of 領収書 (receipt) and 支払通知書 (payment notice) (docs/specs/print-templates.md AC-13, AC-14, AC-18).
// Pure: PaymentDocumentRenderData + PrintTools -> a complete HTML document. The amounts are the payment's stored values
// and its allocation lines (AC-7). The receipt shows the issuer's registration number when stored (国税庁 タックスアンサー
// No.6625; docs/domain/japan-tax.md#インボイス制度) and prints no tax breakdown, revenue-stamp box or stamp-duty note:
// those items are not confirmed from a 国税庁 primary source (spec open question 1). The payment notice leaves the
// company's registration number out (D-3). Replaceable at payment.receipt_html / payment.payment_notice_html.
import { Decimal, type Label } from '@daifuku/kernel';
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
  type Addressee,
  type PrintIssuer,
  type PrintTools,
} from '@daifuku/mod-print-layout';
import type { PaymentMethod } from '../entities/payment.ts';

export interface PaymentDocumentRenderData {
  issuer: PrintIssuer;
  recipient: Addressee;
  payment: {
    number: string;
    date: string;
    amount: string;
    method: PaymentMethod;
    /** 未消込額 (前受金 / 前払金). */
    unallocated: string;
    docstatus: number;
    note: string | null;
  };
  /** Allocation lines in seq order; `invoiceDate` / `supplierInvoiceNo` come from the allocated invoice. */
  allocations: Array<{ invoiceNumber: string; invoiceDate: string; supplierInvoiceNo: string | null; amount: string }>;
  locale: 'ja' | 'en';
}
export type PaymentDocumentHtmlRenderer = (data: PaymentDocumentRenderData, tools: PrintTools) => string;

const METHOD: Record<PaymentMethod, Label> = {
  cash: { ja: '現金', en: 'Cash' },
  bank_transfer: { ja: '振込', en: 'Bank transfer' },
  other: { ja: 'その他', en: 'Other' },
};

const L = {
  receipt: { ja: '領収書', en: 'Receipt' },
  notice: { ja: '支払通知書', en: 'Payment notice' },
  number: { ja: '番号', en: 'No.' },
  receiptDate: { ja: '領収日', en: 'Date received' },
  payDate: { ja: '支払日', en: 'Payment date' },
  received: { ja: '領収金額', en: 'Amount received' },
  paid: { ja: '支払金額', en: 'Amount paid' },
  receivedMethod: { ja: '受領方法', en: 'Received by' },
  payMethod: { ja: '支払方法', en: 'Paid by' },
  receiptLead: { ja: '上記の金額を正に領収いたしました。', en: 'We acknowledge receipt of the amount above.' },
  noticeLead: {
    ja: '下記のとおりお支払いいたしましたのでご通知いたします。',
    en: 'We notify you of the following payment.',
  },
  breakdown: { ja: '内訳', en: 'Breakdown' },
  invoiceNo: { ja: '請求書番号', en: 'Invoice no.' },
  supplierInvoiceNo: { ja: '貴社請求書番号', en: 'Your invoice no.' },
  invoiceDate: { ja: '請求日', en: 'Invoice date' },
  appliedReceipt: { ja: '領収額', en: 'Amount applied' },
  appliedPaid: { ja: '支払額', en: 'Amount paid' },
  advanceReceived: { ja: '前受金（未消込）', en: 'Advance received (unallocated)' },
  advancePaid: { ja: '前払金（未消込）', en: 'Advance paid (unallocated)' },
  total: { ja: '合計', en: 'Total' },
  note: { ja: '備考', en: 'Remarks' },
  noAllocations: { ja: '請求書への消込はありません', en: 'Not applied to any invoice' },
} satisfies Record<string, Label>;

function breakdownTable(d: PaymentDocumentRenderData, tools: PrintTools, receipt: boolean): string {
  const t = tools.t;
  const rows = d.allocations.map((a) =>
    receipt
      ? [a.invoiceNumber, tools.date(a.invoiceDate), formatMoney(a.amount)]
      : [a.invoiceNumber, a.supplierInvoiceNo ?? '—', tools.date(a.invoiceDate), formatMoney(a.amount)],
  );
  const blanks = receipt ? [''] : ['', ''];
  if (rows.length === 0) rows.push([t(L.noAllocations), ...blanks, '—']);
  const unallocated = d.payment.unallocated;
  if (Decimal.isDecimalString(unallocated) && Decimal.from(unallocated).gt('0'))
    rows.push([t(receipt ? L.advanceReceived : L.advancePaid), ...blanks, formatMoney(unallocated)]);
  return dataTable(
    [
      { label: t(L.invoiceNo) },
      ...(receipt ? [] : [{ label: t(L.supplierInvoiceNo) }]),
      { label: t(L.invoiceDate) },
      { label: t(receipt ? L.appliedReceipt : L.appliedPaid), align: 'right' as const },
    ],
    rows,
    {
      className: 'allocations',
      caption: t(L.breakdown),
      foot: [t(L.total), ...blanks, formatMoney(d.payment.amount)],
    },
  );
}

function paymentHtml(d: PaymentDocumentRenderData, tools: PrintTools, receipt: boolean): string {
  const t = tools.t;
  const p = d.payment;
  const meta: Array<readonly [string, string]> = [
    [t(L.number), p.number],
    [t(receipt ? L.receiptDate : L.payDate), tools.date(p.date)],
    [t(receipt ? L.receivedMethod : L.payMethod), t(METHOD[p.method])],
  ];
  const body = [
    documentHeader(t(receipt ? L.receipt : L.notice), meta),
    partiesSection(addresseeBlock(d.recipient, d.locale), issuerBlock(d.issuer, d.locale, { registrationNo: receipt })),
    amountBlock(t(receipt ? L.received : L.paid), p.amount, d.locale),
    noteLine(t(receipt ? L.receiptLead : L.noticeLead), 'lead'),
    breakdownTable(d, tools, receipt),
    remarksSection(t(L.note), p.note),
  ].filter(Boolean);
  return printDocument({
    title: `${t(receipt ? L.receipt : L.notice)} ${p.number}`.trim(),
    locale: d.locale,
    body: body.join('\n'),
    className: receipt ? 'receipt' : 'payment-notice',
  });
}

/** 領収書 (AC-13). */
export const defaultReceiptHtml: PaymentDocumentHtmlRenderer = (d, tools) => paymentHtml(d, tools, true);

/** 支払通知書 (AC-14). */
export const defaultPaymentNoticeHtml: PaymentDocumentHtmlRenderer = (d, tools) => paymentHtml(d, tools, false);
