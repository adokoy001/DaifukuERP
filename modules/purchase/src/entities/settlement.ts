// Append-only, effective-dated settlement facts. Written only by the owning invoice operation.
import { defineEntity, f, label } from '@daifuku/kernel';
export const PurchaseSettlement = defineEntity({
  name: 'purchase_settlement',
  label: label('消込履歴', 'Settlement history'),
  fields: {
    invoiceId: f.ref('purchase_invoice', {
      label: label('請求書', 'Invoice'),
      required: true,
      immutable: true,
      serverOwned: true,
    }),
    date: f.date({ label: label('有効日', 'Effective date'), required: true, immutable: true, serverOwned: true }),
    amount: f.money({
      label: label('消込額（取消は負）', 'Applied amount (negative to reverse)'),
      required: true,
      immutable: true,
      serverOwned: true,
    }),
  },
  indexes: [['invoiceId', 'date']],
  permissions: { roles: { purchasing: ['read', 'create'], accounting: ['read', 'create'], viewer: ['read'] } },
  views: { list: ['invoiceId', 'date', 'amount'] },
});
