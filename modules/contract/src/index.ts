// @daifuku/mod-contract public API (docs/specs/contract.md). Importing this module registers the contract document, its
// lines, the contract_billing ledger, the generate/end/schedule actions, hooks and settings.
// Packs (real-estate) create contracts through the generic `contract.create { ..., lines: { contract_line: [...] } }`
// + `contract.submit`, bill with `contract.generate_invoices { period }` and read `contract.schedule { period }`.
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { Contract } from './entities/contract.ts';
import type { ContractBilling } from './entities/contract-billing.ts';
import type { ContractLine } from './entities/contract-line.ts';

export { ContractModule } from './module.ts';
export { Contract, CONTRACT_STATUSES, CONTRACT_ROUNDING_MODES, type ContractStatus } from './entities/contract.ts';
export { ContractLine } from './entities/contract-line.ts';
export { ContractBilling } from './entities/contract-billing.ts';

export {
  generateInvoicesAction,
  generateInvoices,
  generateInvoicesInput,
  generateInvoicesOutput,
  invoiceNote,
  periodInput,
  INVOICE_GENERATED_EVENT,
  type GenerateInvoicesInput,
  type GenerateInvoicesResult,
} from './actions/generate-invoices.ts';
export { endContractAction, endContract, endContractInput, END_STATE_HINT, type EndContractInput } from './actions/end.ts';
export { scheduleAction, contractSchedule, scheduleInput, SCHEDULE_COLUMNS, type ScheduleInput, type ScheduleRow } from './actions/schedule.ts';

export { SYSTEM_OWNED_FIELDS, DATE_RANGE_HINT, assertDateRange } from './hooks/recalc.ts';
export { FROZEN_HINT } from './hooks/lines.ts';
export { NO_LINES_HINT } from './hooks/submit.ts';
export { LIVE_INVOICES_HINT } from './hooks/cancel.ts';
export { LEDGER_HINT } from './hooks/billing.ts';
export { isBillingWrite } from './ledger.ts';

export {
  PERIOD_PATTERN,
  END_OF_MONTH,
  BILLING_TIMINGS,
  BILLABLE_STATUSES,
  DUE_SKIP_REASONS,
  daysInMonth,
  isPeriod,
  parsePeriod,
  formatPeriod,
  periodOf,
  addMonths,
  monthsBetween,
  daysInPeriod,
  periodStart,
  periodEnd,
  coveredPeriods,
  billingDate,
  isAligned,
  statusFor,
  dueReason,
  nextPeriodOf,
  type Period,
  type BillingTiming,
  type DueSkipReason,
  type DueTerms,
} from './services/periods.ts';
export {
  PRORATION_RULES,
  ZERO,
  ONE,
  fraction,
  addFractions,
  isFullFactor,
  formatFraction,
  coveredDays,
  monthFactor,
  periodFactor,
  prorate,
  type ProrationRule,
  type Fraction,
} from './services/proration.ts';
export { planPeriod, SKIP_REASONS, PLAN_STATUSES, type SkipReason, type PlanStatus, type ContractTerms, type TermLine, type PlannedLine, type PeriodPlan, type DuePlan, type PlanInput } from './services/plan.ts';

export {
  CONTRACT_DEFAULT_PRORATION_KEY,
  CONTRACT_AUTO_SUBMIT_KEY,
  contractDefaultProrationSchema,
  contractAutoSubmitSchema,
  CONTRACT_DEFAULT_PRORATION_DEFAULT,
  CONTRACT_AUTO_SUBMIT_DEFAULT,
  CONTRACT_SETTING_DEFS,
} from './settings.ts';

export type ContractRow = Infer<typeof Contract>;
export type ContractInsert = InsertInput<typeof Contract>;
export type ContractUpdate = UpdateInput<typeof Contract>;
export type ContractLineRow = Infer<typeof ContractLine>;
export type ContractLineInsert = InsertInput<typeof ContractLine>;
export type ContractBillingRow = Infer<typeof ContractBilling>;
