// Company settings owned by the contract module (spec AC-6; ADR-0013 L1). Keys, schemas and defaults are exported so
// packs (real-estate) and the generic settings UI read the same declaration.
import { getSetting, label, registry, type Context, type SettingDef } from '@daifuku/kernel';
import { z } from 'zod';
import { PRORATION_RULES, type ProrationRule } from './services/proration.ts';

export const CONTRACT_DEFAULT_PRORATION_KEY = 'contract.default_proration';
export const CONTRACT_AUTO_SUBMIT_KEY = 'contract.auto_submit';

export const contractDefaultProrationSchema = z.enum(PRORATION_RULES);
export const contractAutoSubmitSchema = z.boolean();

export const CONTRACT_DEFAULT_PRORATION_DEFAULT: ProrationRule = 'daily';
export const CONTRACT_AUTO_SUBMIT_DEFAULT = false;

export const CONTRACT_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: CONTRACT_DEFAULT_PRORATION_KEY,
    label: label('契約の日割り（既定）', 'Default contract proration'),
    description: label(
      '新しい契約の日割り方法の既定値。日割り = 当月の実日数で日割り、なし = 満額',
      'Default proration of new contracts. Daily = prorate by the actual days of the month; none = full price',
    ),
    schema: contractDefaultProrationSchema,
    default: CONTRACT_DEFAULT_PRORATION_DEFAULT,
    order: 10,
    valueLabels: {
      daily: label('日割り（当月の実日数）', 'Daily (actual days of the month)'),
      none: label('なし（満額）', 'None (full price)'),
    },
  },
  {
    key: CONTRACT_AUTO_SUBMIT_KEY,
    label: label('契約請求書を自動で確定', 'Auto-submit contract invoices'),
    description: label(
      '契約から請求書を作る操作（contract.generate_invoices）で確定の指定を省略したとき、作った請求書を確定するか',
      'Whether contract.generate_invoices submits the invoices it creates when `submit` is omitted',
    ),
    schema: contractAutoSubmitSchema,
    default: CONTRACT_AUTO_SUBMIT_DEFAULT,
    order: 20,
  },
];

export function registerContractSettings(): void {
  for (const def of CONTRACT_SETTING_DEFS) registry.registerSetting(def);
}

export function loadDefaultProration(ctx: Context): Promise<ProrationRule> {
  return getSetting(
    ctx,
    CONTRACT_DEFAULT_PRORATION_KEY,
    contractDefaultProrationSchema,
    CONTRACT_DEFAULT_PRORATION_DEFAULT,
  );
}

export function loadAutoSubmit(ctx: Context): Promise<boolean> {
  return getSetting(ctx, CONTRACT_AUTO_SUBMIT_KEY, contractAutoSubmitSchema, CONTRACT_AUTO_SUBMIT_DEFAULT);
}
