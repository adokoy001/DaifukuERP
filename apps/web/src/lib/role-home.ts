// Role-based home (docs/specs/role-home.md). Pure: which home views ("layouts") the caller may see from /meta, the
// screen catalog and tenantAdmin; which existing read sources each view may call; the browser-local choice (stored
// through the navigation-assist boundary); and how the existing actions' results become card summaries. No React, no
// API calls: every value shown comes from an existing action / REST read / analytics snapshot the caller can run.
import { isApiError } from '../api/client.ts';
import { canEditSettings } from '../api/settings.ts';
import type { AppMeta, Label, ListResponse, TableResult } from '../api/types.ts';
import {
  assistStorageKey,
  envelope,
  parseEnvelope,
  readRaw,
  writeRaw,
  type AssistScope,
  type AssistStorage,
} from './assist-storage.ts';
import type { CloseReadiness } from './close-guide.ts';
import { NO_FISCAL_PERIOD } from './close-guide.ts';
import { compareDecimalStrings, isDecimalString, subtractDecimalStrings, sumDecimalStrings } from './decimal.ts';
import type { InboxGroup, InboxItem } from './inbox.ts';
import { findNavigationEntry, isTodoProvider, type NavigationCatalog } from './navigation.ts';

/** AC-2: the default order; the switcher (AC-3) lists the available views in this order too. */
export const HOME_LAYOUTS = ['accounting', 'store', 'admin', 'employee', 'general'] as const;
export type HomeLayout = (typeof HOME_LAYOUTS)[number];

export const HOME_LAYOUT_LABELS: Readonly<Record<HomeLayout, Label>> = {
  accounting: { ja: '経理', en: 'Accounting' },
  store: { ja: '店舗・拠点', en: 'Stores and sites' },
  admin: { ja: '導入・管理', en: 'Setup and admin' },
  employee: { ja: '従業員', en: 'Employee' },
  general: { ja: '全体', en: 'Overview' },
};

/** One card's read source (AC-9 / AC-10). */
export type HomeSource =
  'ar_aging' | 'ap_aging' | 'cash' | 'close' | 'sales_today' | 'missing_reports' | 'attendance' | 'shift';

/** Existing actions the cards call; nothing here is new (AC-8). */
export const HOME_ACTIONS = {
  arAging: 'sales.ar_aging',
  apAging: 'purchase.ap_aging',
  trialBalance: 'accounting.trial_balance',
  closeReadiness: 'accounting.close_readiness',
  operationsSnapshot: 'restaurant_chain.operations_snapshot',
  restaurantTodo: 'restaurant_chain.todo',
  shiftBoard: 'workforce.shift_board',
  siteList: 'workforce_site.list',
} as const;
export const ATTENDANCE_DATASET = 'workforce_attendance';
/**
 * AC-10: roles whose workforce_attendance read is not cut down to their own rows. The entity limits a reader whose
 * granting roles are all `workforce_employee` to `userId = $ctx.userId` (modules/workforce personPermissions; the
 * kernel applies a row rule only when every granting role is restricted), and an admin is never row-limited. A store
 * manager who also clocks in (chain_manager + workforce_employee) would otherwise see a site total of one: their own.
 */
export const ATTENDANCE_ALL_ROWS_ROLES = ['workforce_manager', 'workforce_hr', 'workforce_payroll', 'admin'] as const;
/** The 現金預金 subtype of the default Japanese chart of accounts (l10n/jp seeds; spec データ・業務ルール). */
export const CASH_SUBTYPE = '現金預金';
/** AC-10: the shift card reads at most this many sites (open question 5). */
export const SHIFT_SITE_LIMIT = 3;
/** AC-9: page size of the cash account read (a longer list is treated as cut off). */
export const CASH_ACCOUNT_LIMIT = 500;

const VIEW_SOURCES: Readonly<Record<'accounting' | 'store', readonly HomeSource[]>> = {
  accounting: ['ar_aging', 'ap_aging', 'cash', 'close'],
  store: ['sales_today', 'missing_reports', 'attendance', 'shift'],
};

const canRun = (meta: AppMeta, name: string) => meta.actions.some((action) => action.name === name);
const canRead = (meta: AppMeta, entity: string) =>
  meta.entities.some((item) => item.name === entity && item.ops.includes('read'));
const hasRole = (meta: AppMeta, roles: readonly string[]) => meta.roles.some((role) => roles.includes(role));

