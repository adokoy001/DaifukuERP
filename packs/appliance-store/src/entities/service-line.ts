import { defineEntity, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@daifuku/mod-tax';

export const ApplianceServiceLine = defineEntity({
  name: 'appliance_store_service_line',
  label: label('作業・部品明細', 'Labour / parts line'),
  fields: {
    serviceId: f.ref('appliance_store_service', {
      label: label('受付', 'Service job'),
      required: true,
      onDelete: 'cascade',
    }),
    seq: f.int({ label: label('行', 'Seq'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', { label: label('作業・部品', 'Service / part'), required: true }),
    description: f.text({ label: label('作業・品名', 'Description'), required: true, maxLength: 200 }),
    quantity: f.quantity({ label: label('数量', 'Quantity'), required: true, default: '1', min: '0.000001' }),
    unitPrice: f.money({ label: label('税抜単価', 'Unit price excluding tax'), required: true, min: '0' }),
    taxCategory: f.enum(TAX_CATEGORIES, {
      label: label('税区分', 'Tax category'),
      required: true,
      default: 'standard',
      labels: TAX_CATEGORY_LABELS,
    }),
    amount: f.money({
      label: label('税抜金額', 'Amount excluding tax'),
      required: true,
      default: '0',
      serverOwned: true,
    }),
  },
  indexes: [['serviceId', 'seq']],
  permissions: { roles: { sales: ['read', 'create', 'update', 'delete'], accounting: ['read'], viewer: ['read'] } },
  views: { list: ['seq', 'productId', 'description', 'quantity', 'unitPrice', 'taxCategory', 'amount'] },
});
