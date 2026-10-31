// docs/specs/role-home.md in the browser: the home view chosen from the user's roles (accounting, store / site
// manager, employee, admin), the switcher and its stored choice, reads limited to what /meta allows (no 403, no
// forbidden request), per-card failures and the 403 path, the shared inbox read, 390px, English and axe.
// API setup only creates identities, memberships, a site, an employee punch and a draft shift plan.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { formatJudgement, judge, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { BUSINESS_DATE } from './environment.ts';
import { api, login, member as storeMember, newStore, PASSWORD, type Headers, type Row } from './operations-helpers.ts';

const ADMIN = process.env.E2E_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const TODAY = BUSINESS_DATE;

interface Session {
  headers: Headers;
  companyId: string;
  user: { id: string; tenantId: string };
}
async function session(request: APIRequestContext, email: string, password: string, companyId?: string) {
  const auth = await api<{ token: string; user: { id: string; tenantId: string; defaultCompanyId: string } }>(
    request,
    {},
    '/auth/login',
    { email, password },
  );
  const company = companyId ?? auth.user.defaultCompanyId;
  const headers: Headers = { authorization: 'Bearer ' + auth.token, 'x-company-id': company };
  return { headers, companyId: company, user: auth.user } satisfies Session;
}

function monday(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

async function fixture(request: APIRequestContext) {
  const admin = await session(request, ADMIN, ADMIN_PASSWORD);
  const suffix = Date.now().toString(36);
  const site = await api(request, admin.headers, '/api/workforce_site', {
    code: `RH-${suffix}`,
    name: `役割別ホーム拠点 ${suffix}`,
  });
  const member = async (
    key: string,
    name: string,
    roles: string[],
    accessScope: 'sites' | 'all',
    siteId: string = site.id,
  ) => {
    const email = `rolehome.${key}.${suffix}@example.com`;
    const user = await api(request, admin.headers, '/admin/users', {
      name: `${name} ${suffix}`,
      email,
      password: PASSWORD,
    });
    await api(
      request,
      admin.headers,
      `/admin/users/${user.id}/companies/${admin.companyId}`,
      { expectedVersion: 0, roles, accessScope, storeIds: [], siteIds: accessScope === 'sites' ? [siteId] : [] },
      'PUT',
    );
    return { ...user, name: `${name} ${suffix}`, email };
  };
  const accountant = await member('accounting', '経理担当', ['accounting'], 'all');
  const manager = await member('manager', '拠点責任者', ['workforce_manager'], 'sites');
  const worker = await member('employee', '拠点従業員', ['workforce_employee'], 'sites');
  // Accounting is not a site-limited role, so the multi-role user belongs to the whole company.
  const multi = await member('multi', '兼務者', ['accounting', 'workforce_manager', 'workforce_employee'], 'all');
  const employee = await api(request, admin.headers, '/actions/workforce.register_employee', {
    userId: worker.id,
    siteId: site.id,
    code: `RH-${suffix}`,
    name: worker.name,
    hiredOn: `${TODAY.slice(0, 7)}-01`,
  });
  return { admin, site, suffix, accountant, manager, worker, multi, employee, member };
}

/**
 * Every request the page sends, with its response status, in order. A request aborted before its response (the dev
 * server's React StrictMode mounts each card twice, and the first read is cancelled through its signal) is marked
 * `aborted` and is not counted as a read.
 */
function networkLog(page: Page) {
  type Entry = { method: string; path: string; body: unknown; status?: number; aborted?: boolean };
  const entries: Entry[] = [];
  const byRequest = new WeakMap<Request, Entry>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!/^\/(actions|api|analytics|meta|auth)\b/.test(url.pathname)) return;
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = undefined;
    }
    const entry: Entry = { method: request.method(), path: url.pathname + url.search, body };
    entries.push(entry);
    byRequest.set(request, entry);
  });
  page.on('response', (response) => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  });
  page.on('requestfailed', (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.aborted = true;
  });
  const actions = (name: string) =>
    entries.filter((item) => item.method === 'POST' && item.path === `/actions/${name}` && !item.aborted);
  return { entries, actions };
}

/**
 * AC-7: the page called only what the user's /meta (and analytics catalog) allows, nothing was refused, and the
 * setup-health endpoint was never called (the home only links to /admin/health).
 */