/**
 * AC-1 / AC-7 "呼べる": the action is in /meta or the entity is readable. Attendance also needs a role whose read covers
 * the site, not only the caller's own row (ATTENDANCE_ALL_ROWS_ROLES), so a self-only count is never shown as the site's.
 */
export function sourceCallable(source: HomeSource, meta: AppMeta): boolean {
  switch (source) {
    case 'ar_aging':
      return canRun(meta, HOME_ACTIONS.arAging);
    case 'ap_aging':
      return canRun(meta, HOME_ACTIONS.apAging);
    case 'cash':
      return canRun(meta, HOME_ACTIONS.trialBalance) && canRead(meta, 'account');
    case 'close':
      return canRun(meta, HOME_ACTIONS.closeReadiness);
    case 'sales_today':
      return canRun(meta, HOME_ACTIONS.operationsSnapshot);
    case 'missing_reports':
      // The card shows the inbox's result for this provider, so it needs exactly what the inbox needs.
      return meta.actions.some((action) => action.name === HOME_ACTIONS.restaurantTodo && isTodoProvider(action));
    case 'attendance':
      return canRead(meta, ATTENDANCE_DATASET) && hasRole(meta, ATTENDANCE_ALL_ROWS_ROLES);
    case 'shift':
      return canRun(meta, HOME_ACTIONS.shiftBoard) && canRun(meta, HOME_ACTIONS.siteList);
  }
}

/** AC-7: the cards of a view the caller may read, in display order. Views without reads plan nothing. */
export function plannedHomeReads(layout: HomeLayout, meta: AppMeta | undefined): HomeSource[] {
  if (!meta || (layout !== 'accounting' && layout !== 'store')) return [];
  return VIEW_SOURCES[layout].filter((source) => sourceCallable(source, meta));
}

/** AC-1: the views the caller may see, in AC-2 order. `general` is offered beside every role view unless `admin` is. */
export function availableHomeLayouts(
  meta: AppMeta | undefined,
  catalog: NavigationCatalog,
  tenantAdmin: boolean,
): HomeLayout[] {
  if (!meta) return [];
  const admin = canEditSettings(meta.roles) || tenantAdmin;
  const allowed: Record<HomeLayout, boolean> = {
    accounting: hasRole(meta, ['accounting']) && plannedHomeReads('accounting', meta).length > 0,
    store: hasRole(meta, ['chain_manager', 'workforce_manager']) && plannedHomeReads('store', meta).length > 0,
    admin,
    employee: hasRole(meta, ['workforce_employee']) && findNavigationEntry(catalog, '/me') !== undefined,
    general: !admin,
  };
  return HOME_LAYOUTS.filter((layout) => allowed[layout]);
}

/** AC-2 / AC-4: the stored choice when it is still available, else the first available view (general as a floor). */
export function resolveHomeLayout(available: readonly HomeLayout[], stored: HomeLayout | undefined): HomeLayout {
  if (stored && available.includes(stored)) return stored;
  return available[0] ?? 'general';
}

/** AC-4: `daifuku.home.v1.[tenant,user,company]`, through the navigation-assist boundary (undefined when unknown). */
export function homeLayoutKey(scope: AssistScope | undefined): string | undefined {
  return assistStorageKey('home', scope);
}

const isLayout = (value: unknown): value is HomeLayout =>
  typeof value === 'string' && (HOME_LAYOUTS as readonly string[]).includes(value);

/** AC-4: the stored view id, or undefined for nothing stored, an unknown id or a broken value. */
export function parseHomeLayout(raw: string | null | undefined): HomeLayout | undefined {
  const items = parseEnvelope(raw);
  return items.length === 1 && isLayout(items[0]) ? items[0] : undefined;
}

export function serializeHomeLayout(layout: HomeLayout): string {
  return envelope([layout]);
}

/** AC-4 / AC-5: the stored view of one key; a missing, blocked or unreadable storage reads as nothing stored. */
export function readHomeLayout(storage: AssistStorage | undefined, key: string | undefined): HomeLayout | undefined {
  return parseHomeLayout(readRaw(storage, key));
}

/** AC-4 / AC-5: store the picked view; false (never an exception) when the browser refuses the write. */
export function writeHomeLayout(storage: AssistStorage | undefined, key: string | undefined, layout: HomeLayout) {
  return writeRaw(storage, key, serializeHomeLayout(layout));
}

/** AC-3: the switcher's tabs, in AC-2 order; none when only one view is available. */
export function homeSwitcher(available: readonly HomeLayout[]): HomeLayout[] {
  return available.length > 1 ? [...available] : [];
}

