// docs/specs/inbox.md AC-4..AC-9 in the browser. API setup only creates identities, a work site and the employee's
// submitted expense; the inbox, its failure handling and the navigation are exercised through the UI.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';
import { findScreen } from './navigation-helpers.ts';
import { api, login, PASSWORD, type Headers, type Row } from './operations-helpers.ts';

const ADMIN = process.env.E2E_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'password';

async function session(request: APIRequestContext, email: string, password: string) {
  const auth = await api<{ token: string; user: { id: string; defaultCompanyId: string } }>(
    request,
    {},
    '/auth/login',
    { email, password },
  );
  const headers: Headers = { authorization: 'Bearer ' + auth.token, 'x-company-id': auth.user.defaultCompanyId };
  return { headers, companyId: auth.user.defaultCompanyId };
}
const [YEAR, MONTH] = BUSINESS_DATE.split('-').map(Number) as [number, number];
/** YYYY-MM of the month before the business date (the employee is hired from its first day). */
const PREVIOUS_MONTH = MONTH === 1 ? `${YEAR - 1}-12` : `${YEAR}-${String(MONTH - 1).padStart(2, '0')}`;

async function fixture(request: APIRequestContext) {
  const admin = await session(request, ADMIN, ADMIN_PASSWORD);
  const suffix = Date.now().toString(36);
  const site = await api(request, admin.headers, '/api/workforce_site', {
    code: `INB-${suffix}`,
    name: `受信箱拠点 ${suffix}`,
  });
  const member = async (name: string, roles: string[], siteIds: string[], accessScope: 'sites' | 'all' = 'sites') => {
    const email = `inbox.${roles[0]}.${suffix}@example.com`;
    const user = await api(request, admin.headers, '/admin/users', {
      name: `${name} ${suffix}`,
      email,
      password: PASSWORD,
    });
    await api(
      request,
      admin.headers,
      `/admin/users/${user.id}/companies/${admin.companyId}`,
      { expectedVersion: 0, roles, accessScope, storeIds: [], siteIds },
      'PUT',
    );
    return { ...user, name: String(user.name), email };
  };
  const employee = await member('受信箱本人', ['workforce_employee'], [site.id]);
  // edge_manager: edge.todo is manager-only because only managers can resolve an uncertain device job.
  const manager = await member('受信箱管理', ['workforce_manager', 'edge_manager'], [site.id]);
  const viewer = await member('受信箱閲覧', ['viewer'], [], 'all');
  await api(request, admin.headers, '/actions/workforce.register_employee', {
    userId: employee.id,
    siteId: site.id,
    code: `INB-${suffix}`,
    name: employee.name,
    hiredOn: `${PREVIOUS_MONTH}-01`,
  });
  const own = await session(request, employee.email, PASSWORD);
  const saved = await api<Row>(request, own.headers, '/actions/workforce.save_expense', {
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
    expenseDate: BUSINESS_DATE,
    category: '交通費',
    description: '受信箱のE2E（合成データ）',
    amount: '1200',
    evidence: '合成の領収書参照-INBOX',
  });
  await api(request, own.headers, '/actions/workforce.submit_expense', {
    expenseId: saved.id,
    expectedVersion: saved.version,
  });
  return { employee, manager, viewer, own };
}
const group = (page: Page, action: string) => page.locator(`[data-testid="inbox-group"][data-provider="${action}"]`);
async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('inbox AC-4/5/6/7/8/9: expense awaiting approval on home and /inbox, one provider failing with retry, 390px', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120_000);
  const f = await fixture(request);
  const calls: string[] = [];
  page.on('request', (r) => {
    const match = /\/actions\/([a-z_]+\.todo)$/.exec(new URL(r.url()).pathname);
    if (match?.[1] && r.method() === 'POST') calls.push(match[1]);
  });
  // AC-5: one provider (edge.todo) fails from the first load on.
  await page.route('**/actions/edge.todo', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'E2E injected failure', hint: 'Retry later.' } }),
    }),
  );
  await login(page, f.manager.email, PASSWORD);

  // AC-4: the home card shows the total and the item, counted inside the manager's site.
  const card = page.getByTestId('inbox-card');
  await expect(card.getByTestId('inbox-total')).toHaveText('合計 1件');
  const item = card.getByTestId('inbox-item').filter({ hasText: '承認待ちの経費' });
  await expect(item).toContainText('1件');
  await expect(item).toContainText('従業員・労務');
  await expect(item).toHaveAttribute('href', `/workforce?period=${BUSINESS_DATE.slice(0, 7)}`);
  // AC-5: the home card names the business that failed and points to the inbox.
  const failed = card.getByTestId('inbox-card-failed');
  await expect(failed).toContainText('店舗機器連携の件数を取得できませんでした。');
  await expect(failed.getByRole('link', { name: '受信箱で再試行' })).toHaveAttribute('href', '/inbox');
  await shot(page, 'inbox-home-card.png');

  // AC-7: focus, visibility, reconnect and going offline and back do not read the inbox again.
  const settled = calls.length;
  // TanStack Query listens for `visibilitychange` on window (focus refetch) and for online/offline (reconnect refetch).
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    window.dispatchEvent(new Event('online'));
  });
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(2_000);
  expect(calls).toHaveLength(settled);

  await card.getByRole('link', { name: 'すべて見る' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole('heading', { name: 'やること', exact: true, level: 1 })).toBeVisible();
  await expect(group(page, 'workforce.todo').getByTestId('inbox-item')).toContainText('承認待ちの経費');
  // AC-5: only the failed group says so, with the server message; code, HTTP status and hint stay in the details.
  const edge = group(page, 'edge.todo');
  await expect(edge).toContainText('取得できませんでした');
  await expect(edge).toContainText('E2E injected failure');
  await expect(edge.locator('details')).not.toHaveAttribute('open', '');
  await expect(edge.locator('details')).toContainText('Retry later.');
  await expect(page.getByTestId('inbox-summary')).toContainText('合計 1件（1業務は取得できませんでした）');
  await shot(page, 'inbox-provider-failure.png');

  // AC-5/AC-7: the retry reloads the failed provider only; nothing else is requested again. Focus moves to the group
  // heading once the items replace the failure, and the result is announced.
  await page.unroute('**/actions/edge.todo');
  const before = calls.filter((name) => name === 'workforce.todo').length;
  const retried = page.waitForResponse(
    (r) => r.url().endsWith('/actions/edge.todo') && r.request().method() === 'POST',
  );
  await edge.getByRole('button', { name: '店舗機器連携を再試行' }).focus();
  await page.keyboard.press('Enter');
  expect((await retried).ok()).toBe(true);
  await expect(edge).toContainText('処理待ちはありません。');
  await expect(edge.getByRole('heading', { name: '店舗機器連携', level: 2 })).toBeFocused();
  await expect(page.getByTestId('inbox-live')).toHaveText('店舗機器連携: 取得しました');
  expect(calls.filter((name) => name === 'workforce.todo')).toHaveLength(before);
  await expect(page.getByTestId('inbox-summary')).toHaveText('合計 1件');

  // AC-4/AC-6: the item opens the approval screen on the month of the pending expense.
  await group(page, 'workforce.todo').getByTestId('inbox-item').click();
  await expect(page).toHaveURL(new RegExp(`/workforce\\?period=${BUSINESS_DATE.slice(0, 7)}$`));
  const pending = page.locator('article.workforce-record').filter({ hasText: f.employee.name });
  await expect(pending.first()).toBeVisible();

  // AC-8: the inbox is a screen of the authorized catalog and can be found by name.
  await findScreen(page, '受信箱');
  await expect(page.locator('main a[data-screen-href="/inbox"]')).toHaveCount(1);

  // AC-9: usable at 390px without horizontal scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/inbox');
  await expect(group(page, 'workforce.todo').getByTestId('inbox-item')).toBeVisible();
  await noOverflow(page);
  await shot(page, 'inbox-390.png');
  await page.goto('/');
  await expect(page.getByTestId('inbox-card').getByTestId('inbox-item').first()).toBeVisible();
  await noOverflow(page);
});

