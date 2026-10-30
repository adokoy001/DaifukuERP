// TableResult shaping of the cash forecast (docs/specs/cash-forecast.md AC-1..AC-3, AC-11, AC-14): columns, rows as
// decimal strings, totals and meta. Pure: the actions pass the plan and the source/notice facts they read.
import { column, Decimal, label, MAX_REPORT_ROWS, type LocalDate, type TableResult } from '@daifuku/kernel';
import type { CashPlan, FlowSummary } from './cash-plan.ts';
import {
  CASH_SOURCES,
  CASH_SOURCE_COLUMN,
  type CashForecastMeta,
  type CashNotice,
  type CashScheduleMeta,
  type CashSource,
} from './contract.ts';

export interface SourceStatus {
  source: CashSource;
  included: boolean;
}

export interface CashTableQuery {
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  includeDrafts: boolean;
  includeOverdue: boolean;
  sources: readonly SourceStatus[];
}

export interface CashForecastFacts {
  ledgerBalance: Decimal;
  cashAccounts: readonly { accountId: string; code: string; name: string; balance: Decimal }[];
  missingAccountCodes: readonly string[];
  unscheduledPayroll?: { count: number; netPay: Decimal } | undefined;
  contractBacklog?: { count: number; subtotal: Decimal } | undefined;
  unallocated: { receive: { count: number; amount: Decimal }; pay: { count: number; amount: Decimal } };
  uncountedPaymentAccounts: readonly {
    accountId: string;
    code: string;
    name: string;
    count: number;
    receive: Decimal;
    pay: Decimal;
  }[];
  notices: readonly CashNotice[];
}

const SOURCE_COLUMN_LABEL: Record<CashSource, { ja: string; en: string }> = {
  sales_invoice: label('入金予定（売上請求）', 'Receivables due'),
  contract: label('入金予定（契約請求）', 'Contract billing due'),
  purchase_invoice: label('支払予定（仕入請求）', 'Payables due'),
  bank_transfer: label('支払予定（振込予定）', 'Scheduled transfers'),
  payroll: label('支払予定（給与）', 'Payroll'),
};

/** AC-1: the day columns; a source that is not included has no column (AC-14). */
export function forecastColumns(included: ReadonlySet<CashSource>, includeDrafts: boolean) {
  return [
    column('date', label('日付', 'Date'), 'date'),
    column('postedIn', label('記帳済み入金', 'Posted receipts'), 'decimal'),
    column('postedOut', label('記帳済み出金', 'Posted payments'), 'decimal'),
    ...CASH_SOURCES.filter((s) => included.has(s)).map((s) =>
      column(CASH_SOURCE_COLUMN[s], SOURCE_COLUMN_LABEL[s], 'decimal'),
    ),
    column('inflow', label('入金計', 'Total in'), 'decimal'),
    column('outflow', label('出金計', 'Total out'), 'decimal'),
    column('net', label('差引', 'Net'), 'decimal'),
    column('balance', label('残高', 'Balance'), 'decimal'),
    ...(includeDrafts
      ? [
          column('draftInflow', label('下書きの入金', 'Draft receipts'), 'decimal'),
          column('draftOutflow', label('下書きの出金', 'Draft payments'), 'decimal'),
          column('balanceWithDrafts', label('下書きを含む残高', 'Balance incl. drafts'), 'decimal'),
        ]
      : []),
  ];
}

