// 仕入請求書明細 (docs/specs/purchase.md AC-1). A line is either a product line (productId; posted to the purchases
// account) or an expense line (accountId; posted to that account). `taxCategory` defaults from the product or the
// account's taxCategoryDefault and `amount` = quantity × unitPrice (hooks/lines.ts). Frozen once the bill leaves draft.
import { defineEntity, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@daifuku/mod-tax';

export const PurchaseInvoiceLine = defineEntity({
  name: 'purchase_invoice_line',
  label: label('仕入請求書明細', 'Purchase invoice line'),
  fields: {
    uomId: f.ref('uom', { label: label('単位', 'Unit of measure') }),
    uomCode: f.text({ label: label('取引時単位', 'Transaction unit'), serverOwned: true }),
    invoiceId: f.ref('purchase_invoice', { label: label('仕入請求書', 'Purchase invoice'), required: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', { label: label('品目', 'Product') }),
    accountId: f.ref('account', { label: label('勘定科目', 'Account'), description: label('経費行に指定。品目行は設定 purchase.accounts の仕入科目', 'For expense lines; product lines use the purchases account setting') }),
    description: f.text({ label: label('摘要', 'Description'), required: true, maxLength: 200 }),
    quantity: f.quantity({ label: label('数量', 'Quantity'), required: true, default: '1' }),
    unitPrice: f.money({ label: label('単価', 'Unit price'), required: true }),
    taxCategory: f.enum(TAX_CATEGORIES, { label: label('税区分', 'Tax category'), required: true, labels: TAX_CATEGORY_LABELS }),
    amount: f.money({ serverOwned: true, label: label('金額', 'Amount'), description: label('数量 × 単価（自動計算）', 'quantity × unit price, computed'), required: true, default: '0' }),
  },
  displayField: 'description',
  indexes: [['invoiceId', 'seq']],
  permissions: {
    roles: {
      purchasing: ['read', 'create', 'update', 'delete'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'description', 'productId', 'accountId', 'quantity', 'unitPrice', 'taxCategory', 'amount'] },
});

export type PurchaseInvoiceLineDef = typeof PurchaseInvoiceLine;
