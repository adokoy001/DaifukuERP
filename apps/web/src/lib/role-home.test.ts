// docs/specs/role-home.md: role -> home view selection, the stored choice, the read plan per view, the card summaries
// computed from the existing actions' results, failure classification and the shared inbox read.
import { readFileSync, readdirSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isApiError } from '../api/client.ts';
import { HOME_READ_OPTIONS, homeQueryRoot, SWITCH_SETTLE_MS, useHomeLayout } from '../api/role-home.ts';
import type { ActionMeta, AppMeta, EntityMeta, TableResult } from '../api/types.ts';
import { cardStateOf, HomeCard, retryFeedback, type CardRead } from '../components/role-home-card.tsx';
import { MissingReportsCard } from '../components/role-home-store.tsx';
import { LocaleProvider } from '../i18n.tsx';
import type { InboxGroup, InboxItem } from './inbox.ts';
import { buildNavigation, type NavigationCatalog } from './navigation.ts';
import {
  adminLinks,
  agingSummary,
  ATTENDANCE_STATUS_LABELS,
  attendanceSummary,
  availableHomeLayouts,
  cashSummary,
  closeSummary,
  emptyViewLinks,
  employeeLinks,
  HOME_LAYOUT_LABELS,
  HOME_LAYOUTS,
  homeLayoutKey,
  homeReadFailure,
  homeScopeNote,
  homeSwitcher,
  metaRecheckOnce,
  missingReportsSummary,
  moreSites,
  parseHomeLayout,
  plannedHomeReads,
  readHomeLayout,
  resolveHomeLayout,
  serializeHomeLayout,
  shiftTodaySummary,
  visibleHomeCards,
  writeHomeLayout,
  type HomeLayout,
} from './role-home.ts';

const action = (name: string, extra: Partial<ActionMeta> = {}): ActionMeta => ({
  name,
  module: name.split('.')[0] ?? '',
  description: { ja: `${name}を返します。`, en: name },
  generic: false,
  mutates: false,
  resultKind: 'other',
  ...extra,
});
const report = (name: string) => action(name, { resultKind: 'table' });
const entity = (name: string, ops: EntityMeta['ops'] = ['read']): EntityMeta => ({
  name,
  kind: 'entity',
  label: { ja: name, en: name },
  module: name.split('_')[0],
  scope: 'company',
  displayField: undefined,
  hasExt: false,
  fields: [],
  views: { list: [], form: 'auto', search: [] },
  ops,
});
const meta = (roles: string[], actions: ActionMeta[] = [], entities: EntityMeta[] = []): AppMeta => ({
  roles,
  actions,
  entities,
  modules: [],
});
const catalogOf = (m: AppMeta, tenantAdmin = false): NavigationCatalog => buildNavigation(m, tenantAdmin);
const views = (m: AppMeta, tenantAdmin = false) => availableHomeLayouts(m, catalogOf(m, tenantAdmin), tenantAdmin);

const ACCOUNTING_ACTIONS = [
  report('sales.ar_aging'),
  report('purchase.ap_aging'),
  report('accounting.trial_balance'),
  action('accounting.close_readiness'),
];
const STORE_ACTIONS = [
  action('restaurant_chain.operations_snapshot'),
  action('restaurant_chain.todo'),
  action('workforce.shift_board'),
  action('workforce_site.list', { generic: true }),
];
const accountant = meta(['accounting'], ACCOUNTING_ACTIONS, [entity('account')]);
const storeManager = meta(['chain_manager', 'workforce_manager'], STORE_ACTIONS, [entity('workforce_attendance')]);
const employee = meta(['workforce_employee'], [action('workforce.my_portal')]);

