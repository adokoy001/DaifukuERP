import { defineEntity, f, label } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';

const permissions = { roles: { inventory: ['read', 'create', 'update', 'delete'], viewer: ['read'], sales: ['read'], purchasing: ['read'], accounting: ['read'] } } as const;
export const FarmField = defineEntity({
  name: 'farm_field', label: label('圃場', 'Farm field'),
  fields: {
    code: f.text({ label: label('圃場コード', 'Field code'), required: true, unique: true, immutable: true, maxLength: 40 }),
    name: f.text({ label: label('圃場名', 'Field name'), required: true, maxLength: 200 }),
    areaM2: f.quantity({ label: label('面積（m²）', 'Area (m²)'), required: true, min: '0' }),
    location: f.text({ label: label('所在地・目印', 'Location'), maxLength: 500 }),
    isActive: f.bool({ label: label('有効', 'Active'), required: true, default: true }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  displayField: 'name', permissions,
  views: { list: ['code', 'name', 'areaM2', 'location', 'isActive'], search: ['code', 'name'], form: [['code', 'name'], ['areaM2', 'location'], ['isActive', 'note']] },
});

export const FarmCrop = defineEntity({
  name: 'farm_crop', label: label('作物', 'Crop'),
  fields: {
    code: f.text({ label: label('作物コード', 'Crop code'), required: true, unique: true, immutable: true, maxLength: 40 }),
    name: f.text({ label: label('作物名', 'Crop name'), required: true, maxLength: 200 }),
    productId: f.ref(Product.name, { label: label('収穫品目', 'Harvest product'), required: true, immutable: true }),
    variety: f.text({ label: label('品種', 'Variety'), maxLength: 200 }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  displayField: 'name', permissions,
  views: { list: ['code', 'name', 'productId', 'variety'], search: ['code', 'name'], form: [['code', 'name'], ['productId', 'variety'], ['note']] },
});
