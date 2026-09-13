import { defineDocument, f, label } from '@daifuku/kernel';
export const RestaurantDayPlan = defineDocument({
  name: 'restaurant_chain_day_plan',
  label: label('店舗営業予定・目標', 'Store daily plans'),
  naming: { type: 'sequence', prefix: 'RPLAN-', period: 'year' },
  fields: {
    storeId: f.ref('restaurant_chain_store', { label: label('店舗', 'Store'), required: true, immutable: true }),
    date: f.date({ label: label('営業日', 'Business date'), required: true, default: 'today', index: true }),
    expectedOpen: f.bool({ label: label('営業予定', 'Expected open'), required: true, default: true }),
    grossSalesTarget: f.money({
      label: label('税込売上目標', 'Gross sales target'),
      required: true,
      default: '0',
      min: '0',
    }),
    note: f.text({ label: label('備考', 'Notes'), maxLength: 1000 }),
  },
  indexes: [['storeId', 'date']],
  storeAccess: { kind: 'store', field: 'storeId' },
  permissions: {
    roles: {
      inventory: ['read', 'export', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      sales: ['read', 'export', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      accounting: ['read', 'export'],
      viewer: ['read', 'export'],
      chain_staff: ['read', 'export'],
      chain_manager: ['read', 'export'],
    },
  },
  views: {
    list: ['storeId', 'date', 'expectedOpen', 'grossSalesTarget'],
    form: [['storeId', 'date'], ['expectedOpen', 'grossSalesTarget'], ['note']],
  },
});
