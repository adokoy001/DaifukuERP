// @daifuku/mod-payment public API. Importing this module registers the payment document, its allocation lines, the
// outstanding report, hooks and settings. Payments apply to sales/purchase invoices through their `applyPayment` and
// post through accounting `postFromSource` in the submitting user's context (roles: docs/specs/payment.md AC-6).
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { Payment } from './entities/payment.ts';
import type { PaymentAllocation } from './entities/payment-allocation.ts';

export { PaymentModule } from './module.ts';
export {
  Payment,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  type PaymentDirection,
  type PaymentMethod,
} from './entities/payment.ts';
export { PaymentAllocation, INVOICE_ENTITIES, type InvoiceEntity } from './entities/payment-allocation.ts';

export {
  outstandingAction,
  outstanding,
  outstandingInput,
  outstandingColumns,
  type OutstandingInput,
} from './actions/outstanding.ts';
export {
  loadInvoice,
  loadInvoices,
  listOpenInvoices,
  applyInvoicePayment,
  type OpenInvoice,
  type ApplyInput,
} from './invoices.ts';

export {
  invoiceEntityFor,
  directionOf,
  roleAllowsDirection,
  rolesForDirection,
  isOpenInvoice,
  allocatedOf,
  unallocatedOf,
  tryDecimal,
  lineIssues,
  validateAllocations,
  type InvoiceSnapshot,
  type AllocationLine,
  type AllocationIssue,
  type AllocationInput,
  type AllocationResult,
} from './services/allocate.ts';
export {
  journalLinesFor,
  imbalance,
  entryDescription,
  MEMO,
  type JournalLineSpec,
  type PostingAllocation,
  type PostingInput,
} from './services/posting.ts';

export { assertDirectionRole, SYSTEM_OWNED_FIELDS, DIRECTION_HINT } from './hooks/validate.ts';
export { FROZEN_HINT } from './hooks/lines.ts';
export { ALLOCATION_HINT, loadAllocationLines } from './hooks/submit.ts';

export {
  PAYMENT_ACCOUNTS_KEY,
  paymentAccountsSchema,
  PAYMENT_ACCOUNTS_DEFAULT,
  PAYMENT_SETTING_DEFS,
  ACCOUNTS_HINT,
  loadPaymentAccountCodes,
  resolvePostingAccounts,
  defaultAccountCodeFor,
  defaultAccountIdFor,
  type PaymentAccountCodes,
  type PostingAccounts,
} from './settings.ts';

export type PaymentRow = Infer<typeof Payment>;
export type PaymentInsert = InsertInput<typeof Payment>;
export type PaymentUpdate = UpdateInput<typeof Payment>;
export type PaymentAllocationRow = Infer<typeof PaymentAllocation>;
export type PaymentAllocationInsert = InsertInput<typeof PaymentAllocation>;
export type PaymentAllocationUpdate = UpdateInput<typeof PaymentAllocation>;
