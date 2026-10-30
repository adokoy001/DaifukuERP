// /finance/cash-forecast (docs/specs/cash-forecast.md AC-20..AC-27): URL conditions, quick ranges, the validation
// shared with the server schema, hiding quiet days, chart coordinates and the guidance shown for a result. Pure.
// Money stays decimal strings; only bounded ratios become numbers for SVG coordinates.
import {
  cashAddDays,
  cashForecastInput,
  CASH_MAX_AHEAD_DAYS,
  type CashDirection,
  type CashForecastMeta,
  type CashSource,
  type CashState,
} from '@daifuku/mod-banking/contract';
import type { Label, TableColumn, TableResult } from '../api/types.ts';
import { compareDecimalStrings } from './decimal.ts';
import { formatDecimal } from './format.ts';
import { businessToday, chartRatio, maximumMagnitude, validDate } from './operations.ts';

export const CASH_FORECAST_ACTION = 'banking.cash_forecast';
export const CASH_SCHEDULE_ACTION = 'banking.cash_schedule';
/** Default period: today and the next 89 days (AC-20). */
export const DEFAULT_DAYS = 90;

/** URL search: flags are the number 1 so the router writes `?drafts=1` (a string "1" would be JSON-quoted). */
export interface CashSearch {
  from?: string;
  to?: string;
  drafts?: 1;
  overdue?: 1;
}

export interface CashConditions {
  from: string;
  to: string;
  includeDrafts: boolean;
  includeOverdue: boolean;
}

/** validateSearch of the route: only real dates and the two flags survive. */
export function parseCashSearch(raw: Record<string, unknown>): CashSearch {
  return {
    ...(validDate(raw.from) ? { from: raw.from } : {}),
    ...(validDate(raw.to) ? { to: raw.to } : {}),
    ...(raw.drafts === '1' || raw.drafts === 1 ? { drafts: 1 as const } : {}),
    ...(raw.overdue === '1' || raw.overdue === 1 ? { overdue: 1 as const } : {}),
  };
}

export function todayForCash(now = new Date()): string {
  return businessToday(now);
}

export function defaultConditions(today: string): CashConditions {
  return { from: today, to: cashAddDays(today, DEFAULT_DAYS - 1), includeDrafts: false, includeOverdue: false };
}

/** Field errors for a period (AC-17 / AC-20): the server schema plus the "at most 730 days ahead" rule. */
export function conditionErrors(c: Pick<CashConditions, 'from' | 'to'>, today: string): { from?: Label; to?: Label } {
  if (!validDate(c.from))
    return { from: { ja: '開始日を正しい日付で入力してください。', en: 'Enter a valid start date.' } };
  if (!validDate(c.to)) return { to: { ja: '終了日を正しい日付で入力してください。', en: 'Enter a valid end date.' } };
  const parsed = cashForecastInput.safeParse({ from: c.from, to: c.to });
  if (!parsed.success)
    return c.from > c.to
      ? { to: { ja: '終了日は開始日以後にしてください。', en: 'The end date must be on or after the start date.' } }
      : { to: { ja: '期間は366日以内にしてください。', en: 'The period can be at most 366 days.' } };
  if (c.to > cashAddDays(today, CASH_MAX_AHEAD_DAYS))
    return {
      to: {
        ja: `終了日は今日から${CASH_MAX_AHEAD_DAYS}日以内にしてください。`,
        en: `The end date must be within ${CASH_MAX_AHEAD_DAYS} days from today.`,
      },
    };
  return {};
}

/** The URL's conditions when they are valid, else the default period (flags are kept either way). */
export function conditionsFromSearch(search: CashSearch, today: string): CashConditions {
  const flags = { includeDrafts: search.drafts === 1, includeOverdue: search.overdue === 1 };
  if (
    search.from &&
    search.to &&
    Object.keys(conditionErrors({ from: search.from, to: search.to }, today)).length === 0
  )
    return { from: search.from, to: search.to, ...flags };
  return { ...defaultConditions(today), ...flags };
}