describe('home views (AC-1/AC-2/AC-3)', () => {
  it('AC-1: a role gives its view only when one of its read sources is callable; general is offered beside it', () => {
    expect(views(accountant)).toEqual(['accounting', 'general']);
    expect(views(storeManager)).toEqual(['store', 'general']);
    expect(views(employee)).toEqual(['employee', 'general']);
    // A chain manager of a company without the restaurant pack (and without workforce reads) has nothing to show.
    expect(views(meta(['chain_manager']))).toEqual(['general']);
    expect(views(meta(['accounting']))).toEqual(['general']);
    // The employee view needs /me in the catalog (workforce.my_portal).
    expect(views(meta(['workforce_employee']))).toEqual(['general']);
  });

  it('AC-1: admin, settings and tenant admins get the admin view and never a separate general view', () => {
    expect(views(meta(['admin']))).toEqual(['admin']);
    expect(views(meta(['settings']))).toEqual(['admin']);
    expect(views(meta(['viewer']), true)).toEqual(['admin']);
    expect(views(meta(['admin', 'accounting'], ACCOUNTING_ACTIONS, [entity('account')]))).toEqual([
      'accounting',
      'admin',
    ]);
  });

  it('AC-1: a viewer sees the general view only; no /meta means no view yet', () => {
    expect(views(meta(['viewer']))).toEqual(['general']);
    expect(availableHomeLayouts(undefined, { entries: [], workspaces: [] }, false)).toEqual([]);
  });

  it('AC-1/AC-3: views are listed in the default order whatever the role order', () => {
    const many = meta(
      ['workforce_employee', 'workforce_manager', 'accounting'],
      [
        ...ACCOUNTING_ACTIONS,
        action('workforce.my_portal'),
        action('workforce.shift_board'),
        action('workforce_site.list', { generic: true }),
      ],
      [entity('account')],
    );
    expect(views(many)).toEqual(['accounting', 'store', 'employee', 'general']);
    expect(HOME_LAYOUTS).toEqual(['accounting', 'store', 'admin', 'employee', 'general']);
  });

  it('AC-2: the stored choice wins while available; otherwise the first available view', () => {
    expect(resolveHomeLayout(['accounting', 'store', 'general'], undefined)).toBe('accounting');
    expect(resolveHomeLayout(['accounting', 'store', 'general'], 'store')).toBe('store');
    expect(resolveHomeLayout(['accounting', 'general'], 'store')).toBe('accounting');
    expect(resolveHomeLayout([], undefined)).toBe('general');
  });

  it('AC-3: the switcher lists two or more views in order; a single-role user gets [role, general]; one view: none', () => {
    expect(homeSwitcher(views(accountant))).toEqual(['accounting', 'general']);
    expect(homeSwitcher(['accounting', 'store', 'employee', 'general'])).toEqual([
      'accounting',
      'store',
      'employee',
      'general',
    ]);
    expect(homeSwitcher(views(meta(['viewer'])))).toEqual([]);
    expect(homeSwitcher(views(meta(['admin'])))).toEqual([]);
  });
});

class MemoryStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes += 1;
    this.data.set(key, value);
  }
}

