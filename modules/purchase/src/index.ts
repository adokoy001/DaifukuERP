// @daifuku/mod-purchase public API. Importing this module registers the purchase entities, actions, hooks and settings.
// Other modules: `applyPayment(ctx, { invoiceId, amount, date })` records a payment (no posting); l10n packs override the
// credit ratio with `registry.registerOverride(PURCHASE_CREDIT_RATIO_POINT, fn: CreditRatioFn)` (by name, no import needed).
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { PurchaseInvoice } from './entities/purchase-invoice.ts';
import type { PurchaseInvoiceLine } from './entities/purchase-invoice-line.ts';

export { PurchaseModule } from './module.ts';
export { PurchaseInvoice, INVOICE_STATUSES, type InvoiceStatus } from './entities/purchase-invoice.ts';
export { PurchaseInvoiceLine } from './entities/purchase-invoice-line.ts';

export { apAgingAction, AP_AGING_COLUMNS } from './actions/ap-aging.ts';
export {
  applyPayment,
  recordPaymentAction,
  PAYMENT_APPLIED_EVENT,
  type ApplyPaymentInput,
} from './actions/record-payment.ts';

export {
  PURCHASE_CREDIT_RATIO_POINT,
  SUPPLIER_TAX_STATUSES,
  FULL_CREDIT,
  NO_CREDIT,
  defaultCreditRatio,
  assertCreditRatio,
  isSupplierTaxStatus,
  type CreditRatioFn,
  type CreditRatioInput,
  type SupplierTaxStatus,
} from './services/credit-ratio.ts';
export {
  lineAmount,
  splitTax,
  applyCreditRatio,
  calculationToJson,
  type TaxSummaryLike,
  type CreditGroup,
  type PurchaseTotals,
  type PurchaseCalculation,
  type TaxSummaryJson,
} from './services/recalculate.ts';
export {
  buildJournalLines,
  lineAccount,
  NON_DEDUCTIBLE_MEMO,
  INPUT_TAX_MEMO,
  type PostingLine,
  type PostingAccounts,
  type PostingInput,
} from './services/posting.ts';
export {
  agingBucket,
  agingRows,
  daysBetween,
  AGING_BUCKETS,
  type AgingBucket,
  type AgingBill,
  type AgingPartner,
  type AgingRow,
} from './services/aging.ts';
export { applyPaymentAmounts, isPaymentIssue, type PaymentResult, type PaymentIssue } from './services/payment.ts';

export {
  PURCHASE_ACCOUNTS_KEY,
  purchaseAccountsSchema,
  PURCHASE_ACCOUNTS_DEFAULT,
  PURCHASE_SETTING_DEFS,
  loadPurchaseAccountCodes,
  resolvePostingAccounts,
  type PurchaseAccountCodes,
} from './settings.ts';
export {
  computeInvoice,
  loadInvoiceLines,
  loadSupplier,
  resolveCreditRatio,
  recalculateInvoice,
  type InvoiceHead,
  type InvoiceComputation,
  type InvoiceLineRow,
} from './hooks/recalc.ts';
export { LINE_SOURCE_HINT } from './hooks/lines.ts';
export { NO_LINES_HINT, entryDescription } from './hooks/submit.ts';
export { PAID_CANCEL_HINT } from './hooks/cancel.ts';

export type PurchaseInvoiceRow = Infer<typeof PurchaseInvoice>;
export type PurchaseInvoiceInsert = InsertInput<typeof PurchaseInvoice>;
export type PurchaseInvoiceUpdate = UpdateInput<typeof PurchaseInvoice>;
export type PurchaseInvoiceLineRow = Infer<typeof PurchaseInvoiceLine>;
export type PurchaseInvoiceLineInsert = InsertInput<typeof PurchaseInvoiceLine>;
export type PurchaseInvoiceLineUpdate = UpdateInput<typeof PurchaseInvoiceLine>;

export { PurchaseSettlement } from './entities/settlement.ts';
export { invoiceBalancesAsOf } from './settlements.ts';
