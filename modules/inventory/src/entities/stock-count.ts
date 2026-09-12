// 棚卸 (docs/specs/inventory.md AC-6). Submitting it creates and submits an `adjustment` stock_entry for the non-zero
// variances (hooks/count.ts) and links it in `adjustmentEntryId` (a ref, so the adjustment cannot be cancelled on its own
// while the count is submitted — the kernel's dependents check). Cancelling the count cancels the adjustment.
import { defineDocument, f, label } from '@daifuku/kernel';

export const StockCount = defineDocument({
  name: 'stock_count',
  label: label('棚卸', 'Stock count'),
  naming: { type: 'sequence', prefix: 'CNT-', period: 'year' },
  fields: {
    warehouseId: f.ref('warehouse', { label: label('倉庫', 'Warehouse'), description: label('省略時は既定の倉庫', 'defaults to the default warehouse'), required: true }),
    date: f.date({ label: label('棚卸日', 'Count date'), required: true, default: 'today', index: true }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
    adjustmentEntryId: f.ref('stock_entry', { label: label('調整伝票', 'Adjustment entry'), description: label('submit 時に作成', 'created at submit') }),
  },
  allowOnSubmit: ['adjustmentEntryId'],
  lines: [{ entity: 'stock_count_line', parentField: 'countId' }],
  permissions: {
    roles: {
      inventory: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['warehouseId', 'date', 'adjustmentEntryId'],
    search: ['note'],
    form: [['warehouseId', 'date'], ['note', 'adjustmentEntryId']],
  },
});

export type StockCountDef = typeof StockCount;
