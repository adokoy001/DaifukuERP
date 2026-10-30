// banking.cash_forecast / banking.cash_schedule (docs/specs/cash-forecast.md): the daily cash forecast and the
// schedule of expected receipts and payments. Read-only report actions. `tx: 'none'` only describes them: the action
// route still runs them in one read-committed transaction, so a payment committed between the ledger read and the
// invoice read can be counted twice or not at all in that one result (spec decision 13); the CSV goes through the
// existing POST /actions/<name>/export, one repeatable-read snapshot. Both actions read the scheduled items with the
// same function and place them with the same pure rules (AC-4).
import {
  Decimal,
  defineAction,
  label,
  tableResult,
  todayLocal,
  ValidationError,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';
import { buildCashPlan } from './cash-plan.ts';
import { loadCashLedger, loadPaymentNotes, loadScheduledItems, noticesFor, sourceStatuses } from './cash-sources.ts';
import { forecastResult, scheduleResult, type CashTableQuery } from './cash-tables.ts';
import {
  cashAddDays,
  cashForecastInput,
  CASH_MAX_AHEAD_DAYS,
  type CashForecastInput,
  type CashSource,
} from './contract.ts';
import { assertBankContext } from './internal.ts';

/** Every entity whose rows reach the result, re-checked for export by the CSV path (AC-16). */
export const CASH_EXPORT_ENTITIES = [
  'journal_line',
  'account',
  'bank_account',
  'partner',
  'payment',
  'sales_invoice',
  'purchase_invoice',
  'bank_transfer',
  'bank_transfer_reservation',
  'contract',
  'contract_line',
  'contract_billing',
  'tax_rate',
];

/** AC-13 boundary and the AC-17 check that needs today; nothing is read before both pass. */
function prepare(ctx: Context, input: CashForecastInput): CashTableQuery & { included: Set<CashSource> } {
  assertBankContext(ctx);
  const today: LocalDate = todayLocal(ctx.now());
  if (input.to > cashAddDays(today, CASH_MAX_AHEAD_DAYS))
    throw new ValidationError(
      `to must be at most ${CASH_MAX_AHEAD_DAYS} days after today`,
      [{ path: 'to', message: `終了日は今日から${CASH_MAX_AHEAD_DAYS}日以内にしてください。` }],
      'Choose an end date within two years from today.',
    );
  const sources = sourceStatuses(ctx);
  return {
    from: input.from,
    to: input.to,
    today,
    includeDrafts: input.includeDrafts === true,
    includeOverdue: input.includeOverdue === true,
    sources,
    included: new Set(sources.filter((s) => s.included).map((s) => s.source)),
  };
}

export async function cashForecast(ctx: Context, input: CashForecastInput) {
  const q = prepare(ctx, input);
  const included = q.included;
  const ledger = await loadCashLedger(ctx, q);
  const scheduled = await loadScheduledItems(ctx, q);
  const notes = await loadPaymentNotes(ctx, { to: q.to, cashAccountIds: ledger.cashAccountIds });
  const plan = buildCashPlan({
    ...q,
    ledgerBalance: ledger.ledgerBalance,
    posted: ledger.posted,
    items: scheduled.items,
  });
  return forecastResult(q, plan, {
    ledgerBalance: ledger.ledgerBalance,
    cashAccounts: ledger.cashAccounts,
    missingAccountCodes: ledger.missingAccountCodes,
    unscheduledPayroll: scheduled.unscheduledPayroll,
    contractBacklog: scheduled.contractBacklog,
    ...notes,
    notices: noticesFor(included),
  });
}

export async function cashSchedule(ctx: Context, input: CashForecastInput) {
  const q = prepare(ctx, input);
  const scheduled = await loadScheduledItems(ctx, q);
  const plan = buildCashPlan({ ...q, ledgerBalance: Decimal.zero(), posted: [], items: scheduled.items });
  return scheduleResult(q, plan);
}

const permission = { roles: ['accounting'] };

export const cashForecastAction = defineAction({
  name: 'banking.cash_forecast',
  description: label(
    '資金繰り表: from〜to の各日について、資金科目（payment.accounts の現金・普通預金と銀行口座の科目）の記帳済み入出金と、確定済みの売上請求・仕入請求の残高、支払ファイルの振込予定、契約の請求予定、給与の支払予定を並べ、期首残高からの残高を返します。期日超過は既定で残高に入れません（includeOverdue）。下書きは includeDrafts で別の列に出します。閲覧できない業務は含めません。',
    'Cash forecast: for each day from..to, posted cash movements of the cash accounts (payment.accounts cash/bank and bank account ledgers) plus the open balances of submitted sales and purchase invoices, scheduled bank transfers, contract billing and payroll payments, with the running balance from the opening balance. Overdue items stay out of the balance unless includeOverdue; drafts appear in separate columns with includeDrafts. Sources the caller cannot read are left out.',
  ),
  input: cashForecastInput,
  output: tableResult,
  exportEntities: CASH_EXPORT_ENTITIES,
  permission,
  tx: 'none',
  mutates: false,
  handler: cashForecast,
});

export const cashScheduleAction = defineAction({
  name: 'banking.cash_schedule',
  description: label(
    '入出金予定: 資金繰り表と同じ条件で、予定（売上請求・契約請求・仕入請求・振込予定・給与）を 1 件 1 行で返します。給与は支払日ごとの合計だけです。記帳済みの入出金は含みません。',
    'Cash schedule: the expected receipts and payments behind the cash forecast (sales invoices, contract billing, purchase invoices, scheduled transfers, payroll), one row each for the same input. Payroll is summed per payment date. Posted movements are not listed.',
  ),
  input: cashForecastInput,
  output: tableResult,
  exportEntities: CASH_EXPORT_ENTITIES,
  permission,
  tx: 'none',
  mutates: false,
  handler: cashSchedule,
});
