// @daifuku/mod-expense public API (docs/specs/expense-settlement.md, ADR-0039). Importing this module registers the
// settlement and advance documents, their hooks, the candidates/draft/todo actions, the `expense.accounts` setting and
// the `expense.accounts` health check. Submit posts through accounting `postFromSource` and pays through payment
// `createClearingPayment` in the submitting user's context; workforce expenses are settled through workforce's API.
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { ExpenseAdvance, ExpenseSettlement, ExpenseSettlementLine } from './entities/index.ts';

export { ExpenseModule } from './module.ts';
export * from './contract.ts';
export {
  ExpenseSettlement,
  ExpenseSettlementLine,
  ExpenseAdvance,
  KIND_LABELS,
  INVOICE_KIND_LABELS,
  BOOKS_ONLY_REASON_LABELS,
} from './entities/index.ts';
export { settlementCandidatesAction } from './actions/candidates.ts';
export { draftSettlementAction } from './actions/draft.ts';
export { todoAction } from './actions/todo.ts';
export { expenseAccountsHealthCheck, EXPENSE_ACCOUNTS_HREF, PURCHASE_ACCOUNTS_HREF } from './health.ts';
export {
  EXPENSE_ACCOUNTS_KEY,
  expenseAccountsSchema,
  EXPENSE_ACCOUNTS_DEFAULT,
  EXPENSE_SETTING_DEFS,
  loadExpenseAccountCodes,
  checkExpenseAccounts,
  resolveExpenseAccounts,
  type ExpenseAccountCodes,
  type ExpenseAccounts,
} from './settings.ts';
export {
  computeSettlementTax,
  creditRatioFor,
  spreadDown,
  spreadCapped,
  taxSummaryJson,
  type TaxLineInput,
  type TaxSettings,
  type LineTax,
  type RateGroup,
  type SettlementTax,
  type SettlementTotals,
} from './services/tax.ts';
export {
  settlementJournalLines,
  settlementAmounts,
  clearingPlan,
  type SettlementPostingInput,
  type PostingLine,
  type PostingGroup,
  type ClearingPlan,
  type SettlementAmounts,
} from './services/posting.ts';
export { invoiceIssues, type InvoiceIssue, type InvoiceFields } from './services/invoice.ts';
export { canSettle, requireSettlementRoles, refuseSelfSettlement } from './access.ts';
export { entryDescription, SUBMIT_HINT } from './hooks/settlement.ts';
export { advanceNote } from './hooks/advance.ts';

export type ExpenseSettlementRow = Infer<typeof ExpenseSettlement>;
export type ExpenseSettlementInsert = InsertInput<typeof ExpenseSettlement>;
export type ExpenseSettlementUpdate = UpdateInput<typeof ExpenseSettlement>;
export type ExpenseSettlementLineRow = Infer<typeof ExpenseSettlementLine>;
export type ExpenseAdvanceRow = Infer<typeof ExpenseAdvance>;
