// Company settings owned by accounting (ADR-0013 L1). `accounting.opening_balances` names the opening balance clearing
// account by code (docs/specs/opening-balances.md AC-28): data, not a constant (l10n/jp seeds 3900 期首残高仮勘定).
import { getSetting, label, registry, type Context, type SettingDef } from '@daifuku/kernel';
import { z } from 'zod';

export const OPENING_BALANCES_KEY = 'accounting.opening_balances';

export const openingBalancesSchema = z.object({ clearingAccount: z.string().min(1).max(20) });
export type OpeningBalancesSetting = z.output<typeof openingBalancesSchema>;
export const OPENING_BALANCES_DEFAULT: OpeningBalancesSetting = { clearingAccount: '3900' };

export const ACCOUNTING_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: OPENING_BALANCES_KEY,
    label: label('期首残高の取込', 'Opening balance import'),
    description: label(
      '期首残高の取込（/finance/opening）で、開始仕訳の取引先なしの売掛金・買掛金の行と期首請求書の相手科目に使う期首残高仮勘定',
      'Clearing account used by the opening balance import (/finance/opening) for partner-less receivable/payable rows of the opening journal and as the counter account of opening invoices',
    ),
    schema: openingBalancesSchema,
    default: OPENING_BALANCES_DEFAULT,
    category: 'accounting',
    order: 50,
    fields: {
      clearingAccount: {
        label: label('期首残高仮勘定', 'Opening balance clearing account'),
        description: label(
          '純資産・負債・資産の科目で、取引先必須でなく税の役割が「なし」のもの（既定 3900）',
          'A balance-sheet account that requires no partner and has no tax role (default 3900)',
        ),
        widget: 'account-code',
      },
    },
  },
];

export function registerAccountingSettings(): void {
  for (const def of ACCOUNTING_SETTING_DEFS) registry.registerSetting(def);
}

export function openingBalancesSetting(ctx: Context): Promise<OpeningBalancesSetting> {
  return getSetting(ctx, OPENING_BALANCES_KEY, openingBalancesSchema, OPENING_BALANCES_DEFAULT);
}