describe('stored choice (AC-4/AC-5)', () => {
  const scope = { tenantId: 'tenant-a', userId: 'user-a', companyId: 'company-a' };

  it('AC-4: the key carries tenant, user and company; unknown parts mean no key', () => {
    expect(homeLayoutKey(scope)).toBe('daifuku.home.v1.["tenant-a","user-a","company-a"]');
    expect(homeLayoutKey({ ...scope, companyId: 'company-b' })).not.toBe(homeLayoutKey(scope));
    expect(homeLayoutKey({ ...scope, companyId: '' })).toBeUndefined();
    expect(homeLayoutKey(undefined)).toBeUndefined();
  });

  it('AC-4: the value is a one-item envelope; unknown ids, other versions and broken JSON read as nothing', () => {
    expect(serializeHomeLayout('store')).toBe('{"version":1,"items":["store"]}');
    expect(parseHomeLayout(serializeHomeLayout('store'))).toBe('store');
    expect(parseHomeLayout('{"version":1,"items":["boss"]}')).toBeUndefined();
    expect(parseHomeLayout('{"version":2,"items":["store"]}')).toBeUndefined();
    expect(parseHomeLayout('{"version":1,"items":["store","general"]}')).toBeUndefined();
    expect(parseHomeLayout('{not json')).toBeUndefined();
    expect(parseHomeLayout(null)).toBeUndefined();
  });

  it('AC-4: useHomeLayout shows the default for an unavailable stored view and writes nothing on render', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    session.data.set(
      'daifuku.user',
      JSON.stringify({ id: 'user-a', tenantId: 'tenant-a', defaultCompanyId: 'company-a' }),
    );
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    try {
      const key = homeLayoutKey(scope) ?? '';
      function Probe({ available }: { available: readonly HomeLayout[] }) {
        return h('output', null, useHomeLayout(available).layout);
      }
      const render = (available: readonly HomeLayout[]) => renderToStaticMarkup(h(Probe, { available }));
      // Nothing stored: the first available view, and the default is not stored.
      expect(render(['accounting', 'general'])).toBe('<output>accounting</output>');
      expect(local.writes).toBe(0);
      expect(local.data.has(key)).toBe(false);
      // A stored view that is not available now: the default shows and the stored value stays as it was.
      local.data.set(key, serializeHomeLayout('store'));
      expect(render(['accounting', 'general'])).toBe('<output>accounting</output>');
      expect(local.data.get(key)).toBe(serializeHomeLayout('store'));
      expect(render(['accounting', 'store', 'general'])).toBe('<output>store</output>');
      expect(local.writes).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('AC-4: reading and falling back to the default never writes; only a pick does', () => {
    const storage = new MemoryStorage();
    const key = homeLayoutKey(scope);
    storage.data.set(key ?? '', serializeHomeLayout('store'));
    const stored = readHomeLayout(storage, key);
    expect(resolveHomeLayout(['accounting', 'general'], stored)).toBe('accounting');
    expect(storage.writes).toBe(0);
    expect(storage.data.get(key ?? '')).toBe(serializeHomeLayout('store'));
    expect(writeHomeLayout(storage, key, 'general')).toBe(true);
    expect(readHomeLayout(storage, key)).toBe('general');
    expect(storage.writes).toBe(1);
  });

  it('AC-5: a storage that throws on read or write (blocked, quota) neither throws nor remembers', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const key = homeLayoutKey(scope);
    expect(readHomeLayout(broken, key)).toBeUndefined();
    expect(writeHomeLayout(broken, key, 'store')).toBe(false);
    expect(readHomeLayout(undefined, key)).toBeUndefined();
    expect(writeHomeLayout(undefined, key, 'store')).toBe(false);
  });
});

describe('read keys and timing (AC-6/AC-15)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC-6: every card query key starts with the tenant, user and company of the tab', () => {
    const session = new MemoryStorage();
    session.data.set('daifuku.user', JSON.stringify({ id: 'u1', tenantId: 't1', defaultCompanyId: 'c1' }));
    vi.stubGlobal('sessionStorage', session);
    expect(homeQueryRoot()).toEqual(['role-home', 't1:u1:c1']);
    session.data.set('daifuku.company.t1.u1', 'c2');
    expect(homeQueryRoot()).toEqual(['role-home', 't1:u1:c2']);
  });

  it('AC-15: no polling, no refetch on focus, visibility or reconnect, no automatic retry, nothing cached', () => {
    expect(HOME_READ_OPTIONS).toEqual({
      staleTime: 0,
      gcTime: 0,
      retry: false,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    expect(SWITCH_SETTLE_MS).toBe(300);
  });
});

describe('read plan (AC-7/AC-8)', () => {
  it('AC-7: only callable sources are planned (action in /meta, entity readable, both halves of a pair)', () => {
    expect(plannedHomeReads('accounting', accountant)).toEqual(['ar_aging', 'ap_aging', 'cash', 'close']);
    expect(plannedHomeReads('accounting', meta(['accounting'], [report('sales.ar_aging')]))).toEqual(['ar_aging']);
    // Cash needs the trial balance and a readable account entity.
    expect(plannedHomeReads('accounting', meta(['accounting'], [report('accounting.trial_balance')]))).toEqual([]);
    expect(
      plannedHomeReads(
        'accounting',
        meta(['accounting'], [report('accounting.trial_balance')], [entity('account', [])]),
      ),
    ).toEqual([]);
    expect(plannedHomeReads('store', storeManager)).toEqual(['sales_today', 'missing_reports', 'attendance', 'shift']);
    // The shift card needs the site list too; a generic or mutating `.todo` is not an inbox provider.
    expect(plannedHomeReads('store', meta(['workforce_manager'], [action('workforce.shift_board')]))).toEqual([]);
    expect(
      plannedHomeReads('store', meta(['chain_manager'], [action('restaurant_chain.todo', { mutates: true })])),
    ).toEqual([]);
    expect(plannedHomeReads('store', meta(['workforce_manager'], [], [entity('workforce_attendance', [])]))).toEqual(
      [],
    );
    for (const layout of ['admin', 'employee', 'general'] as const)
      expect(plannedHomeReads(layout, storeManager)).toEqual([]);
  });

  it('AC-8: store and site memberships get a scope note per card; the whole company gets none', () => {
    const stores = { ja: '担当店舗', en: 'Your stores' };
    const sites = { ja: '担当拠点', en: 'Your sites' };
    for (const source of ['sales_today', 'missing_reports', 'attendance', 'shift'] as const)
      expect(homeScopeNote('stores', source)).toEqual(stores);
    // Under a sites membership the kernel limits site-bound entities by siteIds and store-bound ones by storeIds.
    expect(homeScopeNote('sites', 'attendance')).toEqual(sites);
    expect(homeScopeNote('sites', 'shift')).toEqual(sites);
    expect(homeScopeNote('sites', 'sales_today')).toEqual(stores);
    expect(homeScopeNote('sites', 'missing_reports')).toEqual(stores);
    expect(homeScopeNote('all', 'shift')).toBeUndefined();
    expect(homeScopeNote(undefined, 'sales_today')).toBeUndefined();
  });

  it('AC-10/AC-1: attendance needs a role that reads the whole site, not only the caller’s own row', () => {
    const attendance = [entity('workforce_attendance')];
    // A store manager who also clocks in reads workforce_attendance only as an employee (own row): no card.
    const clocking = meta(['chain_manager', 'workforce_employee'], [], attendance);
    expect(plannedHomeReads('store', clocking)).toEqual([]);
    expect(views(clocking)).toEqual(['general']);
    // With another store source the view stays, still without the attendance card.
    const withSales = meta(
      ['chain_manager', 'workforce_employee'],
      [action('restaurant_chain.operations_snapshot')],
      attendance,
    );
    expect(plannedHomeReads('store', withSales)).toEqual(['sales_today']);
    expect(views(withSales)).toEqual(['store', 'general']);
    // A workforce manager, HR, payroll or admin reads every row of the site (the employee row rule does not apply).
    for (const role of ['workforce_manager', 'workforce_hr', 'workforce_payroll', 'admin'])
      expect(plannedHomeReads('store', meta([role, 'workforce_employee'], [], attendance))).toEqual(['attendance']);
  });
});

const table = (totals: Record<string, string>, meta: Record<string, unknown> = {}, rows: TableResult['rows'] = []) =>
  ({ title: { ja: '', en: '' }, columns: [], rows, totals, meta }) satisfies TableResult;

describe('accounting summaries (AC-9)', () => {
  it('AC-9: AR uses totals.total and AP totals.balance; overdue = balance - not due, exact decimals', () => {
    expect(
      agingSummary('ar', table({ notDue: '100.25', over90: '50', total: '1000.5' }, { asOf: '2026-10-30' })),
    ).toEqual({ kind: 'ok', value: { balance: '1000.5', overdue: '900.25', over90: '50', asOf: '2026-10-30' } });
    expect(agingSummary('ap', table({ notDue: '0', over90: '0', balance: '0.1' }))).toEqual({
      kind: 'ok',
      value: { balance: '0.1', overdue: '0.1', over90: '0', asOf: undefined },
    });
    expect(agingSummary('ap', table({ notDue: '1', over90: '0', total: '5' })).kind).toBe('invalid');
    expect(agingSummary('ar', undefined).kind).toBe('invalid');
  });

  it('AC-9: a cut-off AP aging or trial balance is not shown as a total', () => {
    expect(agingSummary('ap', table({ notDue: '1', over90: '0', balance: '5' }, { truncated: true }))).toEqual({
      kind: 'truncated',
    });
    const accounts = { items: [{ id: 'a1' }], total: 1, limit: 500, offset: 0 };
    expect(cashSummary(accounts, table({}, { truncated: true }, [{ accountId: 'a1', closingBalance: '1' }]))).toEqual({
      kind: 'truncated',
    });
    expect(cashSummary({ ...accounts, total: 501 }, table({}, {}, []))).toEqual({ kind: 'truncated' });
  });

  it('AC-9: cash sums closingBalance of every 現金預金 account, inactive ones included; none is not 0', () => {
    const accounts = {
      items: [
        { id: 'a1', isActive: true },
        { id: 'a2', isActive: false },
      ],
      total: 2,
      limit: 500,
      offset: 0,
    };
    const rows = [
      { accountId: 'a1', closingBalance: '1000' },
      { accountId: 'a2', closingBalance: '-200.25' },
      { accountId: 'a3', closingBalance: '999' },
    ];
    expect(cashSummary(accounts, table({}, { to: '2026-10-30' }, rows))).toEqual({
      kind: 'ok',
      value: { balance: '799.75', accounts: 2, asOf: '2026-10-30' },
    });
    expect(cashSummary({ items: [], total: 0 }, table({}, {}, rows))).toEqual({ kind: 'none' });
    expect(cashSummary(accounts, undefined).kind).toBe('invalid');
  });

  it('AC-9: the close card shows the default period and closed / ready / blocked by n items', () => {
    const base = {
      period: { id: 'p1', code: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', isClosed: false },
      fiscalYear: { id: 'y', code: '2026', isClosed: false },
      defaulted: true,
      asOf: '2026-10-30',
      items: [],
      blockingCount: 0,
      ready: true,
      reports: [],
    };
    expect(closeSummary(base)).toEqual({
      periodId: 'p1',
      code: '2026-09',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      status: 'ready',
      blocking: 0,
    });
    expect(closeSummary({ ...base, ready: false, blockingCount: 3 })?.status).toBe('blocked');
    expect(closeSummary({ ...base, ready: false, period: { ...base.period, isClosed: true } })?.status).toBe('closed');
    expect(closeSummary(undefined)).toBeUndefined();
  });
});

describe('failures (AC-9/AC-16/AC-17)', () => {
  const err = (
    status: number,
    code: ConstructorParameters<typeof ApiError>[1]['code'],
    details?: Record<string, unknown>,
  ) => new ApiError(status, { code, message: 'm', hint: 'h', ...(details ? { details } : {}) });

  it('AC-17: 403 is a permission notice; AC-9: the AR size refusal and no fiscal period are not failures', () => {
    expect(homeReadFailure(err(403, 'PERMISSION_DENIED'), 'cash')).toBe('denied');
    expect(homeReadFailure(err(409, 'INVALID_STATE'), 'ar_aging')).toBe('too_large');
    expect(homeReadFailure(err(409, 'INVALID_STATE'), 'ap_aging')).toBe('failed');
    expect(homeReadFailure(err(409, 'INVALID_STATE', { reason: 'no_fiscal_period' }), 'close')).toBe(
      'no_fiscal_period',
    );
    expect(homeReadFailure(err(409, 'INVALID_STATE'), 'close')).toBe('failed');
    expect(homeReadFailure(err(400, 'VALIDATION'), 'sales_today')).toBe('failed');
    expect(homeReadFailure(err(500, 'INTERNAL'), 'shift')).toBe('failed');
    expect(homeReadFailure(new Error('offline'), 'shift')).toBe('failed');
  });

  it('AC-17: /meta is re-read once however many cards are refused', () => {
    const recheck = vi.fn();
    const onDenied = metaRecheckOnce(recheck);
    onDenied();
    onDenied();
    onDenied();
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  const read = (status: CardRead['status'], extra: Partial<CardRead> = {}): CardRead => ({
    status,
    error: status === 'error' ? err(500, 'INTERNAL') : null,
    isFetching: false,
    refetch: vi.fn(async () => ({ status: 'success' as const })),
    ...extra,
  });

  it('AC-16: a card fails when any read failed, waits while one is pending or reads have not started, else is ready', async () => {
    const ok = read('success');
    const failed = read('error');
    const state = cardStateOf('cash', [ok, failed], true);
    expect(state.kind).toBe('failure');
    if (state.kind !== 'failure') return;
    expect(state.failure).toBe('failed');
    expect(state.retrying).toBe(false);
    expect(await state.retry()).toBe('ok');
    // Retry re-reads the failed read only.
    expect(failed.refetch).toHaveBeenCalledTimes(1);
    expect(ok.refetch).not.toHaveBeenCalled();
    expect(cardStateOf('cash', [read('error', { isFetching: true })], true)).toMatchObject({ retrying: true });
    expect(cardStateOf('cash', [ok, read('pending')], true)).toEqual({ kind: 'loading' });
    expect(cardStateOf('cash', [ok], false)).toEqual({ kind: 'loading' });
    expect(cardStateOf('cash', [ok, ok], true)).toEqual({ kind: 'ready' });
  });

  it('AC-17: a refused read makes the card denied whatever the order of its reads, and is never retried', async () => {
    for (const order of ['500-403', '403-500'] as const) {
      const broken = read('error');
      const refused = read('error', { error: err(403, 'PERMISSION_DENIED') });
      const reads = order === '500-403' ? [broken, refused] : [refused, broken];
      const state = cardStateOf('cash', reads, true);
      expect(state).toMatchObject({ kind: 'failure', failure: 'denied' });
      if (state.kind !== 'failure') continue;
      expect(isApiError(state.error) && state.error.status).toBe(403);
      // Nothing is sent again: the card keeps the permission notice (no retry button is drawn for it either).
      expect(await state.retry()).toBe('denied');
      expect(broken.refetch).not.toHaveBeenCalled();
      expect(refused.refetch).not.toHaveBeenCalled();
    }
  });

  it('AC-16/AC-17: a retry reports what the card shows next; focus moves to the heading unless it failed again', async () => {
    const outcome = async (next: { status: 'success' | 'error'; error?: unknown }) => {
      const state = cardStateOf('ap_aging', [read('error', { refetch: vi.fn(async () => next) })], true);
      return state.kind === 'failure' ? state.retry() : undefined;
    };
    expect(await outcome({ status: 'success' })).toBe('ok');
    expect(await outcome({ status: 'error', error: err(500, 'INTERNAL') })).toBe('failed');
    expect(await outcome({ status: 'error', error: err(403, 'PERMISSION_DENIED') })).toBe('denied');
    // A retry cancelled on the way (the view was left) has nothing to announce.
    const cancelled = cardStateOf(
      'ap_aging',
      [read('error', { refetch: vi.fn(async () => ({ status: 'pending' as const })) })],
      true,
    );
    expect(cancelled.kind === 'failure' ? await cancelled.retry() : 'not a failure').toBeUndefined();
    const two = cardStateOf(
      'cash',
      [
        read('error', { refetch: vi.fn(async () => ({ status: 'error' as const, error: err(500, 'INTERNAL') })) }),
        read('error', {
          refetch: vi.fn(async () => ({ status: 'error' as const, error: err(403, 'PERMISSION_DENIED') })),
        }),
      ],
      true,
    );
    expect(two.kind === 'failure' ? await two.retry() : undefined).toBe('denied');
    expect(retryFeedback('買掛金', 'ok')).toEqual({
      message: { ja: '買掛金: 取得しました', en: '買掛金: loaded' },
      focusHeading: true,
    });
    expect(retryFeedback('買掛金', 'failed')).toEqual({
      message: { ja: '買掛金: 再試行しましたが取得できませんでした', en: '買掛金: still could not be loaded' },
      focusHeading: false,
    });
    // The retry button unmounts for a notice, so focus goes to the heading and the notice itself is announced.
    expect(retryFeedback('現金預金', 'denied')).toEqual({
      message: {
        ja: '現金預金: この情報を表示する権限がありません。',
        en: '現金預金: You do not have permission to view this information.',
      },
      focusHeading: true,
    });
    expect(retryFeedback('月次締め', 'no_fiscal_period').message.ja).toBe('月次締め: 会計年度がまだありません。');
    expect(retryFeedback('売掛金', 'too_large')).toMatchObject({ focusHeading: true });
  });
});

const card = (props: Parameters<typeof HomeCard>[0]) =>
  renderToStaticMarkup(h(LocaleProvider, null, h(HomeCard, props)));

describe('card presentation (AC-16/AC-17/AC-18)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const failure = (failure: 'failed' | 'denied' | 'too_large', retrying = false) =>
    card({
      source: 'ap_aging',
      title: { ja: '買掛金', en: 'Payables' },
      state: {
        kind: 'failure',
        failure,
        error: new ApiError(500, { code: 'INTERNAL', message: 'boom', hint: 'retry later' }),
        retrying,
        retry: async () => 'ok' as const,
      },
      children: () => 'BODY',
    });

  it('AC-16: a failed card says so with the server message, closed details and its own retry; not an alert', () => {
    const markup = failure('failed');
    expect(markup).toContain('取得できませんでした');
    expect(markup).toContain('boom');
    expect(markup).toMatch(/<details class="ui-error-details">.*INTERNAL.*500.*retry later.*<\/details>/);
    expect(markup).not.toMatch(/<details[^>]* open/);
    expect(markup).toContain('aria-label="買掛金を再試行"');
    expect(markup).toContain('id="home-card-ap_aging" tabindex="-1"');
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('BODY');
    expect(failure('failed', true)).toContain('aria-disabled="true"');
  });

  it('AC-17: a refused card shows the permission notice without a retry; AC-9: too large points to the report', () => {
    const denied = failure('denied');
    expect(denied).toContain('この情報を表示する権限がありません。');
    expect(denied).not.toContain('再試行');
    const large = failure('too_large');
    expect(large).toContain('件数が多いため帳票で確認してください。');
    expect(large).not.toContain('再試行');
  });

  it('AC-16: a loading card is busy with a polite loading text outside the skeleton', () => {
    const markup = card({
      source: 'cash',
      title: { ja: '現金預金', en: 'Cash' },
      state: { kind: 'loading' },
      children: () => 'BODY',
    });
    expect(markup).toMatch(/<p class="sr-only" aria-live="polite">読み込み中…<\/p><div aria-busy="true">/);
    expect(markup).not.toContain('BODY');
  });

  it('AC-18: the card reads in English when English is selected; every view and status label has both languages', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: () => undefined });
    const markup = failure('failed');
    expect(markup).toContain('Could not be loaded');
    expect(markup).toContain('aria-label="Retry Payables"');
    expect(markup).not.toContain('取得できませんでした');
    for (const label of [...Object.values(HOME_LAYOUT_LABELS), ...Object.values(ATTENDANCE_STATUS_LABELS)]) {
      expect(label.ja).not.toBe('');
      expect(label.en).not.toBe('');
      expect(label.ja).not.toBe(label.en);
    }
  });
});

