// @daifuku/mod-inventory public API (docs/specs/inventory.md). Importing this module registers the warehouse, stock ledger /
// balance, stock entry and stock count entities, the four reports, the settings and the hooks — including the hooks on
// purchase_invoice / sales_invoice (auto receipt / issue). Stock moves only through documents: there is no exported
// function that writes the ledger or balances directly (the posting code checks a module-private marker).
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { StockBalance } from './entities/stock-balance.ts';
import type { StockCount } from './entities/stock-count.ts';
import type { StockCountLine } from './entities/stock-count-line.ts';
import type { StockEntry } from './entities/stock-entry.ts';
import type { StockEntryLine } from './entities/stock-entry-line.ts';
import type { StockLedger } from './entities/stock-ledger.ts';
import type { Warehouse } from './entities/warehouse.ts';

export { InventoryModule } from './module.ts';
export { Warehouse } from './entities/warehouse.ts';
export { StockLedger } from './entities/stock-ledger.ts';
export { StockBalance } from './entities/stock-balance.ts';
export { StockEntry, STOCK_ENTRY_TYPES, type StockEntryType } from './entities/stock-entry.ts';
export { StockEntryLine, LINE_SIGNS, type LineSign } from './entities/stock-entry-line.ts';
export { StockCount } from './entities/stock-count.ts';
export { StockCountLine } from './entities/stock-count-line.ts';

export { stockOnHandAction, stockOnHand, stockOnHandInput, STOCK_ON_HAND_COLUMNS, type StockOnHandInput } from './actions/stock-on-hand.ts';
export { ledgerAction, stockLedger, ledgerInput, LEDGER_COLUMNS, type LedgerInput } from './actions/ledger.ts';
export { valuationAction, valuation, valuationInput, VALUATION_COLUMNS, type ValuationInput } from './actions/valuation.ts';
export { countVarianceAction, countVariance, countVarianceInput, COUNT_VARIANCE_COLUMNS, type CountVarianceInput } from './actions/count-variance.ts';

export { COST_SCALE, emptyState, inbound, outbound, replay, round6, fitsScale, type StockState, type Movement, type InboundCost, type OutboundCost, type Step } from './services/moving-average.ts';
export { entryIssues, headIssues, lineIssues, lineDirection, needsUnitCost, roleAllowsEntry, ROLE_HINT, type EntryHead, type EntryLineInput, type Issue, type LineDirection, type ProductKind } from './services/entry-rules.ts';
export { stockLines, netUnitPrice, ratesFromTaxSummary, receiptLinesFromPurchase, issueLinesFromSales, adjustmentLinesFromCount, type InvoiceLineLike, type EntryLineDraft, type CountLineLike } from './services/from-invoice.ts';
export { loadBalance, stateOf, NEGATIVE_STOCK_HINT, type StockKey, type BalanceRow, type LedgerRow } from './ledger.ts';

export { LEDGER_WRITE_HINT } from './hooks/guard.ts';
export { FROZEN_HINT, SERVICE_HINT } from './hooks/lines.ts';
export { SUBMIT_HINT, SOURCE_HINT, SOURCE_ENTITIES } from './hooks/submit.ts';
export { COUNT_FROZEN_HINT } from './hooks/count.ts';
export { seedWarehouses, SEED_WAREHOUSES } from './seeds/warehouses.ts';

export {
  ALLOW_NEGATIVE_STOCK_KEY,
  AUTO_RECEIPT_ON_PURCHASE_KEY,
  AUTO_ISSUE_ON_SALES_KEY,
  DEFAULT_WAREHOUSE_KEY,
  INVENTORY_SETTING_DEFAULTS,
  INVENTORY_SETTING_DEFS,
  DEFAULT_WAREHOUSE_HINT,
  boolSettingSchema,
  warehouseCodeSchema,
  resolveDefaultWarehouse,
} from './settings.ts';

export type WarehouseRow = Infer<typeof Warehouse>;
export type WarehouseInsert = InsertInput<typeof Warehouse>;
export type StockLedgerRow = Infer<typeof StockLedger>;
export type StockBalanceRow = Infer<typeof StockBalance>;
export type StockEntryRow = Infer<typeof StockEntry>;
export type StockEntryInsert = InsertInput<typeof StockEntry>;
export type StockEntryUpdate = UpdateInput<typeof StockEntry>;
export type StockEntryLineRow = Infer<typeof StockEntryLine>;
export type StockEntryLineInsert = InsertInput<typeof StockEntryLine>;
export type StockCountRow = Infer<typeof StockCount>;
export type StockCountInsert = InsertInput<typeof StockCount>;
export type StockCountLineRow = Infer<typeof StockCountLine>;

export { INVENTORY_SERIES_LOCK, InventoryPeriodClose, closeInventoryThrough, assertInventoryDate } from './period-close.ts';
