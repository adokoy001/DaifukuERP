import { defineDocument, f, label } from '@daifuku/kernel';
import { StockEntry, Warehouse } from '@daifuku/mod-inventory';
import { Product } from '@daifuku/mod-product';
import { FarmSeason } from './season.ts';

export const FarmHarvest = defineDocument({
  name: 'farm_harvest', label: label('収穫', 'Harvest'),
  naming: { type: 'sequence', prefix: 'FHV-', period: 'year' },
  fields: {
    sampleKey: f.text({ label: label('サンプル識別キー', 'Sample key'), unique: true, immutable: true, serverOwned: true, maxLength: 80 }),
    seasonId: f.ref(FarmSeason.name, { label: label('作期', 'Season'), required: true, immutable: true }),
    date: f.date({ label: label('収穫日', 'Harvest date'), required: true, default: 'today', index: true }),
    warehouseId: f.ref(Warehouse.name, { label: label('収穫受入倉庫', 'Harvest warehouse'), required: true }),
    quantity: f.quantity({ label: label('収穫数量', 'Harvest quantity'), required: true }),
    valuationUnitCost: f.money({ label: label('評価単価（円/在庫単位）', 'Valuation unit cost (JPY/stock unit)'), description: label('利用者が明示入力。生産原価の自動計算ではありません', 'Explicit input; not an automatic production cost calculation'), required: true, min: '0', scale: 6 }),
    valuationAmount: f.money({ label: label('収穫評価額（円）', 'Harvest valuation (JPY)'), required: true, default: '0', scale: 6, serverOwned: true }),
    productId: f.ref(Product.name, { label: label('収穫品目', 'Harvest product'), serverOwned: true }),
    uomCode: f.text({ label: label('在庫単位', 'Stock unit'), serverOwned: true, maxLength: 20 }),
    stockEntryId: f.ref(StockEntry.name, { label: label('収穫入庫伝票', 'Harvest stock receipt'), serverOwned: true }),
    cancelledDate: f.date({ label: label('取消有効日', 'Cancellation effective date'), serverOwned: true }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  allowOnSubmit: ['stockEntryId'],
  permissions: { roles: { inventory: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'], viewer: ['read'], sales: ['read'], purchasing: ['read'], accounting: ['read'] } },
  views: { list: ['date', 'seasonId', 'quantity', 'uomCode', 'valuationAmount', 'warehouseId'], search: ['note'], form: [['seasonId', 'date', 'warehouseId'], ['quantity', 'valuationUnitCost'], ['productId', 'uomCode', 'valuationAmount'], ['stockEntryId', 'cancelledDate'], ['note']] },
});