const todoItem = (key: string, count: number): InboxItem => ({
  id: `restaurant_chain.todo:${key}`,
  provider: 'restaurant_chain.todo',
  key,
  label: { ja: key, en: key },
  count,
  severity: 'warn',
  target: { pathname: '/operations', search: {} },
});
const group = (extra: Partial<InboxGroup>): InboxGroup => ({
  provider: { action: 'restaurant_chain.todo', module: 'restaurant_chain', label: { ja: '飲食', en: 'Restaurant' } },
  status: 'ok',
  items: [],
  total: 0,
  dropped: 0,
  ...extra,
});

describe('store summaries (AC-10)', () => {
  it('AC-10: attendance rows are counted per status (rows = employees with attendance today)', () => {
    expect(
      attendanceSummary({
        rows: [{ status: 'working' }, { status: 'working' }, { status: 'closed' }, { status: 'approved' }, {}],
      }),
    ).toEqual({
      employees: 5,
      byStatus: { working: 2, break: 0, closed: 1, submitted: 0, approved: 1, returned: 0 },
    });
    expect(attendanceSummary(undefined).employees).toBe(0);
  });

  it("AC-10: a published plan gives today's slots, required people and distinct assigned employees", () => {
    const published = {
      slots: [
        { id: 's1', date: '2026-10-30', required: 2 },
        { id: 's2', date: '2026-10-30', required: 1 },
        { id: 's3', date: '2026-10-31', required: 4 },
      ],
      assignments: [
        { slotId: 's1', employeeId: 'e1' },
        { slotId: 's2', employeeId: 'e1' },
        { slotId: 's1', employeeId: 'e2' },
        { slotId: 's3', employeeId: 'e3' },
      ],
    };
    expect(shiftTodaySummary({ draft: null, published }, '2026-10-30')).toEqual({
      state: 'published',
      slots: 2,
      required: 3,
      assigned: 2,
    });
    expect(shiftTodaySummary({ draft: published, published: null }, '2026-10-30').state).toBe('draft');
    expect(shiftTodaySummary({ draft: null, published: null }, '2026-10-30').state).toBe('none');
    expect(moreSites({ total: 4 })).toBe(true);
    expect(moreSites({ total: 3 })).toBe(false);
    expect(moreSites(undefined)).toBe(false);
  });

  it('AC-10: missing reports show only items that came back; absent missing_reports is not zero; dropped is told', () => {
    expect(missingReportsSummary(undefined)).toEqual({ kind: 'unavailable' });
    expect(missingReportsSummary(group({ status: 'loading' }))).toEqual({ kind: 'loading' });
    const error = new Error('x');
    expect(missingReportsSummary(group({ status: 'error', error, retrying: true }))).toEqual({
      kind: 'failed',
      error,
      retrying: true,
    });
    const summary = missingReportsSummary(
      group({
        items: [todoItem('review_reports', 1), todoItem('finalize_reports', 2), todoItem('missing_reports', 3)],
      }),
    );
    expect(summary).toMatchObject({ kind: 'ok', missingListed: true, dropped: 0 });
    if (summary.kind === 'ok')
      expect(summary.items.map((item) => item.key)).toEqual(['missing_reports', 'review_reports']);
    expect(missingReportsSummary(group({ items: [], dropped: 2 }))).toEqual({
      kind: 'ok',
      items: [],
      missingListed: false,
      dropped: 2,
    });
  });
});

