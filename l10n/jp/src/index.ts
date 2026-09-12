// @daifuku/l10n-jp public API. Importing this package registers the `l10n_jp` module (after accounting and tax) and its
// overrides for `purchase.exempt_supplier_credit_ratio` and `sales.invoice_html`.
export { JapanModule, seedJapan, registerJapanOverrides } from './module.ts';

export { JP_CHART_OF_ACCOUNTS, seedChartOfAccounts, type SeedAccount } from './seeds/chart-of-accounts.ts';
export { JP_DEFAULT_SETTINGS, JP_TAX_ROUNDING_DEFAULT, JP_PRICE_INCLUDES_TAX_DEFAULT, seedDefaultSettings, seedTaxRatesIfMissing, type DefaultSetting } from './seeds/settings.ts';

export {
  EXEMPT_SUPPLIER_CREDIT_RATIO_OVERRIDE,
  EXEMPT_SUPPLIER_CREDIT_RATIOS,
  FULL_CREDIT,
  SUPPLIER_TAX_STATUSES,
  exemptSupplierCreditRatio,
  transitionalCreditRatio,
  type CreditRatioPeriod,
  type ExemptSupplierCreditRatioFn,
  type ExemptSupplierCreditRatioInput,
  type SupplierTaxStatus,
} from './services/transitional-credit.ts';
export { ERAS, toWareki, toWarekiParts, formatDateJa, type Era, type WarekiParts } from './services/wareki.ts';
export { formatJpy, formatNumber, formatRatePercent, toHalfwidthKana } from './services/format.ts';
export { INVOICE_HTML_OVERRIDE, invoiceRenderDataSchema, type InvoiceRenderData, type InvoiceHtmlRenderer, type ParsedInvoiceRenderData } from './services/invoice-render-data.ts';
export { renderInvoiceHtml, parseInvoiceRenderData, escapeHtml, REDUCED_CATEGORY, REDUCED_MARK } from './services/invoice-html.ts';

export { JAPAN_FILING_PROFILES, registerJapanFilingProfiles } from './filing/profiles.ts';
