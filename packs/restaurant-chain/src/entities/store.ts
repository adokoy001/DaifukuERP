import { defineEntity, f, label } from '@daifuku/kernel';

export const RestaurantStore = defineEntity({
  name: 'restaurant_chain_store',
  label: label('店舗・厨房', 'Restaurant stores'),
  fields: {
    code: f.text({ label: label('店舗コード', 'Store code'), required: true, immutable: true, unique: true, maxLength: 30 }),
    name: f.text({ label: label('店舗名', 'Store name'), required: true, maxLength: 100 }),
    warehouseId: f.ref('warehouse', { label: label('厨房倉庫', 'Kitchen warehouse'), required: true, immutable: true, unique: true }),
    partnerId: f.ref('partner', { label: label('店頭客', 'Walk-in customer'), required: true, immutable: true }),
    cashAccountId: f.ref('account', { label: label('現金勘定', 'Cash account'), required: true, immutable: true }),
    isActive: f.bool({ label: label('営業中', 'Active'), required: true, default: true }),
  },
  displayField: 'name',
  storeAccess: { kind: 'store', field: 'id' },
  permissions: { roles: { chain_staff: ['read', 'export'], chain_manager: ['read', 'export'], inventory: ['read', 'export', 'create', 'update'], sales: ['read', 'export'], accounting: ['read', 'export'], viewer: ['read', 'export'] } },
  views: { list: ['code', 'name', 'warehouseId', 'isActive'], search: ['code', 'name'], form: [['code', 'name'], ['warehouseId', 'partnerId', 'cashAccountId'], ['isActive']] },
});