describe('shared inbox read (AC-14)', () => {
  const SRC = new URL('..', import.meta.url).pathname;
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC-14: useInbox() is called once on the home page and never by the role-home parts', () => {
    const home = readFileSync(SRC + 'pages/home-page.tsx', 'utf8');
    expect(home.match(/useInbox\(\)/g)).toHaveLength(1);
    expect(home).not.toMatch(/<InboxCard\b/);
    const parts = readdirSync(SRC + 'components').filter((name) => name.startsWith('role-home'));
    expect(parts.length).toBeGreaterThanOrEqual(5);
    for (const name of parts) expect(readFileSync(SRC + 'components/' + name, 'utf8')).not.toMatch(/useInbox\(/);
    // The inbox card has no self-reading wrapper that could be mounted as a second observer.
    const inboxCard = readFileSync(SRC + 'components/inbox-card.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(inboxCard).not.toMatch(/useInbox\(/);
    expect(inboxCard).not.toMatch(/export function InboxCard\b/);
  });

  it('AC-14/AC-10: the missing-report card is drawn from the shared group and sends no request', () => {
    const fetch = vi.fn(() => Promise.reject(new Error('no request expected')));
    vi.stubGlobal('fetch', fetch);
    const retry = vi.fn(async () => true);
    const render = (g: InboxGroup) =>
      renderToStaticMarkup(h(LocaleProvider, null, h(MissingReportsCard, { group: g, retry })));
    const none = render(group({ dropped: 1 }));
    expect(none).toContain('受信箱に未提出の項目はありません（直近7日）。');
    expect(none).toContain('開ける画面がない項目が 1 件あります');
    expect(none).not.toContain('未提出はありません。');
    const failed = render(group({ status: 'error', error: new Error('boom') }));
    expect(failed).toContain('取得できませんでした');
    expect(failed).toContain('aria-label="未提出の日次報告を再試行"');
    expect(fetch).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('links (AC-11/AC-12/AC-19)', () => {
  it('AC-11: the employee links point at the portal tabs, only when /me is in the catalog', () => {
    expect(employeeLinks(catalogOf(employee)).map((link) => link.href)).toEqual([
      '/me?tab=shifts',
      '/me?tab=attendance',
      '/me?tab=expenses',
    ]);
    expect(employeeLinks(catalogOf(meta(['viewer'])))).toEqual([]);
  });

  it('AC-12: the admin card lists catalog screens only; setup check and wizard appear once their entries exist', () => {
    const admin = catalogOf(meta(['admin']), true);
    expect(adminLinks(admin).map((link) => link.href)).toEqual(['/settings', '/admin/users', '/templates']);
    expect(adminLinks(catalogOf(meta(['settings']))).map((link) => link.href)).toEqual(['/settings', '/templates']);
    const entry = (href: string) => ({
      id: href,
      href,
      label: { ja: href, en: href },
      workspace: 'admin' as const,
      kind: 'setting' as const,
      featured: true,
      aliases: [],
    });
    const later = { ...admin, entries: [...admin.entries, entry('/admin/health'), entry('/setup')] };
    expect(adminLinks(later).map((link) => link.href)).toEqual([
      '/settings',
      '/admin/users',
      '/templates',
      '/admin/health',
      '/setup',
    ]);
  });

  it('AC-19: attendance hides when the analytics catalog leaves it out; an empty view links its catalog screens', () => {
    const planned = ['attendance', 'shift'] as const;
    expect(visibleHomeCards(planned, undefined)).toEqual(['attendance', 'shift']);
    expect(visibleHomeCards(planned, true)).toEqual(['attendance', 'shift']);
    expect(visibleHomeCards(planned, false)).toEqual(['shift']);
    expect(visibleHomeCards(['attendance'], false)).toEqual([]);
    const manager = meta(
      ['workforce_manager'],
      [action('workforce.management_portal'), action('workforce.shift_board')],
      [entity('workforce_attendance')],
    );
    expect(emptyViewLinks('store', catalogOf(manager)).map((link) => link.href)).toEqual([
      '/workforce',
      '/workforce/shifts',
    ]);
    expect(emptyViewLinks('accounting', catalogOf(accountant)).map((link) => link.href)).toEqual([
      '/finance/close',
      '/reports',
    ]);
    expect(emptyViewLinks('general', catalogOf(accountant))).toEqual([]);
  });
});
