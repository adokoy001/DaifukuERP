// 仕入・経費請求書 (docs/specs/purchase.md AC-1): the bill received from a supplier. Amount fields are computed by
// hooks/recalc.ts on every draft save; `status`/`paidAmount`/`balance`/`journalEntryId` are the only fields that move
// after submit (posting, payments, cancel). Numbering BILL-<year>-<n> at submit (ADR-0006).
import { defineDocument, f, label } from '@daifuku/kernel';
import { SUPPLIER_TAX_STATUSES } from '../services/credit-ratio.ts';

export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PurchaseInvoice = defineDocument({
  name: 'purchase_invoice',
  label: label('仕入請求書', 'Purchase invoice'),
  naming: { type: 'sequence', prefix: 'BILL-', period: 'year' },
  fields: {
    cancelledDate: f.date({
      label: label('取消有効日', 'Cancellation effective date'),
      serverOwned: true,
      hidden: true,
    }),
    controlAccountId: f.ref('account', { label: label('統制勘定', 'Control account at posting'), serverOwned: true }),
    settlementHistory: f.bool({
      label: label('消込履歴あり', 'Settlement history available'),
      serverOwned: true,
      hidden: true,
      required: true,
      default: false,
    }),
    currency: f.enum(['JPY'], { label: label('通貨', 'Currency'), required: true, default: 'JPY', immutable: true }),
    partnerId: f.ref('partner', { label: label('仕入先', 'Supplier'), required: true, index: true }),
    date: f.date({ label: label('日付', 'Date'), required: true, default: 'today', index: true }),
    supplierInvoiceNo: f.text({ label: label('先方請求書番号', 'Supplier invoice no.'), maxLength: 50 }),
    dueDate: f.date({
      label: label('支払期日', 'Due date'),
      description: label('空欄なら仕入先の締め日・支払サイトから計算', 'Computed from the supplier terms when empty'),
      index: true,
    }),
    priceIncludesTax: f.bool({
      label: label('税込入力', 'Prices include tax'),
      description: label('受領請求書は税込が多いので既定 true', 'Received bills are usually tax-inclusive'),
      required: true,
      default: true,
    }),
    subtotal: f.money({ serverOwned: true, label: label('税抜合計', 'Subtotal'), required: true, default: '0' }),
    taxTotal: f.money({ serverOwned: true, label: label('消費税', 'Tax'), required: true, default: '0' }),
    deductibleTax: f.money({
      serverOwned: true,
      label: label('控除対象仕入税額', 'Deductible tax'),
      required: true,
      default: '0',
    }),
    nonDeductibleTax: f.money({
      serverOwned: true,
      label: label('控除対象外消費税', 'Non-deductible tax'),
      required: true,
      default: '0',
    }),
    total: f.money({ serverOwned: true, label: label('税込合計', 'Total'), required: true, default: '0' }),
    paidAmount: f.money({ serverOwned: true, label: label('支払済額', 'Paid amount'), required: true, default: '0' }),
    balance: f.money({ serverOwned: true, label: label('残高', 'Balance'), required: true, default: '0' }),
    status: f.enum(INVOICE_STATUSES, {
      serverOwned: true,
      label: label('状態', 'Status'),
      required: true,
      default: 'draft',
      index: true,
      labels: {
        draft: label('下書き', 'Draft'),
        open: label('未払', 'Open'),
        paid: label('支払済', 'Paid'),
        cancelled: label('取消', 'Cancelled'),
      },
    }),
    supplierTaxStatus: f.enum(SUPPLIER_TAX_STATUSES, {
      serverOwned: true,
      label: label('仕入先の課税区分', 'Supplier tax status'),
      description: label('検証時に仕入先マスタから複写', 'Copied from the partner at validate'),
      required: true,
      default: 'registered',
      labels: { registered: label('課税事業者', 'Registered'), exempt: label('免税事業者', 'Exempt') },
    }),
    creditRatio: f.decimal({
      serverOwned: true,
      label: label('控除率', 'Credit ratio'),
      description: label(
        '課税事業者 1、免税事業者は経過措置の率',
        '1 for registered suppliers; the transitional ratio for exempt ones',
      ),
      required: true,
      default: '1',
      scale: 4,
      min: '0',
    }),
    taxSummary: f.json({ serverOwned: true, label: label('税率別集計', 'Tax summary') }),
    note: f.text({ label: label('備考', 'Note'), multiline: true }),
    journalEntryId: f.ref('journal_entry', { serverOwned: true, label: label('仕訳', 'Journal entry') }),
  },
  displayField: 'supplierInvoiceNo',
  allowOnSubmit: ['settlementHistory', 'paidAmount', 'balance', 'status', 'journalEntryId'],
  lines: [{ entity: 'purchase_invoice_line', parentField: 'invoiceId' }],
  indexes: [['status', 'dueDate']],
  permissions: {
    roles: {
      purchasing: ['read', 'create', 'update', 'submit', 'cancel', 'amend'],
      accounting: ['read', 'update'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['date', 'partnerId', 'supplierInvoiceNo', 'total', 'balance', 'status', 'dueDate'],
    search: ['supplierInvoiceNo', 'note'],
    form: [
      ['partnerId', 'date', 'supplierInvoiceNo', 'dueDate'],
      ['priceIncludesTax', 'supplierTaxStatus', 'creditRatio'],
      ['subtotal', 'taxTotal', 'deductibleTax', 'nonDeductibleTax', 'total'],
      ['status', 'paidAmount', 'balance', 'journalEntryId'],
      ['note'],
    ],
  },
});

export type PurchaseInvoiceDef = typeof PurchaseInvoice;
