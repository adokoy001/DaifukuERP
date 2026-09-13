// レジ締め (docs/specs/pack-retail.md AC-2..AC-4): one register's day, entered as tax-inclusive lines plus the cash / card
// split. Totals and taxSummary are system-owned (hooks/recalc.ts, priceIncludesTax fixed to true); submitting it creates and
// submits the walk-in sales invoice and, for the cash part, a receipt (hooks/submit.ts), whose ids land in the
// allowOnSubmit refs. The refs make the kernel refuse cancelling the invoice/payment on their own while the closing is
// submitted (dependents check); cancelling the closing cancels the payment, then the invoice (hooks/cancel.ts).
// Entity names carry the pack prefix (docs/conventions/packs.md; the spec's `register_closing` was renamed before any
// migration existed). The document number keeps the spec's `REG-` prefix.
// Roles: `sales` runs the register (create/submit, including the invoice, receipt and stock issue it triggers). Cancelling
// cascades into payment.cancel, which only accounting holds, so a cancel needs admin or sales + accounting.
import { defineDocument, f, label } from '@daifuku/kernel';
import { Warehouse } from '@daifuku/mod-inventory';
import { Payment } from '@daifuku/mod-payment';
import { SalesInvoice, type InvoiceTaxSummaryRow } from '@daifuku/mod-sales';

export const RetailClosing = defineDocument({
  name: 'retail_closing',
  label: label('レジ締め', 'Register closing'),
  naming: { type: 'sequence', prefix: 'REG-', period: 'year' },
  fields: {
    date: f.date({ label: label('営業日', 'Business date'), required: true, default: 'today', index: true }),
    warehouseId: f.ref(Warehouse.name, {
      label: label('店舗倉庫', 'Store warehouse'),
      description: label(
        '省略時は既定の倉庫（在庫の自動出庫は既定の倉庫から）',
        'defaults to the default warehouse (auto issues come from it)',
      ),
      required: true,
    }),
    cashAmount: f.money({
      label: label('現金売上', 'Cash sales'),
      description: label('税込', 'tax included'),
      required: true,
      default: '0',
      min: '0',
    }),
    cardAmount: f.money({
      label: label('カード売上', 'Card sales'),
      description: label(
        '税込。売掛金として残り、カード会社の入金で消し込む',
        'tax included; stays receivable until the card company pays',
      ),
      required: true,
      default: '0',
      min: '0',
    }),
    subtotal: f.money({
      label: label('税抜合計', 'Subtotal'),
      description: label('明細から自動計算', 'computed from the lines'),
      required: true,
      default: '0',
    }),
    taxTotal: f.money({
      label: label('消費税額', 'Tax'),
      description: label('税率ごとに1回丸め', 'rounded once per rate'),
      required: true,
      default: '0',
    }),
    total: f.money({
      label: label('税込合計', 'Total'),
      description: label('現金 + カードと一致すること', 'must equal cash + card'),
      required: true,
      default: '0',
    }),
    // No DSL default for json (drizzle-kit rejects bound json defaults; see modules/sales). hooks/recalc.ts always sets it.
    taxSummary: f.json<InvoiceTaxSummaryRow[]>({
      label: label('税率別内訳', 'Tax summary'),
      description: label('税率ごとの対価の額・消費税額', 'per-rate taxable / tax / gross'),
    }),
    salesInvoiceId: f.ref(SalesInvoice.name, {
      label: label('売上請求書', 'Sales invoice'),
      description: label('submit 時に作成', 'created at submit'),
    }),
    paymentId: f.ref(Payment.name, {
      label: label('現金入金', 'Cash receipt'),
      description: label('submit 時に作成（現金 > 0 のとき）', 'created at submit when cash > 0'),
    }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  allowOnSubmit: ['salesInvoiceId', 'paymentId'],
  lines: [{ entity: 'retail_closing_line', parentField: 'closingId' }],
  indexes: [['date', 'warehouseId']],
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['date', 'warehouseId', 'total', 'cashAmount', 'cardAmount', 'salesInvoiceId'],
    search: ['note'],
    form: [
      ['date', 'warehouseId'],
      ['cashAmount', 'cardAmount'],
      ['subtotal', 'taxTotal', 'total'],
      ['salesInvoiceId', 'paymentId'],
      ['note'],
    ],
  },
});

export type RetailClosingDef = typeof RetailClosing;
