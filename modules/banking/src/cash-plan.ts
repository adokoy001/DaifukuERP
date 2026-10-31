// Pure cash-forecast planning (docs/specs/cash-forecast.md D-3..D-7, AC-1..AC-4, AC-8..AC-12, AC-28).
// Inputs are the posted cash movements per journal entry, the scheduled items of the included sources, the ledger
// balance before `from`, today and the two flags; the output is the material of both report tables: one row per day
// (posted + placed scheduled amounts, running balance) and the schedule rows in their documented order. Money is
// Decimal throughout; dates are LocalDate strings compared as text. No database, clock or locale here.
import { Decimal, type LocalDate } from '@daifuku/kernel';
import { CASH_SOURCES, CASH_SOURCE_DIRECTION, cashAddDays, type CashSource, type CashState } from './contract.ts';

/** Σdebit / Σcredit of the cash-account lines of one posted journal entry (D-3). */
export interface PostedEntry {
  entryDate: LocalDate;
  entryId: string;
  debit: Decimal;
  credit: Decimal;
}

/** One scheduled item before placement (D-4, D-7). `amount` is positive in the source's direction. */
export interface PlannedItem {
  source: CashSource;
  state: CashState;
  /** The scheduled date (予定日) the placement rules use: a reserved purchase invoice's transfer date. */
  dueDate: LocalDate;
  /** The document's own due date when it differs from the scheduled date (reserved purchase invoices), else null. */
  documentDueDate: LocalDate | null;
  amount: Decimal;
  count: number;
  number: string | null;
  period: string | null;
  partnerId: string | null;
  partnerName: string | null;
  salesInvoiceId: string | null;
  purchaseInvoiceId: string | null;
  contractId: string | null;
  /** Stable tiebreaker (document id, contract id + period, payment date). */
  key: string;
}

export interface CashPlanInput {
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  includeDrafts: boolean;
  includeOverdue: boolean;
  ledgerBalance: Decimal;
  posted: readonly PostedEntry[];
  items: readonly PlannedItem[];
}

export type Placement =
  | { kind: 'excluded' }
  | { kind: 'day'; date: LocalDate; overdue: boolean }
  | { kind: 'before'; date: LocalDate; overdue: boolean }
  | { kind: 'unplaced'; overdue: true };

/** D-5: where a scheduled item goes. */
export function placeItem(
  item: Pick<PlannedItem, 'source' | 'dueDate'>,
  q: Pick<CashPlanInput, 'from' | 'to' | 'today' | 'includeOverdue'>,
): Placement {
  const d = item.dueDate;
  if (d > q.to) return { kind: 'excluded' };
  let date: LocalDate;
  let overdue = false;
  if (d >= q.today) date = d;
  else {
    if (item.source === 'payroll') return { kind: 'excluded' };
    overdue = true;
    if (!q.includeOverdue || q.today > q.to) return { kind: 'unplaced', overdue: true };
    date = q.today;
  }
  return date < q.from ? { kind: 'before', date, overdue } : { kind: 'day', date, overdue };
}

export interface CashDay {
  date: LocalDate;
  postedIn: Decimal;
  postedOut: Decimal;
  /** Submitted scheduled amounts per source (the direction is the source's). */
  scheduled: Record<CashSource, Decimal>;
  draftInflow: Decimal;
  draftOutflow: Decimal;
  inflow: Decimal;
  outflow: Decimal;
  net: Decimal;
  balance: Decimal;
  balanceWithDrafts: Decimal;
}

export interface FlowSummary {
  count: number;
  inflow: Decimal;
  outflow: Decimal;
  draftCount: number;
  draftInflow: Decimal;
  draftOutflow: Decimal;
}

export interface ScheduleItemRow extends PlannedItem {
  date: LocalDate;
  direction: 'in' | 'out';
  overdue: boolean;
  inBalance: boolean;
  /** 0 = placed in from..to, 1 = overdue and not placed. */
  group: 0 | 1;
}

export interface CashPlan {
  days: CashDay[];
  openingBalance: Decimal;
  openingBalanceWithDrafts: Decimal;
  closingBalance: Decimal;
  closingBalanceWithDrafts: Decimal;
  openingBasis: 'ledger' | 'projected';
  minBalance: { date: LocalDate; balance: Decimal };
  overdue: FlowSummary;
  beforeFrom: FlowSummary;
  /** Schedule rows in the documented order (AC-3), not truncated. */
  rows: ScheduleItemRow[];
}

const zero = () => Decimal.zero();
const emptySummary = (): FlowSummary => ({
  count: 0,
  inflow: zero(),
  outflow: zero(),
  draftCount: 0,
  draftInflow: zero(),
  draftOutflow: zero(),
});

function addToSummary(summary: FlowSummary, item: PlannedItem): void {
  const inbound = CASH_SOURCE_DIRECTION[item.source] === 'in';
  if (item.state === 'draft') {
    summary.draftCount += 1;
    if (inbound) summary.draftInflow = summary.draftInflow.plus(item.amount);
    else summary.draftOutflow = summary.draftOutflow.plus(item.amount);
  } else {
    summary.count += 1;
    if (inbound) summary.inflow = summary.inflow.plus(item.amount);
    else summary.outflow = summary.outflow.plus(item.amount);
  }
}

/** D-3: an entry's net cash movement; 0 (a transfer between cash accounts) moves nothing. */
export function postedFlow(entry: Pick<PostedEntry, 'debit' | 'credit'>): { inflow: Decimal; outflow: Decimal } {
  const net = entry.debit.minus(entry.credit);
  return net.isNegative() ? { inflow: zero(), outflow: net.neg() } : { inflow: net, outflow: zero() };
}

