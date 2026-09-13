import { defineEntity, f, label } from '@daifuku/kernel';

export const RestaurantWasteLine = defineEntity({
  name: 'restaurant_chain_waste_line',
  label: label('材料廃棄', 'Ingredient waste'),
  fields: {
    closingId: f.ref('restaurant_chain_closing', {
      label: label('日次締め', 'Daily closing'),
      required: true,
      onDelete: 'cascade',
    }),
    seq: f.int({ label: label('順番', 'Sequence'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', { label: label('廃棄材料', 'Ingredient'), required: true }),
    quantity: f.quantity({ label: label('基準単位数量', 'Quantity in base units'), required: true, min: '0.000001' }),
    reason: f.enum(['spoilage', 'preparation', 'other'], {
      label: label('理由', 'Reason'),
      required: true,
      default: 'spoilage',
      labels: {
        spoilage: label('期限・品質', 'Spoilage'),
        preparation: label('調理ロス', 'Preparation loss'),
        other: label('その他', 'Other'),
      },
    }),
    note: f.text({ label: label('詳細', 'Details'), maxLength: 200 }),
  },
  storeAccess: { kind: 'parent', field: 'closingId', entity: 'restaurant_chain_closing' },
  permissions: {
    roles: {
      chain_staff: ['read', 'export', 'create', 'update', 'delete'],
      chain_manager: ['read', 'export', 'create', 'update', 'delete'],
      sales: ['read', 'export', 'create', 'update', 'delete'],
      inventory: ['read', 'export'],
      accounting: ['read', 'export'],
      viewer: ['read', 'export'],
    },
  },
  views: { list: ['seq', 'productId', 'quantity', 'reason', 'note'] },
});