test('inbox AC-2/AC-6: a returned expense of the previous month opens the employee portal on that tab and month', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  const description = '受信箱の差戻しE2E（合成データ）';
  const saved = await api<Row>(request, f.own.headers, '/actions/workforce.save_expense', {
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
    expenseDate: `${PREVIOUS_MONTH}-15`,
    category: '交通費',
    description,
    amount: '800',
    evidence: '合成の領収書参照-INBOX-RETURN',
  });
  const submitted = await api<Row>(request, f.own.headers, '/actions/workforce.submit_expense', {
    expenseId: saved.id,
    expectedVersion: saved.version,
  });
  const manager = await session(request, f.manager.email, PASSWORD);
  await api(request, manager.headers, '/actions/workforce.review_expense', {
    expenseId: saved.id,
    expectedVersion: submitted.version,
    decision: 'return',
    reason: '証憑の参照先を確認してください',
  });

  await login(page, f.employee.email, PASSWORD);
  await page.goto('/'); // an employee lands on the portal; the inbox card is on the home screen
  const item = page
    .getByTestId('inbox-card')
    .getByTestId('inbox-item')
    .filter({ hasText: '差し戻された自分の勤怠・経費' });
  await expect(item).toHaveAttribute('href', new RegExp(`^/me\\?(?=.*tab=expenses)(?=.*period=${PREVIOUS_MONTH})`));
  await expect(item.getByTestId('inbox-item-count')).toHaveText('急ぎ1件'); // urgency is written, not only coloured
  await item.click();
  await page.waitForURL((url) => url.pathname === '/me' && url.searchParams.get('period') === PREVIOUS_MONTH);
  await expect(page.getByRole('button', { name: '経費', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('表示する月')).toHaveValue(PREVIOUS_MONTH);
  await expect(page.getByText(description).first()).toBeVisible();
});

test('inbox AC-3/AC-8: a user without any runnable provider has no inbox card or screen entry', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await login(page, f.viewer.email, PASSWORD);
  await expect(page.getByRole('heading', { name: '業務分野から始める' })).toBeVisible();
  await expect(page.getByTestId('inbox-card')).toHaveCount(0);
  await findScreen(page, '受信箱');
  await expect(page.locator('main a[data-screen-href="/inbox"]')).toHaveCount(0);
});
