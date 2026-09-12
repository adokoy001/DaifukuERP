// 入出庫伝票 (docs/specs/inventory.md AC-2). Submitting it posts to stock_ledger / stock_balance by the moving average
// method (hooks/submit.ts); cancelling appends the reverse rows (hooks/cancel.ts). `sourceEntity` / `sourceId` are
// system-owned: set only when this module creates the entry from a purchase/sales invoice or a stock count.
//
// Roles (AC-9): `inventory` does everything. `purchasing` works on receipts only and `sales` only through the sales
// invoice hooks — the role table grants them the ops the in-process path needs (create/submit/cancel run in the
// invoice submitter's context, ADR-0007) and hooks/entry.ts narrows direct use (PERMISSION_DENIED `<op>:<type>`).
import { defineDocument, f, label } from '@daifuku/kernel';

export const STOCK_ENTRY_TYPES = ['receipt', 'issue', 'transfer', 'adjustment'] as const;
export type StockEntryType = (typeof STOCK_ENTRY_TYPES)[number];

export const StockEntry = defineDocument({
  name: 'stock_entry',
  label: label('入出庫伝票', 'Stock entry'),
  naming: { type: 'sequence', prefix: 'STK-', period: 'year' },
  fields: {
    type: f.enum(STOCK_ENTRY_TYPES, {
      label: label('区分', 'Type'),
      required: true,
      index: true,
      labels: { receipt: label('入庫', 'Receipt'), issue: label('出庫', 'Issue'), transfer: label('移動', 'Transfer'), adjustment: label('調整', 'Adjustment') },
    }),
    date: f.date({ label: label('日付', 'Date'), required: true, default: 'today', index: true }),
    warehouseId: f.ref('warehouse', { label: label('倉庫（移動元）', 'Warehouse (from)'), description: label('省略時は既定の倉庫', 'defaults to the default warehouse'), required: true }),
    toWarehouseId: f.ref('warehouse', { label: label('移動先倉庫', 'To warehouse'), description: label('移動のときだけ指定', 'transfers only') }),
    partnerId: f.ref('partner', { label: label('取引先', 'Partner') }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
    sourceEntity: f.text({ label: label('発生元エンティティ', 'Source entity'), description: label('請求書・棚卸から自動作成したときに設定', 'set when created from an invoice or a stock count'), maxLength: 100 }),
    sourceId: f.uuid({ label: label('発生元', 'Source'), index: true }),
  },
  lines: [{ entity: 'stock_entry_line', parentField: 'entryId' }],
  indexes: [['sourceEntity', 'sourceId']],
  permissions: {
    roles: {
      inventory: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      purchasing: ['read', 'create', 'update', 'submit', 'cancel'],
      sales: ['read', 'create', 'submit', 'cancel'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['type', 'date', 'warehouseId', 'toWarehouseId', 'partnerId', 'sourceEntity'],
    search: ['note'],
    form: [['type', 'date'], ['warehouseId', 'toWarehouseId', 'partnerId'], ['note'], ['sourceEntity', 'sourceId']],
  },
});

export type StockEntryDef = typeof StockEntry;
