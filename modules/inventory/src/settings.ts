// Company settings owned by inventory (docs/specs/inventory.md AC-8; ADR-0013 L1) and the default warehouse lookup.
import {
  getSetting,
  label,
  registry,
  repo,
  StateError,
  type Context,
  type Infer,
  type SettingDef,
} from '@daifuku/kernel';
import { z } from 'zod';
import { Warehouse } from './entities/warehouse.ts';

export const ALLOW_NEGATIVE_STOCK_KEY = 'inventory.allow_negative_stock';
export const AUTO_RECEIPT_ON_PURCHASE_KEY = 'inventory.auto_receipt_on_purchase';
export const AUTO_ISSUE_ON_SALES_KEY = 'inventory.auto_issue_on_sales';
export const DEFAULT_WAREHOUSE_KEY = 'inventory.default_warehouse';

export const boolSettingSchema = z.boolean();
export const warehouseCodeSchema = z.string().min(1).max(20);

export const INVENTORY_SETTING_DEFAULTS = {
  [ALLOW_NEGATIVE_STOCK_KEY]: false,
  [AUTO_RECEIPT_ON_PURCHASE_KEY]: true,
  [AUTO_ISSUE_ON_SALES_KEY]: true,
  [DEFAULT_WAREHOUSE_KEY]: 'MAIN',
} as const;

export const INVENTORY_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: ALLOW_NEGATIVE_STOCK_KEY,
    label: label('マイナス在庫を許可', 'Allow negative stock'),
    description: label(
      'false（既定）なら在庫が足りない出庫・取消を拒否',
      'false (default): issues and cancellations that would go below zero are refused',
    ),
    schema: boolSettingSchema,
    default: false,
  },
  {
    key: AUTO_RECEIPT_ON_PURCHASE_KEY,
    label: label('仕入請求書から自動入庫', 'Auto receipt from purchase invoices'),
    description: label(
      '仕入請求書の submit で物品明細を既定の倉庫に入庫（既定 true）',
      'Submitting a purchase invoice receives its goods lines into the default warehouse (default true)',
    ),
    schema: boolSettingSchema,
    default: true,
  },
  {
    key: AUTO_ISSUE_ON_SALES_KEY,
    label: label('売上請求書から自動出庫', 'Auto issue from sales invoices'),
    description: label(
      '売上請求書の submit で物品明細を既定の倉庫から出庫（既定 true）',
      'Submitting a sales invoice issues its goods lines from the default warehouse (default true)',
    ),
    schema: boolSettingSchema,
    default: true,
  },
  {
    key: DEFAULT_WAREHOUSE_KEY,
    label: label('既定の倉庫コード', 'Default warehouse code'),
    description: label(
      '自動入出庫・倉庫省略時に使う倉庫のコード（既定 MAIN）',
      'Warehouse code used by auto receipts/issues and when a document omits the warehouse (default MAIN)',
    ),
    schema: warehouseCodeSchema,
  },
];

export function registerInventorySettings(): void {
  for (const def of INVENTORY_SETTING_DEFS) registry.registerSetting(def);
}

export function allowNegativeStock(ctx: Context): Promise<boolean> {
  return getSetting(
    ctx,
    ALLOW_NEGATIVE_STOCK_KEY,
    boolSettingSchema,
    INVENTORY_SETTING_DEFAULTS[ALLOW_NEGATIVE_STOCK_KEY],
  );
}
export function autoReceiptOnPurchase(ctx: Context): Promise<boolean> {
  return getSetting(
    ctx,
    AUTO_RECEIPT_ON_PURCHASE_KEY,
    boolSettingSchema,
    INVENTORY_SETTING_DEFAULTS[AUTO_RECEIPT_ON_PURCHASE_KEY],
  );
}
export function autoIssueOnSales(ctx: Context): Promise<boolean> {
  return getSetting(
    ctx,
    AUTO_ISSUE_ON_SALES_KEY,
    boolSettingSchema,
    INVENTORY_SETTING_DEFAULTS[AUTO_ISSUE_ON_SALES_KEY],
  );
}

export const DEFAULT_WAREHOUSE_HINT = `Create a warehouse with that code (the inventory seed creates MAIN), mark one warehouse isDefault, or change ${DEFAULT_WAREHOUSE_KEY}.`;

/** The warehouse with the code in `inventory.default_warehouse`, else the one flagged isDefault; INVALID_STATE when neither exists. */
export async function resolveDefaultWarehouse(ctx: Context): Promise<Infer<typeof Warehouse>> {
  const code = await getSetting(
    ctx,
    DEFAULT_WAREHOUSE_KEY,
    warehouseCodeSchema,
    INVENTORY_SETTING_DEFAULTS[DEFAULT_WAREHOUSE_KEY],
  );
  const r = repo(ctx, Warehouse);
  const byCode = await r.list({ where: { code: code.trim().toUpperCase() }, limit: 1 });
  const found = byCode.items[0] ?? (await r.list({ where: { isDefault: true }, limit: 1 })).items[0];
  if (!found)
    throw new StateError(
      `no default warehouse: no warehouse has code ${code} and none is marked isDefault`,
      DEFAULT_WAREHOUSE_HINT,
      { setting: DEFAULT_WAREHOUSE_KEY, code },
    );
  return found;
}
