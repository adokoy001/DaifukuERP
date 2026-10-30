// Module manifest (spec AC-6; ADR-0011). No entities of its own: the pack seeds data into accounting/tax and plugs into
// sales/purchase through named override points (ADR-0008) without importing those modules.
// Importing AccountingModule/TaxModule first registers them, which `depends` requires (docs/conventions/layers.md).
import { defineModule, label, registry, type Context } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { TaxFilingModule } from '@daifuku/mod-tax-filing';
import { WorkforceModule } from '@daifuku/mod-workforce';
import { PRINT_ERA_DATE_OVERRIDE } from '@daifuku/mod-print-layout';
import { registerJapanPayrollProvider } from './payroll/provider.ts';
import { registerJapanFilingProfiles } from './filing/profiles.ts';
import { TaxModule } from '@daifuku/mod-tax';
import { seedChartOfAccounts } from './seeds/chart-of-accounts.ts';
import { seedDefaultSettings, seedTaxRatesIfMissing } from './seeds/settings.ts';
import { INVOICE_HTML_OVERRIDE } from './services/invoice-render-data.ts';
import { renderInvoiceHtml } from './services/invoice-html.ts';
import { EXEMPT_SUPPLIER_CREDIT_RATIO_OVERRIDE, exemptSupplierCreditRatio } from './services/transitional-credit.ts';
import { toWareki } from './services/wareki.ts';
import { JAPAN_FIXED_ASSET_RULES_OVERRIDE, japanFixedAssetRules } from './fixed-assets/rules.ts';

/** Idempotent per company: tax rates (delegated), chart of accounts, then default settings. */
export async function seedJapan(ctx: Context): Promise<void> {
  await seedTaxRatesIfMissing(ctx);
  await seedChartOfAccounts(ctx);
  await seedDefaultSettings(ctx);
}

export function registerJapanOverrides(): void {
  registerJapanFilingProfiles();
  registerJapanPayrollProvider();
  registry.registerOverride(EXEMPT_SUPPLIER_CREDIT_RATIO_OVERRIDE, exemptSupplierCreditRatio);
  registry.registerOverride(INVOICE_HTML_OVERRIDE, renderInvoiceHtml);
  // print-templates AC-8: printed documents write the Japanese era through this override (ADR-0011: the era table
  // stays in l10n/jp). Called with one argument, so toWareki uses its default era table.
  registry.registerOverride(PRINT_ERA_DATE_OVERRIDE, (date: string) => toWareki(date));
  registry.registerOverride(JAPAN_FIXED_ASSET_RULES_OVERRIDE, japanFixedAssetRules);
}

export const JapanModule = defineModule({
  name: 'l10n_jp',
  label: label('日本ローカライズ', 'Japan localisation'),
  depends: [AccountingModule.name, TaxModule.name, TaxFilingModule.name, WorkforceModule.name],
  entities: [],
  hooks: registerJapanOverrides,
  seed: seedJapan,
});