async function expectAllowedReads(request: APIRequestContext, own: Session, log: ReturnType<typeof networkLog>) {
  const meta = await api<{ actions: { name: string }[]; entities: { name: string; ops: string[] }[] }>(
    request,
    own.headers,
    '/meta',
  );
  const catalog = await api<{ datasets: { id: string }[] }>(request, own.headers, '/analytics/catalog');
  const actions = new Set(meta.actions.map((item) => item.name));
  const readable = new Set(meta.entities.filter((item) => item.ops.includes('read')).map((item) => item.name));
  const datasets = new Set(catalog.datasets.map((item) => item.id));
  for (const entry of log.entries) {
    expect(entry.status, `${entry.method} ${entry.path}`).not.toBe(403);
    expect(entry.path).not.toMatch(/^\/meta\/health/);
    const action = /^\/actions\/([a-z0-9_]+\.[a-z0-9_]+)$/.exec(entry.path)?.[1];
    if (action) expect(actions.has(action), `${action} is not in /meta`).toBe(true);
    const entity = /^\/api\/([a-z0-9_]+)(?:\?|$)/.exec(entry.path)?.[1];
    if (entity && entry.method === 'GET') expect(readable.has(entity), `${entity} is not readable`).toBe(true);
    if (entry.path === '/analytics/snapshot')
      expect(datasets.has(String((entry.body as { dataset?: unknown }).dataset))).toBe(true);
  }
}

/** Spec verification 5: Resource Timing of the home's reads, recorded as a measurement in the test output. */
async function recordTimings(page: Page, name: string) {
  const timings = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => /\/(actions|analytics|api\/account)/.test(entry.name))
      .map((entry) => ({ url: new URL(entry.name).pathname, ms: Math.round(entry.duration) })),
  );
  await test
    .info()
    .attach(`${name}-timings.json`, { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  console.log(`[role-home timing] ${name}: ${timings.map((t) => `${t.url} ${t.ms}ms`).join(', ')}`);
}

async function axe(page: Page, screen: string, locale: 'ja' | 'en', width: 390 | 1280) {
  const run: A11yRun = { screen, locale, width };
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const judgement = judge(results.violations, [], run, results.incomplete);
  const report = formatJudgement(run, judgement);
  await test.info().attach(`axe-${screen}-${locale}-${width}.txt`, { body: report, contentType: 'text/plain' });
  expect(judgement.failures, report).toEqual([]);
}

/**
 * AC-18: no horizontal scrolling. The app scrolls inside #screen-content (the layout itself is overflow: hidden), so
 * the document check alone cannot fail; the content area is checked as csv-import.spec.ts does.
 */
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('#screen-content').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}
/**
 * A 390px screenshot of the whole home. `fullPage` cannot reach inside #screen-content, so the viewport is made as
 * tall as the content for the shot (and checked for overflow at that size too), then put back.
 */
async function fullShot(page: Page, name: string) {
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  const needed = await page
    .locator('#screen-content')
    .evaluate((el) => Math.ceil(el.getBoundingClientRect().top + el.scrollHeight));
  await page.setViewportSize({ width, height: Math.min(Math.max(needed, height), 6000) });
  await noOverflow(page);
  await shot(page, name);
  await page.setViewportSize({ width, height });
}
async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}
/** AC-18: check one view at 390px in Japanese and at 1280px in English (then back to Japanese). */
async function layoutChecks(page: Page, screen: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page);
  await noOverflow(page);
  await fullShot(page, `role-home-${screen}-390.png`);
  await axe(page, screen, 'ja', 390);
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'en'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A clear start to your day.' })).toBeVisible();
  await settled(page);
  await axe(page, screen, 'en', 1280);
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '今日の仕事を、ここから。' })).toBeVisible();
}

const tablist = (page: Page) => page.getByRole('tablist', { name: 'ホームの表示' });
const card = (page: Page, source: string) => page.locator(`[data-testid="home-card"][data-source="${source}"]`);
const value = (page: Page, source: string, testId: string) =>
  card(page, source).getByTestId(testId).locator('[data-value]').first();

/** Exact decimal comparison without floating point (scaled to 6 places like numeric(20,6)). */
function scaled(text: string): bigint {
  const [int = '0', frac = ''] = text.replace(/^-/, '').split('.');
  const v = BigInt(int + frac.padEnd(6, '0').slice(0, 6));
  return text.startsWith('-') ? -v : v;
}

