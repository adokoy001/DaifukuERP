// レジ締め明細 (docs/specs/pack-retail.md AC-2): quantity sold of one product at its tax-inclusive unit price. A return is a
// negative quantity on the same kind of line (the sales invoice keeps it; inventory does not receive it back — scenario
// limitation). unitPrice / taxCategory default from the product, amount = quantity × unitPrice (hooks/lines.ts).
import { defineEntity, f, label } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@daifuku/mod-tax';
import { RetailClosing } from './retail-closing.ts';

export const RetailClosingLine = defineEntity({
  name: 'retail_closing_line',
  label: label('レジ締め明細', 'Register closing line'),
  fields: {
    closingId: f.ref(RetailClosing.name, {
      label: label('レジ締め', 'Register closing'),
      required: true,
      onDelete: 'cascade',
    }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    productId: f.ref(Product.name, { label: label('品目', 'Product'), required: true }),
    quantity: f.quantity({
      label: label('数量', 'Quantity'),
      description: label('0 以外。返品はマイナス', 'non-zero; returns are negative'),
      required: true,
    }),
    unitPrice: f.money({
      label: label('税込単価', 'Unit price (tax incl.)'),
      description: label('省略時は品目の販売単価', "defaults to the product's sale price"),
      required: true,
    }),
    taxCategory: f.enum(TAX_CATEGORIES, {
      label: label('税区分', 'Tax category'),
      description: label('省略時は品目の税区分', "defaults to the product's tax category"),
      required: true,
      labels: TAX_CATEGORY_LABELS,
    }),
    amount: f.money({
      label: label('金額', 'Amount'),
      description: label('数量 × 税込単価（丸めなし）', 'quantity × unit price, unrounded'),
      required: true,
      default: '0',
    }),
  },
  indexes: [['closingId', 'seq']],
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'productId', 'quantity', 'unitPrice', 'taxCategory', 'amount'] },
});

export type RetailClosingLineDef = typeof RetailClosingLine;
