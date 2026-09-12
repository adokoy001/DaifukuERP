// @daifuku/mod-sales public API. Importing this module registers the sales_invoice document, its lines, actions,
// hooks and settings. The payment module calls `applyPayment` in-process; l10n/jp replaces the HTML layout with
// registry.registerOverride('sales.invoice_html', renderer) using the InvoiceRenderData contract below.
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { SalesInvoice } from './entities/sales-invoice.ts';
import type { SalesInvoiceLine } from './entities/sales-invoice-line.ts';

export { SalesModule } from './module.ts';
export { SalesInvoice, INVOICE_STATUSES, type InvoiceStatus, type InvoiceTaxSummaryRow } from './entities/sales-invoice.ts';
export { SalesInvoiceLine } from './entities/sales-invoice-line.ts';

export { applyPayment, recordPaymentAction, PAYMENT_APPLIED_EVENT, type ApplyPaymentInput } from './actions/record-payment.ts';
export { renderInvoiceHtmlAction, buildInvoiceRenderData, loadIssuer, INVOICE_HTML_OVERRIDE } from './actions/render-invoice-html.ts';
export { arAgingAction, arAging, AR_AGING_COLUMNS } from './actions/ar-aging.ts';
export { recalculateInvoice, loadInvoiceLines, type RecalculateInput, type RecalculateResult } from './recalculate.ts';
export { resolvePostingAccounts, ACCOUNTS_HINT } from './hooks/submit.ts';
export { CANCEL_PAID_HINT } from './hooks/cancel.ts';
export { FROZEN_HINT } from './hooks/lines.ts';
export { SYSTEM_OWNED_FIELDS } from './hooks/recalc.ts';

export { defaultInvoiceHtml, escapeHtml, formatMoney, formatRate, REDUCED_MARK, type InvoiceRenderData, type InvoiceHtmlRenderer } from './services/render-html.ts';
export { lineAmount, tryDecimal, shapeSummary, totalsFrom, balanceOf, rateOfCategory, type InvoiceTotals, type SummaryLike } from './services/recalculate.ts';
export { journalLinesFor, imbalance, ratePercent, type PostingAccounts, type PostingInput, type PostingLine, type JournalLineSpec } from './services/posting.ts';
export { agingRows, agingTotals, bucketFor, daysBetween, emptyAmounts, AGING_BUCKETS, type AgingBucket, type AgingInput, type AgingRow, type AgingAmounts } from './services/aging.ts';

export {
  SALES_ACCOUNTS_KEY,
  SALES_ISSUER_KEY,
  salesAccountsSchema,
  salesIssuerSchema,
  SALES_ACCOUNTS_DEFAULT,
  SALES_SETTING_DEFS,
  type SalesAccounts,
  type SalesIssuer,
} from './settings.ts';

export type SalesInvoiceRow = Infer<typeof SalesInvoice>;
export type SalesInvoiceInsert = InsertInput<typeof SalesInvoice>;
export type SalesInvoiceUpdate = UpdateInput<typeof SalesInvoice>;
export type SalesInvoiceLineRow = Infer<typeof SalesInvoiceLine>;
export type SalesInvoiceLineInsert = InsertInput<typeof SalesInvoiceLine>;

export { SalesSettlement } from './entities/settlement.ts';
export { invoiceBalancesAsOf } from './settlements.ts';
export { postingDimensions } from '@daifuku/mod-accounting';
