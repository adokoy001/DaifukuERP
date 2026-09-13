// @daifuku/mod-accounting public API. Importing this module registers the ledger entities, actions and hooks.
// Other modules post through `postFromSource` / `reverseEntry` in-process (same transaction, caller's permissions).
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { Account } from './entities/account.ts';
import type { FiscalPeriod } from './entities/fiscal-period.ts';
import type { FiscalYear } from './entities/fiscal-year.ts';
import type { JournalEntry } from './entities/journal-entry.ts';
import type { JournalLine } from './entities/journal-line.ts';

export { AccountingModule } from './module.ts';
export {
  Account,
  ACCOUNT_TYPES,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABELS,
  TAX_ROLES,
  TAX_ROLE_LABELS,
  type AccountType,
  type TaxCategory,
  type TaxRole,
} from './entities/account.ts';
export { FiscalYear } from './entities/fiscal-year.ts';
export { FiscalPeriod } from './entities/fiscal-period.ts';
export { JournalEntry } from './entities/journal-entry.ts';
export { JournalLine } from './entities/journal-line.ts';

export {
  openFiscalYear,
  openFiscalYearAction,
  type OpenFiscalYearInput,
  type OpenFiscalYearResult,
} from './actions/open-fiscal-year.ts';
export {
  postFromSource,
  postFromSourceAction,
  postFromSourceInput,
  liveEntriesForSource,
  type PostFromSourceInput,
} from './actions/post-from-source.ts';
export { reverseEntry, reverseEntryAction, REVERSED_EVENT, type ReverseEntryInput } from './actions/reverse-entry.ts';
export { trialBalanceAction, movementsByAccount, TRIAL_BALANCE_COLUMNS } from './actions/trial-balance.ts';
export { generalLedgerAction, GENERAL_LEDGER_COLUMNS } from './actions/general-ledger.ts';
export { taxPeriodSummaryAction, TAX_PERIOD_SUMMARY_COLUMNS } from './actions/tax-period-summary.ts';
export { closePeriodAction, reopenPeriodAction } from './actions/close-period.ts';
export {
  lineInput,
  entryWithLinesJson,
  createAndSubmitEntry,
  loadEntryWithLines,
  type LineInput,
  type EntryWithLines,
} from './actions/helpers.ts';
export { assertOpenPeriod, loadLines, PERIOD_HINT } from './hooks/validate-entry.ts';
export { NO_CANCEL_HINT } from './hooks/no-cancel.ts';
export { seedFiscalYear } from './seeds/fiscal-year.ts';

export {
  validateLines,
  xorIssue,
  sumLines,
  isBalanced,
  reverseLines,
  netByKey,
  MIN_LINES,
  type Issue,
  type LineAmounts,
  type LineCheck,
  type LineTotals,
  type LineValidation,
} from './services/balance.ts';
export {
  fiscalYearRange,
  fiscalYearCode,
  monthlyPeriods,
  rangesOverlap,
  rangeContains,
  isValidRange,
  isFirstOfMonth,
  daysInMonth,
  PERIODS_PER_YEAR,
  type DateRange,
  type PeriodSpec,
} from './services/periods.ts';
export {
  trialBalanceRows,
  splitOpening,
  runningBalances,
  TRIAL_BALANCE_AMOUNT_KEYS,
  type AccountInfo,
  type Movement,
  type TrialBalanceRow,
} from './services/ledger.ts';
export {
  taxSummaryRows,
  classifyGroup,
  formatRate,
  TAX_SIDES,
  UNCLASSIFIED,
  UNCLASSIFIED_LABEL,
  type TaxLineGroup,
  type TaxAccountInfo,
  type TaxSide,
  type TaxSummaryRow,
  type TaxSummaryTotals,
} from './services/tax-summary.ts';
// TableResult moved to the kernel (Phase 1.5); re-exported here so existing importers keep working.
export {
  tableResult,
  tableColumn,
  column,
  COLUMN_KINDS,
  MAX_REPORT_ROWS,
  type TableResult,
  type TableColumn,
  type ColumnKind,
} from '@daifuku/kernel';

export type AccountRow = Infer<typeof Account>;
export type AccountInsert = InsertInput<typeof Account>;
export type AccountUpdate = UpdateInput<typeof Account>;
export type FiscalYearRow = Infer<typeof FiscalYear>;
export type FiscalPeriodRow = Infer<typeof FiscalPeriod>;
export type JournalEntryRow = Infer<typeof JournalEntry>;
export type JournalEntryInsert = InsertInput<typeof JournalEntry>;
export type JournalLineRow = Infer<typeof JournalLine>;
export type JournalLineInsert = InsertInput<typeof JournalLine>;

export { reverseSourceEntry } from './actions/reverse-source.ts';
export { assertJpySettlement } from './money-contract.ts';
export { postingDimensions } from './dimensions.ts';
