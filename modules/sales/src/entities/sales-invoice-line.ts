// Sales invoice line (spec AC-1). Ordinary entity declared as a line of sales_invoice; hooks/lines.ts fills
// description/unitPrice/taxCategory from the product, keeps `amount = quantity × unitPrice` (unrounded, ADR-0010),
// freezes lines once the invoice is submitted and triggers the header recalculation.
// `delete` is granted to sales because the kernel's replace-all line save removes dropped rows through repo.delete.
import { defineEntity, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@daifuku/mod-tax';

export const SalesInvoiceLine = defineEntity({
  name: 'sales_invoice_line',
  label: label('売上請求書明細', 'Sales invoice line'),
  fields: {
    uomId: f.ref('uom', { label: label('単位', 'Unit of measure') }),
    uomCode: f.text({ label: label('取引時単位', 'Transaction unit'), serverOwned: true }),
    invoiceId: f.ref('sales_invoice', { label: label('請求書', 'Invoice'), required: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', { label: label('品目', 'Product') }),
    description: f.text({
      label: label('品名・摘要', 'Description'),
      description: label('省略時は品目名', 'defaults to the product name'),
      required: true,
      maxLength: 200,
    }),
    quantity: f.quantity({ label: label('数量', 'Quantity'), required: true, default: '1' }),
    unitPrice: f.money({
      label: label('単価', 'Unit price'),
      description: label('省略時は品目の販売単価', "defaults to the product's sale price"),
      required: true,
    }),
    taxCategory: f.enum(TAX_CATEGORIES, {
      label: label('税区分', 'Tax category'),
      description: label('省略時は品目の税区分', "defaults to the product's tax category"),
      required: true,
      labels: TAX_CATEGORY_LABELS,
    }),
    amount: f.money({
      serverOwned: true,
      label: label('金額', 'Amount'),
      description: label('数量 × 単価（丸めなし）', 'quantity × unit price, unrounded'),
      required: true,
      default: '0',
    }),
  },
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'productId', 'description', 'quantity', 'unitPrice', 'taxCategory', 'amount'] },
});

export type SalesInvoiceLineDef = typeof SalesInvoiceLine;
