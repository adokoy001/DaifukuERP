// Module manifest (docs/conventions/layers.md). The dependency modules are imported first so `product`, `partner`,
// `purchase_invoice` and `sales_invoice` are registered before our entities and hooks reference them. accounting is a
// declared dependency (sales/purchase need it) but inventory posts no journal entries (三分法, spec 目的).
import { InventoryPeriodClose, registerPeriodCloseHooks } from './period-close.ts';
import { defineModule, label } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { PartnerModule } from '@daifuku/mod-partner';
import { ProductModule } from '@daifuku/mod-product';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { countVarianceAction } from './actions/count-variance.ts';
import { ledgerAction } from './actions/ledger.ts';
import { stockOnHandAction } from './actions/stock-on-hand.ts';
import { valuationAction } from './actions/valuation.ts';
import { StockBalance } from './entities/stock-balance.ts';
import { StockCountLine } from './entities/stock-count-line.ts';
import { StockCount } from './entities/stock-count.ts';
import { StockEntryLine } from './entities/stock-entry-line.ts';
import { StockEntry } from './entities/stock-entry.ts';
import { StockLedger } from './entities/stock-ledger.ts';
import { Warehouse } from './entities/warehouse.ts';
import { registerCancelHook } from './hooks/cancel.ts';
import { registerCountHooks } from './hooks/count.ts';
import { registerEntryHooks } from './hooks/entry.ts';
import { registerGuardHooks } from './hooks/guard.ts';
import { registerInvoiceHooks } from './hooks/invoices.ts';
import { registerLineHooks } from './hooks/lines.ts';
import { registerSubmitHook } from './hooks/submit.ts';
import { registerWarehouseHooks } from './hooks/warehouse.ts';
import { seedWarehouses } from './seeds/warehouses.ts';
import { registerInventorySettings } from './settings.ts';

export const InventoryModule = defineModule({
  name: 'inventory',
  label: label('在庫', 'Inventory'),
  depends: [ProductModule.name, PartnerModule.name, AccountingModule.name, SalesModule.name, PurchaseModule.name],
  entities: [InventoryPeriodClose, Warehouse, StockLedger, StockBalance, StockEntry, StockEntryLine, StockCount, StockCountLine],
  actions: [stockOnHandAction, ledgerAction, valuationAction, countVarianceAction],
  hooks: () => {
    registerPeriodCloseHooks();
    registerGuardHooks();
    registerWarehouseHooks();
    registerEntryHooks();
    registerLineHooks();
    registerSubmitHook();
    registerCancelHook();
    registerInvoiceHooks();
    registerCountHooks();
    registerInventorySettings();
  },
  seed: seedWarehouses,
  menus: [
    { label: label('倉庫', 'Warehouses'), entity: Warehouse.name, order: 70 },
    { label: label('入出庫', 'Stock entries'), entity: StockEntry.name, order: 71 },
    { label: label('棚卸', 'Stock counts'), entity: StockCount.name, order: 72 },
    { label: label('在庫照会', 'Stock on hand'), route: `/r/${stockOnHandAction.name}`, order: 73 },
    { label: label('在庫台帳', 'Stock ledger'), route: `/r/${ledgerAction.name}`, order: 74 },
    { label: label('在庫評価', 'Valuation'), route: `/r/${valuationAction.name}`, order: 75 },
  ],
  roles: { inventory: label('在庫', 'Inventory') },
});