/** AC-17: re-read /meta at most once (the first 403 of this home); later 403s keep the permission notice only. */
export function metaRecheckOnce(recheck: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    recheck();
  };
}

const SITE_BASED_SOURCES: readonly HomeSource[] = ['attendance', 'shift'];

/**
 * AC-8: the scope note of one store-view card; the server applies the store/site boundary itself. The kernel limits
 * entities with a site boundary (attendance, shifts) by `siteIds` under a `sites` membership and every other
 * store-bound entity (daily reports, sales) by `storeIds` (kernel/src/store-access.ts scopeIds), so the note follows
 * the card: a sites-scoped chain manager's sales card is still "your stores".
 */
export function homeScopeNote(accessScope: unknown, source: HomeSource): Label | undefined {
  const stores = { ja: '担当店舗', en: 'Your stores' };
  if (accessScope === 'stores') return stores;
  if (accessScope === 'sites')
    return SITE_BASED_SOURCES.includes(source) ? { ja: '担当拠点', en: 'Your sites' } : stores;
  return undefined;
}

// ---- failures -----------------------------------------------------------------------------------------------------

/**
 * AC-16 / AC-17 / AC-9: how a card shows a failed read. `denied` = 403 (no retry, /meta is re-read once);
 * `too_large` = sales.ar_aging refused the report size (409 INVALID_STATE; open the report instead, no retry);
 * `no_fiscal_period` = close readiness without any fiscal period (an explanation, not a failure); else `failed`.
 */
export type HomeReadFailure = 'denied' | 'too_large' | 'no_fiscal_period' | 'failed';

export function homeReadFailure(error: unknown, source: HomeSource): HomeReadFailure {
  if (!isApiError(error)) return 'failed';
  if (error.status === 403 || error.code === 'PERMISSION_DENIED') return 'denied';
  if (source === 'ar_aging' && error.code === 'INVALID_STATE') return 'too_large';
  if (source === 'close' && error.code === 'INVALID_STATE' && error.details?.reason === NO_FISCAL_PERIOD)
    return 'no_fiscal_period';
  return 'failed';
}

// ---- accounting summaries (AC-9) ----------------------------------------------------------------------------------

export type AmountSummary<T> = { kind: 'ok'; value: T } | { kind: 'truncated' } | { kind: 'invalid' };

export interface AgingSummary {
  /** Open balance: `totals.total` (AR) / `totals.balance` (AP). */
  balance: string;
  /** Balance minus the not-yet-due bucket. */
  overdue: string;
  over90: string;
  asOf: string | undefined;
}

const decimal = (value: unknown): string | undefined =>
  typeof value === 'string' && isDecimalString(value) ? value : undefined;

/** AC-9: AR and AP aging totals (the totals keys differ: `total` vs `balance`); a cut-off report is not a total. */
export function agingSummary(kind: 'ar' | 'ap', result: TableResult | undefined): AmountSummary<AgingSummary> {
  if (!result) return { kind: 'invalid' };
  if (result.meta?.truncated === true) return { kind: 'truncated' };
  const totals = result.totals ?? {};
  const balance = decimal(totals[kind === 'ar' ? 'total' : 'balance']);
  const notDue = decimal(totals.notDue);
  const over90 = decimal(totals.over90);
  const overdue = balance !== undefined && notDue !== undefined ? subtractDecimalStrings(balance, notDue) : undefined;
  if (balance === undefined || overdue === undefined || over90 === undefined) return { kind: 'invalid' };
  const asOf = typeof result.meta?.asOf === 'string' ? result.meta.asOf : undefined;
  return { kind: 'ok', value: { balance, overdue, over90, asOf } };
}

export interface CashSummary {
  balance: string;
  accounts: number;
  asOf: string | undefined;
}

/**
 * AC-9: Σ closingBalance (debit +) of the trial balance rows whose account has subtype 現金預金, inactive accounts
 * included (the trial balance lists them too). `none` when the company has no such account; a cut-off account list
 * or trial balance is not a total.
 */
export function cashSummary(
  accounts: (Pick<ListResponse, 'total'> & { items: readonly { id?: unknown }[] }) | undefined,
  trialBalance: TableResult | undefined,
): AmountSummary<CashSummary> | { kind: 'none' } {
  if (!accounts || !trialBalance) return { kind: 'invalid' };
  if (trialBalance.meta?.truncated === true || accounts.total > accounts.items.length) return { kind: 'truncated' };
  const ids = new Set(accounts.items.map((row) => String(row.id)));
  if (ids.size === 0) return { kind: 'none' };
  const balances: string[] = [];
  for (const row of trialBalance.rows) {
    if (!ids.has(String(row.accountId))) continue;
    const value = decimal(row.closingBalance);
    if (value === undefined) return { kind: 'invalid' };
    balances.push(value);
  }
  const asOf = typeof trialBalance.meta?.to === 'string' ? trialBalance.meta.to : undefined;
  return { kind: 'ok', value: { balance: sumDecimalStrings(balances), accounts: ids.size, asOf } };
}