test('role-home AC-1/2/3/4/7/9/14/15/18: an accounting user gets receivables, payables, cash and the close', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(180_000);
  const f = await fixture(request);
  const own = await session(request, f.accountant.email, PASSWORD);
  const log = networkLog(page);
  await login(page, f.accountant.email, PASSWORD);

  // AC-1/AC-2/AC-3: a single-role user sees [経理, 全体] with the accounting view selected by default.
  await expect(tablist(page).getByRole('tab')).toHaveText(['経理', '全体']);
  await expect(tablist(page).getByRole('tab', { name: '経理' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '経理の今日', level: 2 })).toBeVisible();
  await settled(page);

  // AC-9: each card shows the same values as the user's own API responses.
  const ar = await api<{ totals: Record<string, string> }>(request, own.headers, '/actions/sales.ar_aging', {});
  const ap = await api<{ totals: Record<string, string> }>(request, own.headers, '/actions/purchase.ap_aging', {});
  await expect(value(page, 'ar_aging', 'home-aging-balance')).toHaveAttribute('data-value', ar.totals.total ?? '');
  await expect(value(page, 'ap_aging', 'home-aging-balance')).toHaveAttribute('data-value', ap.totals.balance ?? '');
  const accounts = await api<{ items: Row[] }>(
    request,
    own.headers,
    `/api/account?${new URLSearchParams({ where: JSON.stringify({ subtype: '現金預金' }), limit: '500' })}`,
  );
  const balance = await api<{ rows: { accountId: string; closingBalance: string }[] }>(
    request,
    own.headers,
    '/actions/accounting.trial_balance',
    {},
  );
  const ids = new Set(accounts.items.map((row) => row.id));
  expect(ids.size).toBeGreaterThan(0);
  const cash = balance.rows
    .filter((row) => ids.has(row.accountId))
    .reduce((sum, row) => sum + scaled(row.closingBalance), 0n);
  const shown = await value(page, 'cash', 'home-cash-balance').getAttribute('data-value');
  expect(scaled(shown ?? 'x')).toBe(cash);
  await expect(card(page, 'cash').getByTestId('home-cash-accounts')).toContainText(`${ids.size}科目`);
  const close = await api<{ period: { id: string; code: string } }>(
    request,
    own.headers,
    '/actions/accounting.close_readiness',
    {},
  );
  await expect(card(page, 'close').getByTestId('home-close-period')).toContainText(close.period.code);
  await expect(card(page, 'close').getByRole('link', { name: '締めガイドを開く' })).toHaveAttribute(
    'href',
    `/finance/close?periodId=${close.period.id}`,
  );
  await expect(card(page, 'ar_aging').getByRole('link', { name: '年齢表を開く' })).toHaveAttribute(
    'href',
    '/r/sales.ar_aging',
  );
  await shot(page, 'role-home-accounting.png');
  await recordTimings(page, 'accounting');

  // AC-7: only reads /meta allows, no 403, no /meta/health.
  await expectAllowedReads(request, own, log);

  // AC-15: focus, visibility and reconnect read nothing again; "Refresh" re-reads the view's cards.
  const settledCount = log.entries.length;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    window.dispatchEvent(new Event('online'));
  });
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(1_500);
  expect(log.entries.slice(settledCount).filter((entry) => entry.path.startsWith('/actions/'))).toEqual([]);
  const before = log.actions('sales.ar_aging').length;
  await page.getByTestId('home-refresh').click();
  await expect.poll(() => log.actions('sales.ar_aging').length).toBe(before + 1);
  await settled(page);

  // AC-4: showing the default view stores nothing; a stored view that is not available falls back to the default and
  // the stored value is left as it was.
  const key = `daifuku.home.v1.${JSON.stringify([own.user.tenantId, own.user.id, own.companyId])}`;
  const stored = () => page.evaluate((k) => localStorage.getItem(k), key);
  expect(await stored()).toBeNull();
  const unavailable = '{"version":1,"items":["store"]}';
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, unavailable] as const);
  await page.reload();
  await expect(tablist(page).getByRole('tab', { name: '経理' })).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, 'ar_aging')).toBeVisible();
  await settled(page);
  expect(await stored()).toBe(unavailable);

  // AC-3/AC-4: picking 全体 shows the general home and is remembered per tenant/user/company, across a reload.
  await tablist(page).getByRole('tab', { name: '全体' }).click();
  await expect(page.getByRole('heading', { name: '業務分野から始める' })).toBeVisible();
  expect(await stored()).toBe('{"version":1,"items":["general"]}');
  await page.reload();
  await expect(tablist(page).getByRole('tab', { name: '全体' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '業務分野から始める' })).toBeVisible();
  // Keyboard: arrows move between the views.
  await tablist(page).getByRole('tab', { name: '全体' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tablist(page).getByRole('tab', { name: '経理' })).toHaveAttribute('aria-selected', 'true');
  await expect(tablist(page).getByRole('tab', { name: '経理' })).toBeFocused();
  await expect(card(page, 'ar_aging')).toBeVisible();

  // AC-18: 390px without horizontal scrolling, English, axe.
  await layoutChecks(page, 'home-accounting');
});

