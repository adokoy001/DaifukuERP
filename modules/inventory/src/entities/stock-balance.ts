// 在庫残高 (docs/specs/inventory.md AC-1): the current balance per (productId, warehouseId), maintained by src/ledger.ts
// together with each stock_ledger row (hooks/guard.ts refuses writes from anywhere else). `value` is Σ costDelta of the
// ledger rows (so value = qty × avgCost up to the 6-decimal rounding of avgCost); `lastSeq` is the seq of the last row.
import { defineEntity, f, label } from '@daifuku/kernel';

export const StockBalance = defineEntity({
  name: 'stock_balance',
  label: label('在庫残高', 'Stock balance'),
  fields: {
    productId: f.ref('product', { label: label('品目', 'Product'), required: true }),
    warehouseId: f.ref('warehouse', { label: label('倉庫', 'Warehouse'), required: true, index: true }),
    qty: f.quantity({ label: label('数量', 'Quantity'), required: true, default: '0' }),
    avgCost: f.money({ label: label('移動平均単価', 'Average cost'), required: true, default: '0', scale: 6 }),
    value: f.money({
      label: label('在庫金額', 'Value'),
      description: label('台帳の金額増減の合計', 'Σ cost change of the ledger rows'),
      required: true,
      default: '0',
      scale: 6,
    }),
    lastSeq: f.int({ label: label('最終連番', 'Last seq'), required: true, default: 0, min: 0, hidden: true }),
  },
  audit: 'none',
  unique: [['productId', 'warehouseId']],
  permissions: {
    roles: {
      inventory: ['read', 'create', 'update'],
      sales: ['read', 'create', 'update'],
      purchasing: ['read', 'create', 'update'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['productId', 'warehouseId', 'qty', 'avgCost', 'value'] },
});

export type StockBalanceDef = typeof StockBalance;