export const SCHEDULE_COLUMNS = [
  column('date', label('予定日', 'Date'), 'date'),
  column('dueDate', label('期日', 'Due date'), 'date'),
  column('direction', label('区分', 'Direction'), 'text'),
  column('source', label('種類', 'Source'), 'text'),
  column('state', label('状態', 'State'), 'text'),
  column('overdue', label('期日超過', 'Overdue'), 'bool'),
  column('inBalance', label('残高に含む', 'In balance'), 'bool'),
  column('number', label('番号', 'Number'), 'text'),
  column('period', label('対象月', 'Period'), 'text'),
  column('partnerName', label('取引先', 'Partner'), 'text'),
  column('count', label('件数', 'Count'), 'int'),
  column('amount', label('金額', 'Amount'), 'decimal'),
  column('partnerId', label('取引先ID', 'Partner id'), 'ref', { ref: 'partner' }),
  column('salesInvoiceId', label('売上請求書', 'Sales invoice'), 'ref', { ref: 'sales_invoice' }),
  column('purchaseInvoiceId', label('仕入請求書', 'Purchase invoice'), 'ref', { ref: 'purchase_invoice' }),
  column('contractId', label('契約', 'Contract'), 'ref', { ref: 'contract' }),
];

const str = (d: Decimal) => d.toString();

function summaryJson(s: FlowSummary, includeDrafts: boolean) {
  return {
    count: s.count,
    inflow: str(s.inflow),
    outflow: str(s.outflow),
    ...(includeDrafts
      ? { draftCount: s.draftCount, draftInflow: str(s.draftInflow), draftOutflow: str(s.draftOutflow) }
      : {}),
  };
}

function baseMeta(q: CashTableQuery, plan: CashPlan) {
  return {
    from: q.from,
    to: q.to,
    today: q.today,
    includeDrafts: q.includeDrafts,
    includeOverdue: q.includeOverdue,
    sources: q.sources.map((s) =>
      s.included
        ? { source: s.source, included: true }
        : { source: s.source, included: false, reason: 'permission' as const },
    ),
    overdue: summaryJson(plan.overdue, q.includeDrafts),
    beforeFrom: summaryJson(plan.beforeFrom, q.includeDrafts),
  };
}

const SUM_KEYS = ['postedIn', 'postedOut', 'inflow', 'outflow', 'net'] as const;

/** AC-1/AC-2: banking.cash_forecast. */
export function forecastResult(q: CashTableQuery, plan: CashPlan, facts: CashForecastFacts): TableResult {
  const included = new Set(q.sources.filter((s) => s.included).map((s) => s.source));
  const sourceKeys = CASH_SOURCES.filter((s) => included.has(s));
  const rows = plan.days.map((day) => ({
    date: day.date,
    postedIn: str(day.postedIn),
    postedOut: str(day.postedOut),
    ...Object.fromEntries(sourceKeys.map((s) => [CASH_SOURCE_COLUMN[s], str(day.scheduled[s])])),
    inflow: str(day.inflow),
    outflow: str(day.outflow),
    net: str(day.net),
    balance: str(day.balance),
    ...(q.includeDrafts
      ? {
          draftInflow: str(day.draftInflow),
          draftOutflow: str(day.draftOutflow),
          balanceWithDrafts: str(day.balanceWithDrafts),
        }
      : {}),
  }));
  const sum = (pick: (day: CashPlan['days'][number]) => Decimal) => str(Decimal.sum(plan.days.map(pick)));
  const totals: Record<string, string> = {
    ...Object.fromEntries(SUM_KEYS.map((k) => [k, sum((day) => day[k])])),
    ...Object.fromEntries(sourceKeys.map((s) => [CASH_SOURCE_COLUMN[s], sum((day) => day.scheduled[s])])),
    balance: str(plan.closingBalance),
    openingBalance: str(plan.openingBalance),
    ...(q.includeDrafts
      ? {
          draftInflow: sum((day) => day.draftInflow),
          draftOutflow: sum((day) => day.draftOutflow),
          balanceWithDrafts: str(plan.closingBalanceWithDrafts),
          openingBalanceWithDrafts: str(plan.openingBalanceWithDrafts),
        }
      : {}),
  };
  const meta: CashForecastMeta = {
    ...baseMeta(q, plan),
    openingBalance: str(plan.openingBalance),
    openingBasis: plan.openingBasis,
    ledgerBalance: str(facts.ledgerBalance),
    closingBalance: str(plan.closingBalance),
    ...(q.includeDrafts
      ? {
          openingBalanceWithDrafts: str(plan.openingBalanceWithDrafts),
          closingBalanceWithDrafts: str(plan.closingBalanceWithDrafts),
        }
      : {}),
    minBalance: { date: plan.minBalance.date, balance: str(plan.minBalance.balance) },
    cashAccounts: facts.cashAccounts.map((a) => ({ ...a, balance: str(a.balance) })),
    missingAccountCodes: [...facts.missingAccountCodes],
    ...(facts.unscheduledPayroll
      ? { unscheduledPayroll: { count: facts.unscheduledPayroll.count, netPay: str(facts.unscheduledPayroll.netPay) } }
      : {}),
    ...(facts.contractBacklog
      ? { contractBacklog: { count: facts.contractBacklog.count, subtotal: str(facts.contractBacklog.subtotal) } }
      : {}),
    unallocated: {
      receive: { count: facts.unallocated.receive.count, amount: str(facts.unallocated.receive.amount) },
      pay: { count: facts.unallocated.pay.count, amount: str(facts.unallocated.pay.amount) },
    },
    uncountedPaymentAccounts: facts.uncountedPaymentAccounts.map((a) => ({
      ...a,
      receive: str(a.receive),
      pay: str(a.pay),
    })),
    notices: [...facts.notices],
    truncated: false,
  };
  return {
    title: label(`資金繰り表 ${q.from}〜${q.to}`, `Cash forecast ${q.from}..${q.to}`),
    columns: forecastColumns(included, q.includeDrafts),
    rows,
    totals,
    meta,
  };
}

