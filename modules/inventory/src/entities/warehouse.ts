// 倉庫 (docs/specs/inventory.md AC-1). `code` is what settings and the seed refer to (`inventory.default_warehouse`,
// default 'MAIN'); `isDefault` is the fallback when that code does not exist. At most one warehouse is the default
// (hooks/warehouse.ts clears the flag on the others). Ledger rows reference warehouses, so a used one cannot be deleted.
import { defineEntity, f, label } from '@daifuku/kernel';

export const Warehouse = defineEntity({
  name: 'warehouse',
  label: label('倉庫', 'Warehouse'),
  fields: {
    code: f.text({ label: label('倉庫コード', 'Code'), required: true, unique: true, maxLength: 20, normalize: 'upper', pattern: /^[A-Z0-9][A-Z0-9_-]*$/ }),
    name: f.text({ label: label('倉庫名', 'Name'), required: true, maxLength: 100 }),
    isDefault: f.bool({ label: label('既定の倉庫', 'Default'), description: label('設定 inventory.default_warehouse のコードが無いときに使う', 'Used when the code in inventory.default_warehouse does not exist'), required: true, default: false }),
  },
  permissions: {
    roles: {
      inventory: ['read', 'create', 'update', 'delete'],
      sales: ['read'],
      purchasing: ['read'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['code', 'name', 'isDefault'], search: ['code', 'name'] },
});

export type WarehouseDef = typeof Warehouse;
