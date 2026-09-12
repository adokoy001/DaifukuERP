// 単位（unit of measure）。docs/specs/product.md フィールド表のとおり。
import { defineEntity, f, label } from '@daifuku/kernel';

export const Uom = defineEntity({
  name: 'uom',
  label: label('単位', 'Unit of measure'),
  fields: {
    code: f.text({ required: true, unique: true, immutable: true, maxLength: 10, label: label('コード', 'Code') }),
    name: f.text({ required: true, label: label('名称', 'Name') }),
    symbol: f.text({ maxLength: 10, label: label('記号', 'Symbol') }),
  },
  displayField: 'name',
  permissions: {
    roles: {
      viewer: ['read'],
      sales: ['read', 'create', 'update'],
      purchasing: ['read', 'create', 'update'],
    },
  },
  views: { list: ['code', 'name', 'symbol'], search: ['code', 'name'] },
});
