// Module manifest (docs/conventions/layers.md).
import { defineModule, label, registry } from '@daifuku/kernel';
import { resolveAction } from './actions/resolve.ts';
import { getSettingsAction, setSettingsAction } from './actions/settings.ts';
import { summarizeAction } from './actions/summarize.ts';
import { TaxRate } from './entities/tax-rate.ts';
import { registerNoOverlapHook } from './hooks/no-overlap.ts';
import { seedTaxRates } from './seeds/rates.ts';
import { TAX_SETTING_DEFS } from './services/settings.ts';

export const TaxModule = defineModule({
  name: 'tax',
  label: label('消費税', 'Tax'),
  depends: [],
  entities: [TaxRate],
  actions: [resolveAction, summarizeAction, getSettingsAction, setSettingsAction],
  hooks: () => {
    registerNoOverlapHook();
    for (const def of TAX_SETTING_DEFS) registry.registerSetting(def);
  },
  seed: seedTaxRates,
  menus: [{ label: label('税率', 'Tax rates'), entity: 'tax_rate', order: 30 }],
  roles: {
    accounting: label('経理', 'Accounting'),
    settings: label('設定管理', 'Settings'),
  },
});
