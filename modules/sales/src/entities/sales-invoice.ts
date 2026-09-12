// Sales invoice header (spec AC-1). Totals, taxSummary, balance, status and journalEntryId are system-owned:
// hooks/recalc.ts derives them while the invoice is a draft, hooks/submit.ts fixes them at submit, and only
// paidAmount/balance/status/journalEntryId may change afterwards (allowOnSubmit; written by applyPayment / cancel).
import { defineDocument, f, label } from '@daifuku/kernel';
import type { InvoiceRenderData } from '../services/render-html.ts';
import type { TaxCategory } from '@daifuku/mod-tax';

export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** One row of `taxSummary`: a tax-module group (税率ごとの区分) as JSON — money and rate as decimal strings. */
export interface InvoiceTaxSummaryRow {
  category: TaxCategory;
  code: string;
  label: string;
  /** e.g. '0.1' */
  rate: string;
  taxable: string;
  tax: string;
  gross: string;
  lineCount: number;
}

export const SalesInvoice = defineDocument({
  name: 'sales_invoice',
  label: label('売上請求書', 'Sales invoice'),
  naming: { type: 'sequence', prefix: 'INV-', period: 'year' },
  fields: {
    cancelledDate: f.date({ label: label('取消有効日', 'Cancellation effective date'), serverOwned: true, hidden: true }),
    issuedSnapshot: f.json<InvoiceRenderData>({ label: label('発行時データ', 'Issued invoice snapshot'), serverOwned: true, hidden: true }),
    controlAccountId: f.ref('account', { label: label('統制勘定', 'Control account at posting'), serverOwned: true }),
    settlementHistory: f.bool({ label: label('消込履歴あり', 'Settlement history available'), serverOwned: true, hidden: true, required: true, default: false }),
    currency: f.enum(['JPY'], { label: label('通貨', 'Currency'), required: true, default: 'JPY', immutable: true }),
    partnerId: f.ref('partner', { label: label('得意先', 'Customer'), required: true, index: true }),
    date: f.date({ label: label('請求日', 'Invoice date'), required: true, default: 'today', index: true }),
    dueDate: f.date({
      label: label('支払期日', 'Due date'),
      description: label('空欄なら取引先の締め日・支払月・支払日から計算', "Computed from the partner's closing day / payment terms when empty"),
      index: true,
    }),
    priceIncludesTax: f.bool({
      label: label('税込入力', 'Prices include tax'),
      description: label('省略時は会社設定 tax.price_includes_tax', 'Defaults to the company setting tax.price_includes_tax'),
      required: true,
      default: false,
    }),
    subtotal: f.money({ serverOwned: true, label: label('税抜合計', 'Subtotal'), description: label('明細から自動計算', 'computed from the lines'), required: true, default: '0' }),
    taxTotal: f.money({ serverOwned: true, label: label('消費税額', 'Tax'), description: label('税率ごとに1回丸め', 'rounded once per rate'), required: true, default: '0' }),
    total: f.money({ serverOwned: true, label: label('税込合計', 'Total'), required: true, default: '0' }),
    paidAmount: f.money({ serverOwned: true, label: label('入金済額', 'Paid amount'), required: true, default: '0', min: '0' }),
    balance: f.money({ serverOwned: true, label: label('残高', 'Balance'), description: label('税込合計 − 入金済額', 'total − paidAmount'), required: true, default: '0' }),
    status: f.enum(INVOICE_STATUSES, { serverOwned: true,
      label: label('状態', 'Status'),
      required: true,
      default: 'draft',
      labels: {
        draft: label('下書き', 'Draft'),
        open: label('未入金', 'Open'),
        paid: label('入金済', 'Paid'),
        cancelled: label('取消', 'Cancelled'),
      },
    }),
    // No DSL default: kernel applyDefault() renders a json default as a bound parameter, which drizzle-kit rejects when
    // building the schema ("we don't support params for sql default values"). hooks/recalc.ts always sets it.
    taxSummary: f.json<InvoiceTaxSummaryRow[]>({ serverOwned: true, label: label('税率別内訳', 'Tax summary'), description: label('税率ごとの対価の額・消費税額', 'per-rate taxable / tax / gross'), required: true }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
    journalEntryId: f.ref('journal_entry', { serverOwned: true, label: label('仕訳', 'Journal entry'), description: label('submit 時に転記', 'posted at submit') }),
  },
  allowOnSubmit: ['issuedSnapshot', 'settlementHistory', 'paidAmount', 'balance', 'status', 'journalEntryId'],
  lines: [{ entity: 'sales_invoice_line', parentField: 'invoiceId' }],
  indexes: [['status', 'dueDate']],
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'submit', 'cancel', 'amend'],
      accounting: ['read', 'update'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['partnerId', 'date', 'dueDate', 'total', 'balance', 'status'],
    search: ['note'],
    form: [
      ['partnerId', 'date', 'dueDate', 'priceIncludesTax'],
      ['subtotal', 'taxTotal', 'total'],
      ['paidAmount', 'balance', 'status'],
      ['note', 'journalEntryId'],
    ],
  },
});

export type SalesInvoiceDef = typeof SalesInvoice;
