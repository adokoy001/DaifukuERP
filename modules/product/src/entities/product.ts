// 品目（物品・サービス）。税は「税区分」だけを持ち、率は tax モジュールが日付で解決する（docs/specs/product.md）。
import { defineEntity, f, label } from '@daifuku/kernel';

export const PRODUCT_KINDS = ['goods', 'service'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** 課税10% / 軽減8% / 免税 / 非課税 / 不課税（docs/domain/japan-tax.md 消費税の課税区分）。 */
export const TAX_CATEGORIES = ['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const Product = defineEntity({
  name: 'product',
  label: label('品目', 'Product'),
  fields: {
    code: f.text({ unique: true, immutable: true, maxLength: 30, label: label('品目コード', 'Code') }),
    name: f.text({ required: true, maxLength: 200, label: label('品目名', 'Name') }),
    nameKana: f.text({ normalize: 'halfwidth-kana', label: label('品目名カナ', 'Name (kana)') }),
    kind: f.enum(PRODUCT_KINDS, {
      immutable: true,
      required: true,
      default: 'goods',
      label: label('種別', 'Kind'),
      labels: { goods: label('物品', 'Goods'), service: label('サービス', 'Service') },
    }),
    taxCategory: f.enum(TAX_CATEGORIES, {
      required: true,
      default: 'standard',
      label: label('税区分', 'Tax category'),
      labels: {
        standard: label('課税（標準）', 'Taxable (standard)'),
        reduced: label('課税（軽減）', 'Taxable (reduced)'),
        exempt: label('免税', 'Exempt (zero-rated)'),
        non_taxable: label('非課税', 'Non-taxable'),
        out_of_scope: label('不課税', 'Out of scope'),
      },
    }),
    // 業務上は必須（AC-2）。DSL の required にすると汎用 create アクションが before_validate フックより先に
    // 入力を検証して uomId 省略を拒むため、NOT NULL は付けず hooks/default-uom.ts が「省略時は会社の個を補う／null は拒む」を担う。
    uomId: f.ref('uom', { immutable: true, label: label('単位', 'Unit of measure') }),
    salePrice: f.money({ min: '0', label: label('販売単価', 'Sale price') }),
    purchasePrice: f.money({ min: '0', label: label('仕入単価', 'Purchase price') }),
    isSold: f.bool({ required: true, default: true, label: label('販売対象', 'Sold') }),
    isPurchased: f.bool({ required: true, default: true, label: label('購買対象', 'Purchased') }),
    isActive: f.bool({ required: true, default: true, label: label('有効', 'Active') }),
    description: f.text({ multiline: true, label: label('説明', 'Description') }),
  },
  displayField: 'name',
  permissions: {
    roles: {
      viewer: ['read'],
      sales: ['read', 'create', 'update'],
      purchasing: ['read', 'create', 'update'],
    },
  },
  views: {
    list: ['code', 'name', 'kind', 'taxCategory', 'salePrice'],
    search: ['name', 'nameKana', 'code'],
    form: [
      ['code', 'name', 'nameKana'],
      ['kind', 'taxCategory', 'uomId'],
      ['salePrice', 'purchasePrice'],
      ['isSold', 'isPurchased', 'isActive'],
      ['description'],
    ],
  },
});
