import { defineDocument, defineEntity, f, label } from '@daifuku/kernel';
import { StockEntry, Warehouse } from '@daifuku/mod-inventory';
import { Product } from '@daifuku/mod-product';
import { FarmSeason } from './season.ts';

export const FARM_ACTIVITIES = ['sowing', 'planting', 'fertilizing', 'weeding', 'irrigation', 'other'] as const;
export const FarmWork = defineDocument({
  name: 'farm_work', label: label('農作業・資材投入', 'Farm work and material use'),
  naming: { type: 'sequence', prefix: 'FWK-', period: 'year' },
  fields: {
    sampleKey: f.text({ label: label('サンプル識別キー', 'Sample key'), unique: true, immutable: true, serverOwned: true, maxLength: 80 }),
    seasonId: f.ref(FarmSeason.name, { label: label('作期', 'Season'), required: true, immutable: true }),
    date: f.date({ label: label('作業日', 'Work date'), required: true, default: 'today', index: true }),
    activity: f.enum(FARM_ACTIVITIES, { label: label('作業区分', 'Activity'), required: true, labels: { sowing: label('播種', 'Sowing'), planting: label('定植', 'Planting'), fertilizing: label('施肥', 'Fertilizing'), weeding: label('除草', 'Weeding'), irrigation: label('灌水', 'Irrigation'), other: label('その他', 'Other') } }),
    laborHours: f.quantity({ label: label('延べ作業時間（人時）', 'Labor (person-hours)'), required: true, default: '0', min: '0' }),
    warehouseId: f.ref(Warehouse.name, { label: label('資材倉庫', 'Material warehouse') }),
    stockEntryId: f.ref(StockEntry.name, { label: label('資材出庫伝票', 'Material stock issue'), serverOwned: true }),
    cancelledDate: f.date({ label: label('取消有効日', 'Cancellation effective date'), serverOwned: true }),
    note: f.text({ label: label('作業内容・備考', 'Work details'), multiline: true, maxLength: 2000 }),
  },
  allowOnSubmit: ['stockEntryId'], lines: [{ entity: 'farm_material_line', parentField: 'workId' }],
  permissions: { roles: { inventory: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'], viewer: ['read'], sales: ['read'], purchasing: ['read'], accounting: ['read'] } },
  views: { list: ['date', 'seasonId', 'activity', 'laborHours', 'warehouseId', 'stockEntryId'], search: ['note'], form: [['seasonId', 'date'], ['activity', 'laborHours', 'warehouseId'], ['note'], ['stockEntryId', 'cancelledDate']] },
});

export const FarmMaterialLine = defineEntity({
  name: 'farm_material_line', label: label('資材投入明細', 'Material input'),
  fields: {
    workId: f.ref(FarmWork.name, { label: label('農作業', 'Farm work'), required: true, immutable: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Sequence'), required: true, default: 1, min: 1 }),
    productId: f.ref(Product.name, { label: label('資材品目', 'Material product'), required: true }),
    quantity: f.quantity({ label: label('投入数量', 'Quantity used'), required: true }),
    uomCode: f.text({ label: label('在庫単位', 'Stock unit'), serverOwned: true, maxLength: 20 }),
    note: f.text({ label: label('備考', 'Note'), maxLength: 500 }),
  },
  indexes: [['workId', 'seq']],
  permissions: { roles: { inventory: ['read', 'create', 'update', 'delete'], viewer: ['read'], sales: ['read'], purchasing: ['read'], accounting: ['read'] } },
  views: { list: ['seq', 'productId', 'quantity', 'uomCode', 'note'] },
});
