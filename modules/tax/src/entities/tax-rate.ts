// 税率マスタ (docs/specs/tax.md AC-1): one row per (category, validity period). Rates are data with periods,
// never constants (ADR-0011; docs/domain/japan-tax.md#消費税). Overlap is rejected by hooks/no-overlap.ts.
import { defineEntity, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '../services/categories.ts';

export const TaxRate = defineEntity({
  name: 'tax_rate',
  label: label('税率', 'Tax rate'),
  fields: {
    code: f.text({ label: label('税率コード', 'Code'), required: true, unique: true, immutable: true, maxLength: 20, normalize: 'upper', pattern: /^[A-Z0-9][A-Z0-9_-]*$/ }),
    category: f.enum(TAX_CATEGORIES, { label: label('税区分', 'Category'), required: true, labels: TAX_CATEGORY_LABELS }),
    rate: f.decimal({ label: label('税率', 'Rate'), description: label('0.10 = 10%', '0.10 = 10%'), required: true, min: '0', scale: 4 }),
    validFrom: f.date({ label: label('適用開始日', 'Valid from'), required: true }),
    validTo: f.date({ label: label('適用終了日', 'Valid to'), description: label('空欄 = 無期限', 'Empty = open-ended') }),
    label: f.text({ label: label('表示名', 'Label'), required: true, maxLength: 50 }),
  },
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update'],
      settings: ['read', 'create', 'update'],
      sales: ['read'],
      purchasing: ['read'],
      viewer: ['read'],
    },
  },
  displayField: 'label',
  views: {
    list: ['code', 'category', 'rate', 'validFrom', 'validTo', 'label'],
    search: ['code', 'label'],
    form: [['code', 'category', 'rate'], ['validFrom', 'validTo'], ['label']],
  },
  indexes: [['category', 'validFrom']],
});

export type TaxRateDef = typeof TaxRate;
