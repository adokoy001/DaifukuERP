// 入出庫明細 (docs/specs/inventory.md AC-2/AC-3). Goods only (a service product is refused by hooks/lines.ts).
// `sign` is for adjustment entries (in / out). `unitCost` is required for inbound lines (receipt, adjustment in) and is
// filled at submit for outbound lines (issue, transfer, adjustment out) from the moving average; `amount` is
// quantity × unitCost while a draft and the posted cost (|costDelta|) after submit. Frozen once the entry leaves draft.
import { defineEntity, f, label } from '@daifuku/kernel';

export const LINE_SIGNS = ['in', 'out'] as const;
export type LineSign = (typeof LINE_SIGNS)[number];

export const StockEntryLine = defineEntity({
  name: 'stock_entry_line',
  label: label('入出庫明細', 'Stock entry line'),
  fields: {
    entryId: f.ref('stock_entry', { label: label('入出庫伝票', 'Stock entry'), required: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', {
      label: label('品目', 'Product'),
      description: label('物品のみ（サービスは不可）', 'goods only (not services)'),
      required: true,
    }),
    quantity: f.quantity({
      label: label('数量', 'Quantity'),
      description: label('0 より大きい（小数 6 桁まで）', '> 0, at most 6 decimals'),
      required: true,
    }),
    sign: f.enum(LINE_SIGNS, {
      label: label('増減', 'Direction'),
      description: label('調整のときだけ: in=増, out=減', 'adjustments only'),
      labels: { in: label('増', 'In'), out: label('減', 'Out') },
    }),
    unitCost: f.money({
      label: label('単価', 'Unit cost'),
      description: label(
        '入庫・調整増は必須。出庫・移動・調整減は submit 時に移動平均単価',
        'required for receipts / adjustment in; outbound lines get the moving average at submit',
      ),
      min: '0',
      scale: 6,
    }),
    amount: f.money({
      label: label('金額', 'Amount'),
      description: label('数量 × 単価（submit 後は計上額）', 'quantity × unit cost (posted cost after submit)'),
      required: true,
      default: '0',
      scale: 6,
    }),
  },
  indexes: [['entryId', 'seq']],
  permissions: {
    roles: {
      inventory: ['read', 'create', 'update', 'delete'],
      purchasing: ['read', 'create', 'update', 'delete'],
      sales: ['read', 'create', 'update'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'productId', 'sign', 'quantity', 'unitCost', 'amount'] },
});

export type StockEntryLineDef = typeof StockEntryLine;
