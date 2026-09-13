import { defineEntity, f, label } from '@daifuku/kernel';

export const RestaurantClosingLine = defineEntity({
  name: 'restaurant_chain_closing_line',
  label: label('メニュー販売数', 'Menu sales'),
  fields: {
    closingId: f.ref('restaurant_chain_closing', {
      label: label('日次締め', 'Daily closing'),
      required: true,
      onDelete: 'cascade',
    }),
    seq: f.int({ label: label('順番', 'Sequence'), required: true, default: 1, min: 1 }),
    recipeId: f.ref('restaurant_chain_recipe', { label: label('確定レシピ', 'Submitted recipe'), required: true }),
    serviceMode: f.enum(['dine_in', 'takeaway'], {
      label: label('提供方法', 'Service mode'),
      required: true,
      default: 'dine_in',
      labels: { dine_in: label('店内飲食', 'Dine in'), takeaway: label('持帰り', 'Takeaway') },
    }),
    quantity: f.quantity({ label: label('販売数', 'Servings sold'), required: true, default: '1', min: '0.000001' }),
    unitPrice: f.money({
      label: label('税込単価', 'Price incl. tax'),
      min: '0',
      description: label('空欄ならレシピの標準単価', 'Defaults to the recipe price'),
    }),
    description: f.text({ label: label('メニュー名', 'Menu name'), serverOwned: true }),
    taxCategory: f.enum(['standard', 'reduced'], {
      label: label('税区分', 'Tax category'),
      serverOwned: true,
      labels: { standard: label('標準', 'Standard'), reduced: label('軽減', 'Reduced') },
    }),
    amount: f.money({ label: label('税込金額', 'Gross amount'), serverOwned: true, required: true, default: '0' }),
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
  views: { list: ['seq', 'recipeId', 'serviceMode', 'quantity', 'unitPrice', 'taxCategory', 'amount'] },
});
