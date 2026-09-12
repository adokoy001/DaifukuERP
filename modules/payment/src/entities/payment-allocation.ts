// Payment allocation line (消込明細, spec AC-1): `amount` of the parent payment applied to one invoice. `invoiceId` is a
// plain uuid because it targets one of two entities (`invoiceEntity` says which); existence, visibility, state,
// partner and balance are checked through the sales/purchase repositories in hooks/lines.ts (draft) and
// hooks/submit.ts (submit). `delete` is granted to the operating roles because the kernel's replace-all line save
// removes dropped rows through repo.delete. Lines are frozen once the payment leaves draft (hooks/lines.ts).
import { defineEntity, f, label } from '@daifuku/kernel';

export const INVOICE_ENTITIES = ['sales_invoice', 'purchase_invoice'] as const;
export type InvoiceEntity = (typeof INVOICE_ENTITIES)[number];

export const PaymentAllocation = defineEntity({
  name: 'payment_allocation',
  label: label('消込明細', 'Payment allocation'),
  fields: {
    paymentId: f.ref('payment', { label: label('入出金', 'Payment'), required: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    invoiceEntity: f.enum(INVOICE_ENTITIES, {
      label: label('請求書種別', 'Invoice entity'),
      description: label('入金は sales_invoice、支払は purchase_invoice', 'receive -> sales_invoice, pay -> purchase_invoice'),
      required: true,
      labels: { sales_invoice: label('売上請求書', 'Sales invoice'), purchase_invoice: label('仕入請求書', 'Purchase invoice') },
    }),
    invoiceId: f.uuid({ label: label('請求書', 'Invoice'), required: true, index: true }),
    amount: f.money({ label: label('消込額', 'Amount'), description: label('0 より大きく、請求書残高以下', '> 0 and <= the invoice balance'), required: true }),
  },
  indexes: [['paymentId', 'seq']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete'],
      sales: ['read', 'create', 'update', 'delete'],
      purchasing: ['read', 'create', 'update', 'delete'],
      viewer: ['read'],
    },
    rowRules: [
      { roles: ['sales'], where: { invoiceEntity: 'sales_invoice' } },
      { roles: ['purchasing'], where: { invoiceEntity: 'purchase_invoice' } },
    ],
  },
  views: { list: ['seq', 'invoiceEntity', 'invoiceId', 'amount'] },
});

export type PaymentAllocationDef = typeof PaymentAllocation;
