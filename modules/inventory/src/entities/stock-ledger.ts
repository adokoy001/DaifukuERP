// 在庫台帳 (docs/specs/inventory.md AC-1, ADR-0005): one row per stock movement, append-only. Rows are written only by
// this module's posting code (src/ledger.ts, when a stock_entry is submitted or cancelled); hooks/guard.ts refuses every
// other create and every update/delete, admin included. The posting roles hold `create` because postings run in the
// submitting user's context (ADR-0007, no bypass). `seq` counts rows per (productId, warehouseId) in posting order;
// `unitCost` is the moving average after the row, `balanceQty`/`balanceCost` the balance after it (posting order).
import { defineEntity, f, label } from '@daifuku/kernel';

export const StockLedger = defineEntity({
  name: 'stock_ledger',
  label: label('在庫台帳', 'Stock ledger'),
  fields: {
    date: f.date({ label: label('日付', 'Date'), required: true, index: true }),
    warehouseId: f.ref('warehouse', { label: label('倉庫', 'Warehouse'), required: true }),
    productId: f.ref('product', { label: label('品目', 'Product'), required: true }),
    qtyDelta: f.quantity({ label: label('数量増減', 'Quantity change'), required: true }),
    unitCost: f.money({
      label: label('単価（移動平均後）', 'Unit cost (moving average after)'),
      required: true,
      scale: 6,
    }),
    costDelta: f.money({ label: label('金額増減', 'Cost change'), required: true, scale: 6 }),
    balanceQty: f.quantity({ label: label('残数量', 'Balance quantity'), required: true }),
    balanceCost: f.money({ label: label('残高金額', 'Balance cost'), required: true, scale: 6 }),
    sourceEntity: f.text({ label: label('発生元エンティティ', 'Source entity'), required: true, maxLength: 100 }),
    sourceId: f.uuid({ label: label('発生元', 'Source'), required: true, index: true }),
    seq: f.int({
      label: label('連番', 'Seq'),
      description: label('品目×倉庫ごとの転記順', 'posting order per product × warehouse'),
      required: true,
      min: 1,
    }),
    reversal: f.bool({
      label: label('取消行', 'Reversal'),
      description: label('入出庫伝票の取消で追加された逆仕訳行', 'appended when the stock entry was cancelled'),
      required: true,
      default: false,
    }),
  },
  audit: 'none',
  unique: [['productId', 'warehouseId', 'seq']],
  indexes: [['productId', 'warehouseId', 'date']],
  permissions: {
    roles: {
      inventory: ['read', 'create'],
      sales: ['read', 'create'],
      purchasing: ['read', 'create'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: [
      'date',
      'productId',
      'warehouseId',
      'qtyDelta',
      'unitCost',
      'costDelta',
      'balanceQty',
      'balanceCost',
      'reversal',
    ],
  },
});

export type StockLedgerDef = typeof StockLedger;