/** Every date from `from` to `to`, both included. */
export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = cashAddDays(d, 1)) out.push(d);
  return out;
}

const SOURCE_ORDER = new Map<CashSource, number>(CASH_SOURCES.map((s, i) => [s, i]));
const textOrder = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

/** AC-3: placed rows first, then overdue rows that were not placed; inside each by date, direction, source, state, number. */
export function compareScheduleRows(a: ScheduleItemRow, b: ScheduleItemRow): number {
  return (
    a.group - b.group ||
    textOrder(a.date, b.date) ||
    (a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1) ||
    (SOURCE_ORDER.get(a.source) ?? 0) - (SOURCE_ORDER.get(b.source) ?? 0) ||
    (a.state === b.state ? 0 : a.state === 'submitted' ? -1 : 1) ||
    textOrder(a.number, b.number) ||
    textOrder(a.period, b.period) ||
    textOrder(a.key, b.key)
  );
}

export function buildCashPlan(input: CashPlanInput): CashPlan {
  const dates = datesBetween(input.from, input.to);
  const index = new Map(dates.map((d, i) => [d, i]));
  const days: CashDay[] = dates.map((date) => ({
    date,
    postedIn: zero(),
    postedOut: zero(),
    scheduled: Object.fromEntries(CASH_SOURCES.map((s) => [s, zero()])) as Record<CashSource, Decimal>,
    draftInflow: zero(),
    draftOutflow: zero(),
    inflow: zero(),
    outflow: zero(),
    net: zero(),
    balance: zero(),
    balanceWithDrafts: zero(),
  }));
  for (const entry of input.posted) {
    const day = days[index.get(entry.entryDate) ?? -1];
    if (!day) continue;
    const flow = postedFlow(entry);
    day.postedIn = day.postedIn.plus(flow.inflow);
    day.postedOut = day.postedOut.plus(flow.outflow);
  }
  const overdue = emptySummary();
  const beforeFrom = emptySummary();
  const rows: ScheduleItemRow[] = [];
  for (const item of input.items) {
    if (item.state === 'draft' && !input.includeDrafts) continue;
    const placed = placeItem(item, input);
    if (placed.kind === 'excluded') continue;
    if (placed.overdue) addToSummary(overdue, item);
    const direction = CASH_SOURCE_DIRECTION[item.source];
    if (placed.kind === 'before') {
      addToSummary(beforeFrom, item);
      continue;
    }
    if (placed.kind === 'unplaced') {
      rows.push({ ...item, date: item.dueDate, direction, overdue: true, inBalance: false, group: 1 });
      continue;
    }
    const day = days[index.get(placed.date) ?? -1];
    if (!day) continue;
    const submitted = item.state === 'submitted';
    if (submitted) day.scheduled[item.source] = day.scheduled[item.source].plus(item.amount);
    else if (direction === 'in') day.draftInflow = day.draftInflow.plus(item.amount);
    else day.draftOutflow = day.draftOutflow.plus(item.amount);
    rows.push({ ...item, date: placed.date, direction, overdue: placed.overdue, inBalance: submitted, group: 0 });
  }
  const openingBalance = input.ledgerBalance.plus(beforeFrom.inflow).minus(beforeFrom.outflow);
  const openingBalanceWithDrafts = openingBalance.plus(beforeFrom.draftInflow).minus(beforeFrom.draftOutflow);
  let balance = openingBalance;
  let balanceWithDrafts = openingBalanceWithDrafts;
  let minBalance: { date: LocalDate; balance: Decimal } | undefined;
  for (const day of days) {
    const s = day.scheduled;
    day.inflow = day.postedIn.plus(s.sales_invoice).plus(s.contract);
    day.outflow = day.postedOut.plus(s.purchase_invoice).plus(s.bank_transfer).plus(s.payroll);
    day.net = day.inflow.minus(day.outflow);
    balance = balance.plus(day.net);
    balanceWithDrafts = balanceWithDrafts.plus(day.net).plus(day.draftInflow).minus(day.draftOutflow);
    day.balance = balance;
    day.balanceWithDrafts = balanceWithDrafts;
    if (!minBalance || balance.lt(minBalance.balance)) minBalance = { date: day.date, balance };
  }
  return {
    days,
    openingBalance,
    openingBalanceWithDrafts,
    closingBalance: balance,
    closingBalanceWithDrafts: balanceWithDrafts,
    openingBasis: input.from > input.today ? 'projected' : 'ledger',
    minBalance: minBalance ?? { date: input.from, balance: openingBalance },
    overdue,
    beforeFrom,
    rows: rows.sort(compareScheduleRows),
  };
}

/** Cursor of the keyset reading of posted entries (AC-9). */
export interface EntryCursor {
  entryDate: LocalDate;
  entryId: string;
}

/**
 * Reads every page of a keyset-ordered query: `read(after)` returns at most `pageSize` rows after the cursor in
 * (entryDate, entryId) order; reading stops at the first page shorter than `pageSize` (AC-9, the aggregate port caps a
 * call at 10,000 groups without a truncation signal).
 */
export async function readKeyset<T extends EntryCursor>(
  read: (after: EntryCursor | undefined) => Promise<readonly T[]>,
  pageSize: number,
): Promise<T[]> {
  const out: T[] = [];
  let after: EntryCursor | undefined;
  for (;;) {
    const page = await read(after);
    out.push(...page);
    const last = page.at(-1);
    if (page.length < pageSize || !last) return out;
    after = { entryDate: last.entryDate, entryId: last.entryId };
  }
}