const FAILURE = { error: { code: 'INTERNAL', message: 'E2E injected failure', hint: 'Retry later.' } };
const DENIED = { error: { code: 'PERMISSION_DENIED', message: 'E2E denied', hint: 'Ask an admin.' } };
const reply = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test('role-home AC-1/AC-16/AC-17: one failing card keeps the others; a refused card re-reads /meta once; no /meta, no view', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const f = await fixture(request);
  const log = networkLog(page);
  await page.route('**/actions/purchase.ap_aging', (route) => route.fulfill(reply(500, FAILURE)));
  await page.route('**/actions/accounting.trial_balance', (route) => route.fulfill(reply(403, DENIED)));
  await page.route('**/actions/accounting.close_readiness', (route) => route.fulfill(reply(500, FAILURE)));
  await login(page, f.accountant.email, PASSWORD);
  const ap = card(page, 'ap_aging');
  await expect(ap.getByTestId('home-card-failure')).toContainText('E2E injected failure');
  await expect(ap.locator('details')).not.toHaveAttribute('open', '');
  await expect(card(page, 'cash').getByTestId('home-card-denied')).toHaveText('この情報を表示する権限がありません。');
  await expect(card(page, 'cash').getByRole('button')).toHaveCount(0);
  await expect(value(page, 'ar_aging', 'home-aging-balance')).toBeVisible();
  await expect(card(page, 'close').getByTestId('home-card-failure')).toBeVisible();
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  await settled(page);
  await shot(page, 'role-home-failures.png');

  // AC-17: /meta is read again exactly once after the refusal, and the refused read is not repeated.
  const first = log.entries.findIndex((entry) => entry.path === '/actions/accounting.trial_balance');
  expect(first).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(1_000);
  expect(log.entries.slice(first).filter((entry) => entry.method === 'GET' && entry.path === '/meta')).toHaveLength(1);
  expect(log.actions('accounting.trial_balance')).toHaveLength(1);
  await expect(card(page, 'cash').getByTestId('home-card-denied')).toBeVisible();

  // AC-16: the retry reloads that card only, focuses its heading and announces the result politely.
  await page.unroute('**/actions/purchase.ap_aging');
  const arCalls = log.actions('sales.ar_aging').length;
  const retried = page.waitForResponse(
    (r) => r.url().endsWith('/actions/purchase.ap_aging') && r.request().method() === 'POST',
  );
  await ap.getByRole('button', { name: '買掛金を再試行' }).focus();
  await page.keyboard.press('Enter');
  expect((await retried).ok()).toBe(true);
  await expect(value(page, 'ap_aging', 'home-aging-balance')).toBeVisible();
  await expect(ap.getByRole('heading', { name: '買掛金', level: 3 })).toBeFocused();
  await expect(page.getByTestId('role-home-live')).toHaveText('買掛金: 取得しました');
  expect(log.actions('sales.ar_aging')).toHaveLength(arCalls);

  // AC-16/AC-17: a retry answered with 403 leaves a notice without a retry button; focus goes to the card heading (not
  // to <body>), the notice is announced, and /meta is not read a second time while this home stays open.
  const close = card(page, 'close');
  await page.unroute('**/actions/accounting.close_readiness');
  await page.route('**/actions/accounting.close_readiness', (route) => route.fulfill(reply(403, DENIED)));
  await close.getByRole('button', { name: '月次締めを再試行' }).focus();
  await page.keyboard.press('Enter');
  await expect(close.getByTestId('home-card-denied')).toBeVisible();
  await expect(close.getByRole('button')).toHaveCount(0);
  await expect(close.getByRole('heading', { name: '月次締め', level: 3 })).toBeFocused();
  await expect(page.getByTestId('role-home-live')).toHaveText('月次締め: この情報を表示する権限がありません。');
  const refusedCloses = log.actions('accounting.close_readiness').length;
  await page.waitForTimeout(1_000);
  expect(log.entries.slice(first).filter((entry) => entry.method === 'GET' && entry.path === '/meta')).toHaveLength(1);
  expect(log.actions('accounting.close_readiness')).toHaveLength(refusedCloses);

  // AC-1: when /meta cannot be read the existing MetaError (with its retry) shows, no view is decided and neither the
  // inbox nor any card reads.
  await page.route('**/meta', (route) =>
    route.fulfill(reply(500, { error: { ...FAILURE.error, message: 'E2E meta' } })),
  );
  const reloaded = log.entries.length;
  await page.reload();
  const metaError = page.getByTestId('meta-error');
  await expect(metaError).toBeVisible();
  await expect(metaError.getByRole('button', { name: '再試行', exact: true })).toBeVisible();
  await expect(tablist(page)).toHaveCount(0);
  await expect(page.getByTestId('role-home-view')).toHaveCount(0);
  await expect(page.getByTestId('inbox-card')).toHaveCount(0);
  await page.waitForTimeout(1_500);
  const after = log.entries.slice(reloaded);
  expect(after.some((entry) => entry.method === 'GET' && entry.path === '/meta')).toBe(true);
  expect(after.filter((entry) => /^\/(actions|api|analytics)\//.test(entry.path))).toEqual([]);
});

test('role-home AC-1/7/8/10/18: a site manager gets today’s attendance and this week’s shifts', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const f = await fixture(request);
  // Today's punch of the site's employee, and a draft plan for this week (made through the existing actions).
  const worker = await session(request, f.worker.email, PASSWORD);
  await api(request, worker.headers, '/actions/workforce.punch', {
    kind: 'clock_in',
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
  });
  const own = await session(request, f.manager.email, PASSWORD);
  const week = monday(TODAY);
  const board = await api<{ sourceRevision: string }>(request, own.headers, '/actions/workforce.shift_board', {
    siteId: f.site.id,
    weekStart: week,
  });
  await api(request, own.headers, '/actions/workforce.save_shift_plan', {
    siteId: f.site.id,
    weekStart: week,
    expectedVersion: 0,
    sourceRevision: board.sourceRevision,
    slots: [
      {
        id: 'rh-1',
        date: TODAY,
        label: '早番',
        startMinute: 540,
        endMinute: 1020,
        breakMinutes: 60,
        required: 1,
        skill: '',
      },
    ],
    assignments: [],
  });
  // AC-8: a second site outside the manager's membership, whose own employee also clocks in today. The company-wide
  // answer (admin) has that punch, so a card that lost the site filter would count it.
  const otherSite = await api(request, f.admin.headers, '/api/workforce_site', {
    code: `RH2-${f.suffix}`,
    name: `役割別ホーム別拠点 ${f.suffix}`,
  });
  const otherUser = await f.member('other', '別拠点従業員', ['workforce_employee'], 'sites', otherSite.id);
  await api(request, f.admin.headers, '/actions/workforce.register_employee', {
    userId: otherUser.id,
    siteId: otherSite.id,
    code: `RH2-${f.suffix}`,
    name: otherUser.name,
    hiredOn: `${TODAY.slice(0, 7)}-01`,
  });
  const otherWorker = await session(request, otherUser.email, PASSWORD);
  await api(request, otherWorker.headers, '/actions/workforce.punch', {
    kind: 'clock_in',
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
  });
  const everyone = await api<{ rows: { siteId: unknown }[] }>(request, f.admin.headers, '/analytics/snapshot', {
    dataset: 'workforce_attendance',
    from: TODAY,
    to: TODAY,
    state: 'all',
  });
  // The snapshot labels the site column (id or display name); either way the other site's row is there.
  expect(
    everyone.rows.some(
      (row) => String(row.siteId) === otherSite.id || String(row.siteId).includes(String(otherSite.name)),
    ),
  ).toBe(true);

  const log = networkLog(page);
  await login(page, f.manager.email, PASSWORD);
  await expect(tablist(page).getByRole('tab')).toHaveText(['店舗・拠点', '全体']);
  await expect(page.getByRole('heading', { name: '店舗・拠点の今日', level: 2 })).toBeVisible();
  await settled(page);
  // AC-8: the site membership is named on the cards; the values are the server's site-scoped answers (the other
  // site's punch and plan stay out).
  await expect(card(page, 'attendance').getByTestId('home-card-scope')).toHaveText('担当拠点');
  await expect(card(page, 'attendance').getByTestId('home-attendance-total').locator('.role-home-amount')).toHaveText(
    '1人',
  );
  await expect(card(page, 'attendance').locator('[data-status="working"]')).toHaveText('勤務中 1人');
  await expect(card(page, 'shift').getByTestId('home-card-scope')).toHaveText('担当拠点');
  await expect(card(page, 'shift').getByTestId('home-shift-site')).toHaveCount(1);
  await expect(card(page, 'shift')).not.toContainText(String(otherSite.name));
  const site = card(page, 'shift')
    .getByTestId('home-shift-site')
    .filter({ hasText: String(f.site.name) });
  await expect(site).toHaveAttribute('data-state', 'draft');
  await expect(site).toContainText('下書きのみ');
  await expect(card(page, 'sales_today')).toHaveCount(0);
  await shot(page, 'role-home-store.png');
  await recordTimings(page, 'store');
  await expectAllowedReads(request, own, log);
  await layoutChecks(page, 'home-store');
});

