// Contract line (spec AC-1): a monthly charge. hooks/lines.ts fills description/unitPrice/taxCategory from the product
// when omitted, keeps `amount = quantity × unitPrice` (one month, unrounded, ADR-0010) and freezes the lines once the
// contract leaves draft. `delete` is granted to sales because the kernel's replace-all line save removes dropped rows
// through repo.delete.
import { defineEntity, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@daifuku/mod-tax';

export const ContractLine = defineEntity({
  name: 'contract_line',
  label: label('契約明細', 'Contract line'),
  fields: {
    contractId: f.ref('contract', { label: label('契約', 'Contract'), required: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', { label: label('品目', 'Product') }),
    description: f.text({
      label: label('品名・摘要', 'Description'),
      description: label('省略時は品目名', 'defaults to the product name'),
      required: true,
      maxLength: 200,
    }),
    quantity: f.quantity({ label: label('数量', 'Quantity'), required: true, default: '1' }),
    unitPrice: f.money({
      label: label('月額単価', 'Monthly unit price'),
      description: label('税抜。省略時は品目の販売単価', "Tax-exclusive; defaults to the product's sale price"),
      required: true,
    }),
    taxCategory: f.enum(TAX_CATEGORIES, {
      label: label('税区分', 'Tax category'),
      description: label('省略時は品目の税区分', "defaults to the product's tax category"),
      required: true,
      labels: TAX_CATEGORY_LABELS,
    }),
    amount: f.money({
      label: label('月額', 'Monthly amount'),
      description: label('数量 × 単価（丸めなし）', 'quantity × unit price, unrounded'),
      required: true,
      default: '0',
    }),
  },
  indexes: [['contractId', 'seq']],
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'productId', 'description', 'quantity', 'unitPrice', 'taxCategory', 'amount'] },
});

export type ContractLineDef = typeof ContractLine;