export type CloseStatus = 'closed' | 'ready' | 'blocked';

export interface CloseSummary {
  periodId: string;
  code: string;
  startDate: string;
  endDate: string;
  status: CloseStatus;
  blocking: number;
}

/** AC-9: the server's default period (close-guide AC-8) and whether it is closed, ready, or blocked by n items. */
export function closeSummary(readiness: CloseReadiness | undefined): CloseSummary | undefined {
  if (!readiness?.period) return undefined;
  const { period } = readiness;
  const status: CloseStatus = period.isClosed ? 'closed' : readiness.ready ? 'ready' : 'blocked';
  return {
    periodId: period.id,
    code: period.code,
    startDate: period.startDate,
    endDate: period.endDate,
    status,
    blocking: readiness.blockingCount,
  };
}

/** Sign of a decimal string (for "overdue" wording); undefined when it is not a decimal. */
export function decimalSign(value: string): -1 | 0 | 1 | undefined {
  return compareDecimalStrings(value, '0');
}

// ---- store summaries (AC-10) --------------------------------------------------------------------------------------

export const ATTENDANCE_STATUSES = ['working', 'break', 'closed', 'submitted', 'approved', 'returned'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Readonly<Record<AttendanceStatus, Label>> = {
  working: { ja: '勤務中', en: 'Working' },
  break: { ja: '休憩中', en: 'On break' },
  closed: { ja: '退勤済み', en: 'Clocked out' },
  submitted: { ja: '承認待ち', en: 'Awaiting approval' },
  approved: { ja: '承認済み', en: 'Approved' },
  returned: { ja: '差戻し', en: 'Returned' },
};

export interface AttendanceSummary {
  /** Rows of the day (grain: one employee and work date), i.e. employees with attendance today. */
  employees: number;
  byStatus: Record<AttendanceStatus, number>;
}

/** AC-10: today's workforce_attendance snapshot rows counted per status. */
export function attendanceSummary(snapshot: { rows?: readonly Record<string, unknown>[] } | undefined) {
  const byStatus = Object.fromEntries(ATTENDANCE_STATUSES.map((status) => [status, 0])) as Record<
    AttendanceStatus,
    number
  >;
  const rows = snapshot?.rows ?? [];
  for (const row of rows) {
    const status = row.status;
    if (typeof status === 'string' && status in byStatus) byStatus[status as AttendanceStatus] += 1;
  }
  return { employees: rows.length, byStatus } satisfies AttendanceSummary;
}

export interface ShiftBoardLike {
  site?: { id: string; code: string; name: string };
  draft: ShiftPlanLike | null;
  published: ShiftPlanLike | null;
}
export interface ShiftPlanLike {
  slots: readonly { id: string; date: string; required: number }[];
  assignments: readonly { slotId: string; employeeId: string }[];
}
export type ShiftPlanState = 'published' | 'draft' | 'none';
export interface ShiftTodaySummary {
  state: ShiftPlanState;
  /** Today's slots of the published plan (0 unless published). */
  slots: number;
  required: number;
  /** Distinct employees assigned to today's slots of the published plan. */
  assigned: number;
}

/** AC-10: this week's plan state of one site and, for a published plan, today's slots, required and assigned people. */
export function shiftTodaySummary(board: ShiftBoardLike | undefined, today: string): ShiftTodaySummary {
  if (!board?.published) return { state: board?.draft ? 'draft' : 'none', slots: 0, required: 0, assigned: 0 };
  const slots = board.published.slots.filter((slot) => slot.date === today);
  const ids = new Set(slots.map((slot) => slot.id));
  const employees = new Set(
    board.published.assignments.filter((row) => ids.has(row.slotId)).map((row) => row.employeeId),
  );
  return {
    state: 'published',
    slots: slots.length,
    required: slots.reduce((sum, slot) => sum + slot.required, 0),
    assigned: employees.size,
  };
}

/** AC-10: whether the store reads more sites than the card shows. */
export function moreSites(sites: { total?: unknown; items?: readonly unknown[] } | undefined): boolean {
  const total = typeof sites?.total === 'number' ? sites.total : 0;
  return total > SHIFT_SITE_LIMIT;
}

export const MISSING_REPORT_KEYS = ['missing_reports', 'returned_reports', 'review_reports'] as const;

export type MissingReportsSummary =
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'failed'; error: unknown; retrying: boolean }
  | { kind: 'ok'; items: InboxItem[]; missingListed: boolean; dropped: number };