test('role-home AC-3/AC-14/AC-15: arrowing over a view does not read it; switching never re-reads the inbox', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const f = await fixture(request);
  const own = await session(request, f.multi.email, PASSWORD);
  const log = networkLog(page);
  await login(page, f.multi.email, PASSWORD);
  await expect(tablist(page).getByRole('tab')).toHaveText(['経理', '店舗・拠点', '従業員', '全体']);
  await expect(card(page, 'ar_aging')).toBeVisible();
  await settled(page);
  const todo = () =>
    log.entries.filter((entry) => /^\/actions\/[a-z_]+\.todo$/.test(entry.path) && !entry.aborted).length;
  const todos = todo();
  expect(todos).toBeGreaterThan(0);
  const storeReads = () =>
    log.entries.filter(
      (entry) =>
        entry.path === '/analytics/catalog' ||
        entry.path === '/actions/workforce_site.list' ||
        entry.path === '/actions/workforce.shift_board',
    ).length;
  expect(storeReads()).toBe(0);
  // Arrow quickly across 店舗・拠点 to 従業員: the store view is mounted for a moment but never reads.
  await tablist(page).getByRole('tab', { name: '経理' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tablist(page).getByRole('tab', { name: '従業員' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('home-employee')).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(storeReads()).toBe(0);
  // Settling on the store view reads it.
  await page.keyboard.press('ArrowLeft');
  await expect(card(page, 'shift')).toBeVisible();
  await expect.poll(storeReads).toBeGreaterThan(0);
  await settled(page);
  // AC-14: the inbox providers were not called again by any switch.
  expect(todo()).toBe(todos);
  await expectAllowedReads(request, own, log);
});

test('role-home AC-11/AC-18: an employee opening the home gets a primary link to the portal and no portal read', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const f = await fixture(request);
  const own = await session(request, f.worker.email, PASSWORD);
  const log = networkLog(page);
  await login(page, f.worker.email, PASSWORD);
  // The post-login redirect of employee-only users to /me is unchanged (decision 17); the home is opened explicitly.
  await page.waitForURL((url) => url.pathname === '/me');
  await page.goto('/');
  await expect(tablist(page).getByRole('tab')).toHaveText(['従業員', '全体']);
  await expect(page.getByTestId('home-employee')).toBeVisible();
  await settled(page);
  const portalReads = log.entries.length;
  await expect(page.getByTestId('home-employee').getByRole('link', { name: '自分のシフト' })).toHaveAttribute(
    'href',
    '/me?tab=shifts',
  );
  await layoutChecks(page, 'home-employee');
  // Nothing of the portal is read on the home itself.
  expect(log.entries.slice(portalReads).filter((entry) => entry.path === '/actions/workforce.my_portal')).toEqual([]);
  await expectAllowedReads(request, own, log);
  await page.getByTestId('home-employee-primary').click();
  await expect(page).toHaveURL(/\/me$/);
});

test('role-home AC-12: an admin gets the setup card above the general home and no setup-health request', async ({
  page,
}) => {
  const log = networkLog(page);
  await login(page, ADMIN, ADMIN_PASSWORD);
  const admin = page.getByTestId('home-admin');
  await expect(admin.getByRole('heading', { name: '導入・管理', level: 2 })).toBeVisible();
  // B3 (setup-health) and B4 (setup-wizard) are merged: their catalog entries add the setup check and wizard links;
  // the home only links to them (the wizard's own card is SetupCard above the views, outside this card).
  await expect(admin.getByTestId('home-admin-link')).toHaveText([
    '会社設定',
    '利用者と権限',
    '業界テンプレート',
    '導入チェックを開く',
    'セットアップを開く',
  ]);
  await expect(tablist(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '業務分野から始める' })).toBeVisible();
  await settled(page);
  expect(log.entries.filter((entry) => entry.path.startsWith('/meta/health'))).toEqual([]);
  expect(log.entries.filter((entry) => entry.status === 403)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await fullShot(page, 'role-home-home-admin-390.png');
});

/** The company picker reloads the page (a fresh query cache); wait for that load before moving on. */
async function switchCompany(page: Page, name: string) {
  await page.goto('/templates');
  const reloaded = page.waitForEvent('load');
  await page.getByLabel('対象の会社', { exact: true }).selectOption({ label: name });
  await reloaded;
  await expect(page.locator('.company-name')).toContainText(name);
}

test('role-home AC-6: switching company decides the view again and keeps each company’s choice', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const f = await fixture(request);
  const companies = await api<{ items: { id: string; name: string }[] }>(request, f.admin.headers, '/auth/companies');
  const other = companies.items.find((item) => item.id !== f.admin.companyId);
  expect(other).toBeDefined();
  await api(
    request,
    f.admin.headers,
    `/admin/users/${f.accountant.id}/companies/${other?.id}`,
    { expectedVersion: 0, roles: ['viewer'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  const log = networkLog(page);
  await login(page, f.accountant.email, PASSWORD);
  await tablist(page).getByRole('tab', { name: '全体' }).click();
  await expect(page.getByRole('heading', { name: '業務分野から始める' })).toBeVisible();

  await switchCompany(page, other?.name ?? '');
  const switched = log.entries.length;
  await page.goto('/');
  // A viewer in the other company: the general home only, and no accounting read.
  await expect(page.getByRole('heading', { name: '業務分野から始める' })).toBeVisible();
  await expect(tablist(page)).toHaveCount(0);
  await settled(page);
  expect(log.entries.slice(switched).filter((entry) => /aging|trial_balance|close_readiness/.test(entry.path))).toEqual(
    [],
  );

  await switchCompany(page, 'デモ株式会社');
  await page.goto('/');
  // Back in the first company, its own stored choice (全体) is used.
  await expect(tablist(page).getByRole('tab', { name: '全体' })).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, 'ar_aging')).toHaveCount(0);
});

/**
 * A daily closing dated today, submitted (posted) by headquarters for one store, through the existing stock entry and
 * closing endpoints (as operations-refresh.spec.ts does): its sales count in today's operations board.
 */
async function postTodaysClosing(request: APIRequestContext, headers: Headers, store: Row) {
  const products = await api<{ items: Row[] }>(request, headers, '/api/product?limit=500');
  const rice = products.items.find((row) => row.code === 'RC-RICE');
  const chicken = products.items.find((row) => row.code === 'RC-CHICKEN');
  const recipes = await api<{ items: Row[] }>(request, headers, '/api/restaurant_chain_recipe?limit=500');
  const recipe = recipes.items.find((row) => row.code === 'RC-CURRY-V1' && row.docstatus === 1);
  expect(rice && chicken && recipe, 'the restaurant sample has its curry recipe and ingredients').toBeTruthy();
  const stock = await api(request, headers, '/api/stock_entry', {
    type: 'receipt',
    date: TODAY,
    warehouseId: store.warehouseId,
    lines: {
      stock_entry_line: [
        { productId: rice?.id, quantity: '1', unitCost: '500' },
        { productId: chicken?.id, quantity: '1', unitCost: '1000' },
      ],
    },
  });
  await api(request, headers, `/api/stock_entry/${stock.id}/submit`, {});
  const draft = await api(request, headers, '/api/restaurant_chain_closing', {
    storeId: store.id,
    date: TODAY,
    cashAmount: '0',
    cardAmount: '1100',
    qrAmount: '0',
    cashSalesCounted: '0',
    lines: {
      restaurant_chain_closing_line: [
        { recipeId: recipe?.id, serviceMode: 'dine_in', quantity: '1', unitPrice: '1100' },
      ],
    },
  });
  const closing = await api(request, headers, `/api/restaurant_chain_closing/${draft.id}/submit`, {
    expectedVersion: draft.version,
  });
  expect(closing).toMatchObject({ docstatus: 1, total: '1100' });
}

test('role-home AC-8/AC-10/AC-14: a restaurant store manager sees today’s sales and the missing reports of the inbox read', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const admin = await session(request, ADMIN, ADMIN_PASSWORD);
  const companies = await api<{ items: { id: string; name: string }[] }>(request, admin.headers, '/auth/companies');
  const restaurant = companies.items.find((item) => item.name === '飲食チェーンサンプル｜こもれび食堂');
  expect(restaurant, 'the industry project applies the restaurant sample first').toBeDefined();
  const headers: Headers = { ...admin.headers, 'x-company-id': restaurant?.id ?? '' };
  const store = await newStore(request, headers, '役割別ホーム新店');
  const manager = await storeMember(request, headers, restaurant?.id ?? '', store.id, 'chain_manager');
  const own = await session(request, manager.email, PASSWORD, restaurant?.id);
  // AC-8: another store has posted sales today, so headquarters' board for today is not 0; the manager's must be.
  const neighbour = await newStore(request, headers, '役割別ホーム隣店');
  await postTodaysClosing(request, headers, neighbour);
  const hq = await api<{ overview: { grossSales: string } }>(
    request,
    headers,
    '/actions/restaurant_chain.operations_snapshot',
    { from: TODAY, to: TODAY },
  );
  expect(scaled(hq.overview.grossSales)).toBeGreaterThanOrEqual(scaled('1100'));
  const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  try {
    const log = networkLog(page);
    await login(page, manager.email, PASSWORD);
    await expect(page.getByRole('heading', { name: '店舗・拠点の今日', level: 2 })).toBeVisible();
    await settled(page);
    const sales = card(page, 'sales_today');
    // AC-8: a manager of the new store only: the server scopes the board to that store, so the neighbour's posted
    // sales (in headquarters' total above) are not in it.
    await expect(sales.getByTestId('home-card-scope')).toHaveText('担当店舗');
    await expect(sales.getByTestId('home-sales-gross').locator('[data-value]')).toHaveAttribute('data-value', '0');
    const snapshot = await api<{ overview: { grossSales: string; expectedOpenDays: number } }>(
      request,
      own.headers,
      '/actions/restaurant_chain.operations_snapshot',
      { from: TODAY, to: TODAY },
    );
    expect(snapshot.overview.grossSales).toBe('0');
    await expect(sales.getByTestId('home-sales-stores')).toContainText(
      `営業予定 ${snapshot.overview.expectedOpenDays}店舗`,
    );
    // AC-10: the missing-report card is drawn from the inbox read; nothing missing is not called zero.
    await expect(card(page, 'missing_reports').getByTestId('home-missing-none')).toHaveText(
      '受信箱に未提出の項目はありません（直近7日）。',
    );
    expect(log.actions('restaurant_chain.todo')).toHaveLength(1);
    await shot(page, 'role-home-restaurant.png');
    // AC-14: switching views never calls the provider again.
    await tablist(page).getByRole('tab', { name: '全体' }).click();
    await tablist(page).getByRole('tab', { name: '店舗・拠点' }).click();
    await expect(card(page, 'missing_reports')).toBeVisible();
    await settled(page);
    expect(log.actions('restaurant_chain.todo')).toHaveLength(1);
    await expectAllowedReads(request, own, log);
  } finally {
    await context.close();
  }
});
