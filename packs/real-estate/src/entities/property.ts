// 物件 (spec AC-1). Pack-owned master; entity names start with the pack name (docs/conventions/packs.md).
import { defineEntity, f, label } from '@daifuku/kernel';

export const RealEstateProperty = defineEntity({
  name: 'real_estate_property',
  label: label('物件', 'Property'),
  fields: {
    code: f.text({ label: label('物件コード', 'Code'), required: true, unique: true, immutable: true, maxLength: 20 }),
    name: f.text({ label: label('物件名', 'Name'), required: true, maxLength: 200 }),
    address: f.text({ label: label('所在地', 'Address'), maxLength: 400 }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  displayField: 'name',
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['code', 'name', 'address'], search: ['code', 'name', 'address'] },
});