/** AC-3: banking.cash_schedule (first 10,000 rows; totals over every row). */
export function scheduleResult(q: CashTableQuery, plan: CashPlan): TableResult {
  const zero = Decimal.zero();
  let inflow = zero;
  let outflow = zero;
  let overdueInflow = zero;
  let overdueOutflow = zero;
  let draftInflow = zero;
  let draftOutflow = zero;
  for (const row of plan.rows) {
    const inbound = row.direction === 'in';
    if (row.state === 'draft') {
      if (inbound) draftInflow = draftInflow.plus(row.amount);
      else draftOutflow = draftOutflow.plus(row.amount);
      continue;
    }
    if (row.inBalance) {
      if (inbound) inflow = inflow.plus(row.amount);
      else outflow = outflow.plus(row.amount);
    }
    if (row.overdue) {
      if (inbound) overdueInflow = overdueInflow.plus(row.amount);
      else overdueOutflow = overdueOutflow.plus(row.amount);
    }
  }
  const rows = plan.rows.slice(0, MAX_REPORT_ROWS).map((row) => ({
    date: row.date,
    dueDate: row.documentDueDate ?? row.dueDate,
    direction: row.direction,
    source: row.source,
    state: row.state,
    overdue: row.overdue,
    inBalance: row.inBalance,
    number: row.number,
    period: row.period,
    partnerName: row.partnerName,
    count: row.count,
    amount: str(row.amount),
    partnerId: row.partnerId,
    salesInvoiceId: row.salesInvoiceId,
    purchaseInvoiceId: row.purchaseInvoiceId,
    contractId: row.contractId,
  }));
  const meta: CashScheduleMeta = {
    ...baseMeta(q, plan),
    truncated: plan.rows.length > MAX_REPORT_ROWS,
    rowCount: plan.rows.length,
  };
  return {
    title: label(`入出金予定 ${q.from}〜${q.to}`, `Cash schedule ${q.from}..${q.to}`),
    columns: SCHEDULE_COLUMNS,
    rows,
    totals: {
      inflow: str(inflow),
      outflow: str(outflow),
      overdueInflow: str(overdueInflow),
      overdueOutflow: str(overdueOutflow),
      ...(q.includeDrafts ? { draftInflow: str(draftInflow), draftOutflow: str(draftOutflow) } : {}),
    },
    meta,
  };
}
