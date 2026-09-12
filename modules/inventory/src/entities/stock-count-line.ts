// 棚卸明細 (docs/specs/inventory.md AC-6): the counted quantity of one product. `systemQty` is the stock_balance
// quantity of the count's warehouse (filled on every draft save and fixed at submit), `varianceQty` = counted − system.
import { defineEntity, f, label } from '@daifuku/kernel';

export const StockCountLine = defineEntity({
  name: 'stock_count_line',
  label: label('棚卸明細', 'Stock count line'),
  fields: {
    countId: f.ref('stock_count', { label: label('棚卸', 'Stock count'), required: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', { label: label('品目', 'Product'), description: label('物品のみ', 'goods only'), required: true }),
    countedQty: f.quantity({ label: label('実棚数量', 'Counted quantity'), required: true, min: '0' }),
    systemQty: f.quantity({ label: label('帳簿数量', 'System quantity'), description: label('在庫残高から自動', 'from the stock balance'), required: true, default: '0' }),
    varianceQty: f.quantity({ label: label('差異数量', 'Variance'), description: label('実棚 − 帳簿', 'counted − system'), required: true, default: '0' }),
  },
  indexes: [['countId', 'seq']],
  permissions: {
    roles: {
      inventory: ['read', 'create', 'update', 'delete'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'productId', 'systemQty', 'countedQty', 'varianceQty'] },
});

export type StockCountLineDef = typeof StockCountLine;