/**
 * AC-10: the restaurant_chain.todo group of the shared inbox read. Only items that came back are shown; an absent
 * `missing_reports` is not "zero" (the provider drops 0 counts and over-limit windows), and dropped items are told.
 */
export function missingReportsSummary(group: InboxGroup | undefined): MissingReportsSummary {
  if (!group) return { kind: 'unavailable' };
  if (group.status === 'error') return { kind: 'failed', error: group.error, retrying: group.retrying === true };
  if (group.status === 'loading') return { kind: 'loading' };
  const items = MISSING_REPORT_KEYS.flatMap((key) => group.items.filter((item) => item.key === key));
  return {
    kind: 'ok',
    items,
    missingListed: items.some((item) => item.key === 'missing_reports'),
    dropped: group.dropped,
  };
}

// ---- views without cards, links (AC-11, AC-12, AC-19) -------------------------------------------------------------

export interface HomeLink {
  href: string;
  label: Label;
}

const linksIn = (catalog: NavigationCatalog, links: readonly HomeLink[]) =>
  links.filter((link) => findNavigationEntry(catalog, new URL(link.href, 'https://home.invalid').pathname));

/** AC-11: the employee view's links (the portal's own tabs); shown only when /me is in the catalog. */
export function employeeLinks(catalog: NavigationCatalog): HomeLink[] {
  return linksIn(catalog, [
    { href: '/me?tab=shifts', label: { ja: '自分のシフト', en: 'My shifts' } },
    { href: '/me?tab=attendance', label: { ja: '勤怠の記録', en: 'My attendance' } },
    { href: '/me?tab=expenses', label: { ja: '経費の申請', en: 'My expenses' } },
  ]);
}

/**
 * AC-12: the admin card's links, catalog entries only. `/admin/health` (B3 setup-health) and `/setup` (B4
 * setup-wizard) appear by themselves once those items add their catalog entries; nothing of theirs is imported.
 */
export function adminLinks(catalog: NavigationCatalog): HomeLink[] {
  return linksIn(catalog, [
    { href: '/settings', label: { ja: '会社設定', en: 'Company settings' } },
    { href: '/admin/users', label: { ja: '利用者と権限', en: 'Users and access' } },
    { href: '/templates', label: { ja: '業界テンプレート', en: 'Industry templates' } },
    // B3 (setup-health): the setup check screen, once its catalog entry exists.
    { href: '/admin/health', label: { ja: '導入チェックを開く', en: 'Open the setup check' } },
    // B4 (setup-wizard): the setup wizard, once its catalog entry exists.
    { href: '/setup', label: { ja: 'セットアップを開く', en: 'Open setup' } },
  ]);
}

/** AC-19: the screens related to a view, for its empty state (catalog entries only). */
export function emptyViewLinks(layout: HomeLayout, catalog: NavigationCatalog): HomeLink[] {
  if (layout === 'store')
    return linksIn(catalog, [
      { href: '/operations', label: { ja: 'チェーン運営', en: 'Chain operations' } },
      { href: '/workforce', label: { ja: '従業員・勤怠管理', en: 'Workforce management' } },
      { href: '/workforce/shifts', label: { ja: 'シフト', en: 'Shifts' } },
    ]);
  if (layout === 'accounting')
    return linksIn(catalog, [
      { href: '/finance/close', label: { ja: '月次締め', en: 'Month-end close' } },
      { href: '/reports', label: { ja: 'BI・レポート', en: 'BI and reports' } },
    ]);
  return [];
}

/**
 * AC-19: the cards a view actually shows. Attendance needs the analytics catalog to list its dataset; while the
 * catalog is unknown (`undefined`) the card stays (loading or failed), and a catalog without it hides the card.
 */
export function visibleHomeCards(planned: readonly HomeSource[], attendanceListed: boolean | undefined): HomeSource[] {
  return planned.filter((source) => source !== 'attendance' || attendanceListed !== false);
}

/** Whether a catalog link exists for one screen (the cards' "open" links are shown only then). */
export function hasScreen(catalog: NavigationCatalog, href: string): boolean {
  return findNavigationEntry(catalog, new URL(href, 'https://home.invalid').pathname) !== undefined;
}