export function searchFromConditions(c: CashConditions): CashSearch {
  return {
    from: c.from,
    to: c.to,
    ...(c.includeDrafts ? { drafts: 1 as const } : {}),
    ...(c.includeOverdue ? { overdue: 1 as const } : {}),
  };
}

/** The action input: flags are sent only when on (the server's default is false). */
export function actionInput(c: CashConditions): Record<string, unknown> {
  return {
    from: c.from,
    to: c.to,
    ...(c.includeDrafts ? { includeDrafts: true } : {}),
    ...(c.includeOverdue ? { includeOverdue: true } : {}),
  };
}

export const sameConditions = (a: CashConditions, b: CashConditions): boolean =>
  a.from === b.from && a.to === b.to && a.includeDrafts === b.includeDrafts && a.includeOverdue === b.includeOverdue;

export const QUICK_RANGES = ['next30', 'next90', 'thisMonth', 'nextMonth'] as const;
export type QuickRange = (typeof QUICK_RANGES)[number];
export const QUICK_RANGE_LABEL: Readonly<Record<QuickRange, Label>> = {
  next30: { ja: '今日から30日', en: 'Next 30 days' },
  next90: { ja: '今日から90日', en: 'Next 90 days' },
  thisMonth: { ja: '今月', en: 'This month' },
  nextMonth: { ja: '来月', en: 'Next month' },
};

