// Setup health check of the inventory module (docs/specs/setup-health.md AC-5): with automatic receipt / issue from
// invoices on, the default warehouse resolves (as resolveDefaultWarehouse does when an invoice is submitted), and the
// company has goods to keep in stock; otherwise point non-inventory businesses at the switch.
import { getSetting, label, repo, type HealthCheckDef } from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { Warehouse } from './entities/warehouse.ts';
import {
  autoIssueOnSales,
  autoReceiptOnPurchase,
  DEFAULT_WAREHOUSE_KEY,
  INVENTORY_SETTING_DEFAULTS,
  warehouseCodeSchema,
} from './settings.ts';

const INVENTORY_TAB = '/settings?tab=inventory';

export const stockSettingsHealthCheck: HealthCheckDef = {
  id: 'inventory.stock_settings',
  label: label('在庫の設定', 'Inventory settings'),
  order: 50,
  run: async (ctx) => {
    const receipt = await autoReceiptOnPurchase(ctx);
    const issue = await autoIssueOnSales(ctx);
    if (!receipt && !issue)
      return {
        status: 'ok',
        detail: label(
          '請求書からの自動入出庫は使っていません（在庫を使わない運用）。',
          'Automatic stock movements from invoices are off (no inventory in use).',
        ),
        href: INVENTORY_TAB,
      };
    const code = (
      await getSetting(
        ctx,
        DEFAULT_WAREHOUSE_KEY,
        warehouseCodeSchema,
        INVENTORY_SETTING_DEFAULTS[DEFAULT_WAREHOUSE_KEY],
      )
    )
      .trim()
      .toUpperCase();
    const warehouses = repo(ctx, Warehouse);
    const byCode = (await warehouses.list({ where: { code }, limit: 1 })).items[0];
    const fallback = byCode ? undefined : (await warehouses.list({ where: { isDefault: true }, limit: 1 })).items[0];
    if (!byCode && !fallback)
      return {
        status: 'fail',
        detail: label(
          `既定の倉庫コード ${code} の倉庫も、既定に指定した倉庫もありません。物品の請求書を確定できません。`,
          `No warehouse has the default code ${code} and none is marked default. Invoices with goods cannot be submitted.`,
        ),
        href: '/e/warehouse',
      };
    const goods = await repo(ctx, Product).count({ kind: 'goods', isActive: true });
    if (goods === 0)
      return {
        status: 'warn',
        detail: label(
          '自動入出庫が有効ですが、有効な物品の品目がありません。在庫を使わない業種なら、在庫タブで自動入出庫を止めてください。',
          'Automatic stock movements are on but there are no active goods. If the business keeps no stock, turn them off on the Inventory tab.',
        ),
        href: INVENTORY_TAB,
      };
    if (!byCode && fallback)
      return {
        status: 'warn',
        detail: label(
          `既定の倉庫コード ${code} の倉庫が無いため、既定に指定した倉庫 ${fallback.code} を使います。`,
          `No warehouse has the default code ${code}, so the warehouse marked default (${fallback.code}) is used.`,
        ),
        href: INVENTORY_TAB,
      };
    return {
      status: 'ok',
      detail: label(
        `自動入出庫は既定の倉庫 ${code} を使います（有効な物品 ${goods} 件）。`,
        `Automatic stock movements use the default warehouse ${code} (${goods} active goods).`,
      ),
      href: '/e/warehouse',
    };
  },
};