function monthEnd(monthStart: string): string {
  const y = Number(monthStart.slice(0, 4));
  const m = Number(monthStart.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return cashAddDays(next, -1);
}

export function quickRange(kind: QuickRange, today: string): { from: string; to: string } {
  const thisMonth = today.slice(0, 8) + '01';
  switch (kind) {
    case 'next30':
      return { from: today, to: cashAddDays(today, 29) };
    case 'next90':
      return { from: today, to: cashAddDays(today, 89) };
    case 'thisMonth':
      return { from: thisMonth, to: monthEnd(thisMonth) };
    case 'nextMonth': {
      const next = cashAddDays(monthEnd(thisMonth), 1);
      return { from: next, to: monthEnd(next) };
    }
  }
}

/** Day columns that carry movements (balances excluded). */
const AMOUNT_KEYS = [
  'postedIn',
  'postedOut',
  'receivables',
  'contracts',
  'payables',
  'transfers',
  'payroll',
  'draftInflow',
  'draftOutflow',
] as const;

const isZero = (value: unknown) => typeof value !== 'string' || compareDecimalStrings(value, '0') === 0;

/** AC-23: rows without any movement are hidden; totals stay the action's values. */
export function hideQuietDays(result: TableResult): TableResult {
  return { ...result, rows: result.rows.filter((row) => AMOUNT_KEYS.some((key) => !isZero(row[key]))) };
}

/** AC-20: nothing posted, nothing scheduled (in or out of the balance) and no overdue item. */
export function hasNothing(forecast: TableResult, scheduleRows: number, meta: CashForecastMeta): boolean {
  return hideQuietDays(forecast).rows.length === 0 && scheduleRows === 0 && meta.overdue.count === 0;
}

/** AC-23: which group a day column belongs to (posted, scheduled, draft or balance), for headings and colour. */
export function columnGroup(key: string): 'posted' | 'scheduled' | 'draft' | 'total' | undefined {
  if (key === 'postedIn' || key === 'postedOut') return 'posted';
  if (['receivables', 'contracts', 'payables', 'transfers', 'payroll'].includes(key)) return 'scheduled';
  if (key.startsWith('draft') || key === 'balanceWithDrafts') return 'draft';
  if (['inflow', 'outflow', 'net', 'balance'].includes(key)) return 'total';
  return undefined;
}

export const columnClass = (column: TableColumn): string | undefined => {
  const group = columnGroup(column.key);
  return group ? `cash-col-${group}` : undefined;
};

export const DIRECTION_LABEL: Readonly<Record<CashDirection, Label>> = {
  in: { ja: '入金', en: 'Receipt' },
  out: { ja: '出金', en: 'Payment' },
};
export const SOURCE_LABEL: Readonly<Record<CashSource, Label>> = {
  sales_invoice: { ja: '売上請求', en: 'Sales invoice' },
  contract: { ja: '契約請求', en: 'Contract billing' },
  purchase_invoice: { ja: '仕入請求', en: 'Purchase invoice' },
  bank_transfer: { ja: '振込予定', en: 'Scheduled transfer' },
  payroll: { ja: '給与', en: 'Payroll' },
};
export const STATE_LABEL: Readonly<Record<CashState, Label>> = {
  submitted: { ja: '確定', en: 'Submitted' },
  draft: { ja: '下書き', en: 'Draft' },
};

/** Record screen of a schedule row's document (AC-24); payroll rows link nowhere. */
export function documentLink(row: {
  source: CashSource;
  salesInvoiceId: string | null;
  purchaseInvoiceId: string | null;
  contractId: string | null;
}): { entity: string; id: string } | undefined {
  if (row.salesInvoiceId) return { entity: 'sales_invoice', id: row.salesInvoiceId };
  if (row.purchaseInvoiceId) return { entity: 'purchase_invoice', id: row.purchaseInvoiceId };
  if (row.contractId) return { entity: 'contract', id: row.contractId };
  return undefined;
}

/** Money for messages: ¥ with the company's digits; negative as -¥. */
export function yen(value: string, scale: number): string {
  const negative = value.startsWith('-');
  const body = formatDecimal(negative ? value.slice(1) : value, scale);
  return (negative ? '-¥' : '¥') + body;
}

/** AC-22: the warning when the balance (without drafts) goes below zero. */
export function minBalanceWarning(meta: CashForecastMeta, scale: number): Label | undefined {
  if (compareDecimalStrings(meta.minBalance.balance, '0') !== -1) return undefined;
  const amount = yen(meta.minBalance.balance, scale);
  return {
    ja: `残高がマイナスになる日があります（最初の日 ${meta.minBalance.date}、最低残高 ${amount}）`,
    en: `The balance goes below zero (first on ${meta.minBalance.date}, lowest ${amount}).`,
  };
}

export interface CashNoticeView {
  id: string;
  tone: 'warning' | 'info';
  text: Label;
  link?: { to: string; label: Label };
}

const SOURCE_EXCLUDED: Readonly<Record<CashSource, Label>> = {
  sales_invoice: { ja: '売上請求', en: 'Sales invoices' },
  contract: { ja: '契約請求', en: 'Contract billing' },
  purchase_invoice: { ja: '仕入請求', en: 'Purchase invoices' },
  bank_transfer: { ja: '振込予定', en: 'Scheduled transfers' },
  payroll: { ja: '給与', en: 'Payroll' },
};

/** AC-25: the guidance for a result, in display order. */
export function cashNotices(meta: CashForecastMeta, scale: number): CashNoticeView[] {
  const out: CashNoticeView[] = [];
  for (const s of meta.sources)
    if (!s.included)
      out.push({
        id: `source-${s.source}`,
        tone: 'info',
        text:
          s.source === 'payroll'
            ? {
                ja: '給与は閲覧・出力の権限がないため含めていません。',
                en: 'Payroll is not included because you cannot view and export it.',
              }
            : {
                ja: `${SOURCE_EXCLUDED[s.source].ja}は閲覧の権限がないため含めていません。`,
                en: `${SOURCE_EXCLUDED[s.source].en} are not included because you cannot view them.`,
              },
      });
  const o = meta.overdue;
  if (o.count > 0)
    out.push({
      id: 'overdue',
      tone: 'warning',
      text: meta.includeOverdue
        ? {
            ja: `期日を過ぎた予定 ${o.count} 件（入金 ${yen(o.inflow, scale)}、支払 ${yen(o.outflow, scale)}）を今日の日付に含めています。`,
            en: `${o.count} overdue items (receipts ${yen(o.inflow, scale)}, payments ${yen(o.outflow, scale)}) are placed on today.`,
          }
        : {
            ja: `期日を過ぎた予定が ${o.count} 件（入金 ${yen(o.inflow, scale)}、支払 ${yen(o.outflow, scale)}）あります。残高には含めていません。「期日超過を今日に含める」で今日の日付に置けます。`,
            en: `${o.count} items are overdue (receipts ${yen(o.inflow, scale)}, payments ${yen(o.outflow, scale)}) and are not in the balance. Turn on "Include overdue on today" to place them on today.`,
          },
    });
  if (meta.unscheduledPayroll && meta.unscheduledPayroll.count > 0)
    out.push({
      id: 'unscheduled-payroll',
      tone: 'warning',
      text: {
        ja: `支払日が登録されていない確定済みの給与が ${meta.unscheduledPayroll.count} 件（差引支給 ${yen(meta.unscheduledPayroll.netPay, scale)}）あります。残高には含めていません。給与画面で支払日の証跡を登録すると予定に入ります。`,
        en: `${meta.unscheduledPayroll.count} confirmed payrolls (net pay ${yen(meta.unscheduledPayroll.netPay, scale)}) have no payment date and are not in the balance. Record the payment evidence on the payroll screen to schedule them.`,
      },
      link: { to: '/workforce/payroll', label: { ja: '給与画面を開く', en: 'Open payroll' } },
    });
  if (meta.notices.includes('payroll_posted_overlap'))
    out.push({
      id: 'payroll-overlap',
      tone: 'info',
      text: {
        ja: '給与の支払仕訳を支払日以前に記帳済みの場合、その分を二重に数えます（記帳済み出金と給与の予定の両方に入ります）。',
        en: 'If a payroll payment is already posted on or before its payment date, it is counted twice (as a posted payment and as scheduled payroll).',
      },
    });
  if (meta.contractBacklog && meta.contractBacklog.count > 0)
    out.push({
      id: 'contract-backlog',
      tone: 'warning',
      text: {
        ja: `請求日から12か月以上前のまま請求書が作られていない契約の対象月が ${meta.contractBacklog.count} 件（税抜 ${yen(meta.contractBacklog.subtotal, scale)}）あります。残高には含めていません。`,
        en: `${meta.contractBacklog.count} contract periods billed more than 12 months ago still have no invoice (${yen(meta.contractBacklog.subtotal, scale)} excl. tax). They are not in the balance.`,
      },
      link: { to: '/r/contract.schedule', label: { ja: '請求予定を開く', en: 'Open billing schedule' } },
    });
  const u = meta.unallocated;
  if (u.receive.count > 0 || u.pay.count > 0)
    out.push({
      id: 'unallocated',
      tone: 'info',
      text: {
        ja: `請求書に充てていない入出金があります（入金 ${u.receive.count} 件 ${yen(u.receive.amount, scale)}、支払 ${u.pay.count} 件 ${yen(u.pay.amount, scale)}）。資金はすでに記帳済みのため、後で充てる請求書の予定と重なる場合があります。`,
        en: `Some payments are not allocated to invoices (receipts ${u.receive.count}, ${yen(u.receive.amount, scale)}; payments ${u.pay.count}, ${yen(u.pay.amount, scale)}). The cash is already posted, so it may overlap the invoices they will settle.`,
      },
    });
  if (meta.uncountedPaymentAccounts.length > 0) {
    const list = (locale: 'ja' | 'en') =>
      meta.uncountedPaymentAccounts
        .map((a) =>
          locale === 'ja'
            ? `${a.code} ${a.name}（${a.count} 件、入金 ${yen(a.receive, scale)}、支払 ${yen(a.pay, scale)}）`
            : `${a.code} ${a.name} (${a.count}, receipts ${yen(a.receive, scale)}, payments ${yen(a.pay, scale)})`,
        )
        .join(locale === 'ja' ? '、' : '; ');
    out.push({
      id: 'uncounted-accounts',
      tone: 'warning',
      text: {
        ja: `資金科目ではない科目に記帳された入出金があり、資金の動きに含めていません: ${list('ja')}。銀行口座として登録すると資金科目になります。`,
        en: `Payments posted to accounts that are not cash accounts are not counted: ${list('en')}. Register the account as a bank account to count it.`,
      },
      link: { to: '/finance/banking', label: { ja: '銀行口座を登録する', en: 'Register a bank account' } },
    });
  }
  if (meta.missingAccountCodes.length > 0)
    out.push({
      id: 'missing-accounts',
      tone: 'warning',
      text: {
        ja: `会社設定 payment.accounts の科目コード ${meta.missingAccountCodes.join('、')} の勘定科目が見つかりません。見つかった科目だけで計算しています。`,
        en: `No account has the payment.accounts code ${meta.missingAccountCodes.join(', ')}. Only the accounts found are used.`,
      },
      link: { to: '/settings', label: { ja: '会社設定を開く', en: 'Open company settings' } },
    });
  return out;
}

export interface ChartPoint {
  date: string;
  balance: string;
  x: number;
  y: number;
}

export interface ChartModel {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  zeroY: number;
  points: ChartPoint[];
  drafts: ChartPoint[];
  path: string;
  draftPath: string;
  max: string;
  min: string;
}

const W = 740;
const H = 240;
const PAD = { left: 64, right: 16, top: 20, bottom: 36 };

/** AC-21: coordinates of the balance line (and the dashed balance with drafts) with a zero baseline. */
export function chartModel(rows: readonly Record<string, unknown>[], includeDrafts: boolean): ChartModel {
  const balances = rows.map((r) => String(r.balance ?? '0'));
  const withDrafts = includeDrafts ? rows.map((r) => String(r.balanceWithDrafts ?? r.balance ?? '0')) : [];
  const all = [...balances, ...withDrafts];
  const magnitude = maximumMagnitude(all);
  const ratios = all.map((v) => chartRatio(v, magnitude));
  const hi = Math.max(0, ...ratios);
  const lo = Math.min(0, ...ratios);
  const span = hi - lo || 1;
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const y = (value: string) => PAD.top + ((hi - chartRatio(value, magnitude)) / span) * plotH;
  const x = (index: number) =>
    rows.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (index / (rows.length - 1)) * plotW;
  const pointsOf = (values: string[]) =>
    values.map((balance, i) => ({ date: String(rows[i]?.date ?? ''), balance, x: x(i), y: y(balance) }));
  const points = pointsOf(balances);
  const drafts = pointsOf(withDrafts);
  const pathOf = (list: ChartPoint[]) =>
    list.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const sorted = [...all].sort((a, b) => compareDecimalStrings(a, b) ?? 0);
  return {
    width: W,
    height: H,
    left: PAD.left,
    right: W - PAD.right,
    top: PAD.top,
    bottom: H - PAD.bottom,
    zeroY: PAD.top + (hi / span) * plotH,
    points,
    drafts,
    path: pathOf(points),
    draftPath: pathOf(drafts),
    max: sorted.at(-1) ?? '0',
    min: sorted[0] ?? '0',
  };
}

/** AC-21: the chart's accessible name. */
export function chartLabel(meta: CashForecastMeta, scale: number): Label {
  const o = yen(meta.openingBalance, scale);
  const c = yen(meta.closingBalance, scale);
  const m = yen(meta.minBalance.balance, scale);
  return {
    ja: `残高の推移のグラフ。期首残高 ${o}、期末残高 ${c}、最低残高 ${m}（${meta.minBalance.date}）。正確な値は日別の表で確認できます。`,
    en: `Balance chart. Opening ${o}, closing ${c}, lowest ${m} on ${meta.minBalance.date}. Exact values are in the daily table.`,
  };
}
