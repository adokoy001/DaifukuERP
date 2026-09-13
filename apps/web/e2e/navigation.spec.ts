import { join } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import type { AppMeta } from '../src/api/types.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { API, PASSWORD, adminHeaders, api, login, member, restaurant, type Row } from './operations-helpers.ts';

const menu = (page: Page) => page.getByRole('navigation', { name: 'メニュー', exact: true });
const screenLinks = (page: Page) => page.locator('.directory-records a[data-screen-href]');
const originalPath = (request: Request) => new URL(request.url()).pathname;
async function shot(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1440) < 760) {
    const opened = await page.getByRole('dialog', { name: 'メニュー', exact: true }).count();
    if (!opened) {
      await expect(menu(page)).toBeHidden();
      await expect.poll(() => page.locator('#app-navigation').evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    } else await expect.poll(() => page.locator('#app-navigation').evaluate((element) => element.getBoundingClientRect().left)).toBe(0);
  }
  await page.screenshot({ path: process.env.E2E_EVIDENCE_DIR ? join(process.env.E2E_EVIDENCE_DIR, name) : test.info().outputPath(name), fullPage: true });
}

async function loginWithMeta(page: Page): Promise<AppMeta> {
  const response = page.waitForResponse((item) => item.url().endsWith('/meta') && item.status() === 200);
  await login(page);
  return (await response).json() as Promise<AppMeta>;
}
async function catalogHrefs(page: Page): Promise<string[]> {
  const found: string[] = [];
  const pager = page.getByRole('navigation', { name: '画面一覧のページ' });
  for (let index = 0; index < 50; index++) {
    const links = await screenLinks(page).evaluateAll((items) => items.map((item) => item.getAttribute('href') ?? ''));
    expect(links.length).toBeGreaterThan(0); expect(links.length).toBeLessThanOrEqual(24);
    found.push(...links);
    if (!await pager.count() || await pager.getByRole('button', { name: '次へ', exact: true }).isDisabled()) return found;
    await pager.getByRole('button', { name: '次へ', exact: true }).click();
    await expect(screenLinks(page).first()).not.toHaveAttribute('href', links[0] ?? '');
  }
  throw new Error('The synthetic navigation catalog exceeded the bounded 50-page fixture.');
}
async function cancelledLeave(page: Page, click: () => Promise<unknown>, value: string) {
  const dialog = page.waitForEvent('dialog');
  const navigation = click();
  await (await dialog).dismiss(); await navigation;
  await expect(page).toHaveURL(/\/e\/partner\/new$/);
  await expect(page.getByTestId('record-form').locator('#f-name')).toHaveValue(value);
}

test('navigation AC-1/2/4/5/11: compact areas, complete paged directory and bilingual local search', async ({ page }) => {
  const meta = await loginWithMeta(page);
  const navHrefs = await menu(page).getByRole('link').evaluateAll((items) => items.map((item) => item.getAttribute('href')));
  expect(navHrefs.length).toBeLessThanOrEqual(11);
  expect(navHrefs.every((href) => href === '/' || href === '/me' || href === '/workspaces' || /^\/workspaces\/[a-z]+$/.test(href ?? ''))).toBe(true);
  await menu(page).getByRole('link', { name: 'すべての画面を探す', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'すべての画面を探す', exact: true })).toBeVisible();
  const total = Number((await page.locator('.directory-count').innerText()).match(/\/ (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(24);
  const all = await catalogHrefs(page);
  expect(all).toHaveLength(total); expect(new Set(all).size).toBe(total);
  const children = new Set(meta.entities.flatMap((entity) => (entity.lines ?? []).map((line) => line.entity)));
  for (const entity of meta.entities.filter((entity) => entity.ops.includes('read') && !children.has(entity.name))) expect(all).toContain(`/e/${entity.name}`);
  for (const action of meta.actions.filter((action) => action.resultKind === 'table')) expect(all).toContain(`/r/${action.name}`);
  for (const child of children) expect(all).not.toContain(`/e/${child}`);
  await page.getByRole('navigation', { name: '画面一覧のページ' }).getByRole('button', { name: '先頭', exact: true }).click();
  const recordRequests: string[] = [];
  page.on('request', (request) => { if (originalPath(request).startsWith('/api/')) recordRequests.push(request.url()); });
  await page.getByRole('searchbox', { name: '画面名を検索' }).fill('／Ｅ／ＰＡＲＴＮＥＲ');
  await expect(page.locator('.directory-records a[href="/e/partner"]')).toBeVisible();
  await expect(page.locator('.directory-count')).toHaveText('1–1 / 1 画面');
  await page.getByRole('searchbox', { name: '画面名を検索' }).fill('ぴぼっと');
  await expect(page.locator('.directory-records a[href="/analytics"]')).toBeVisible();
  await page.getByRole('searchbox', { name: '画面名を検索' }).fill('ぴぼっと 不存在語');
  await expect(page.getByText('条件に一致する画面がありません。短い言葉や別の種類で探してください。')).toBeVisible();
  await expect(screenLinks(page)).toHaveCount(0);
  await page.getByRole('button', { name: '検索条件をクリア', exact: true }).click();
  await page.getByRole('combobox', { name: '画面の種類', exact: true }).selectOption('report');
  const reports = await catalogHrefs(page);
  expect(reports.length).toBeGreaterThan(0); expect(reports.every((href) => href.startsWith('/r/'))).toBe(true);
  expect(recordRequests).toEqual([]);
  await page.getByRole('combobox', { name: '画面の種類', exact: true }).selectOption('record');
  await page.getByRole('searchbox', { name: '画面名を検索' }).fill('/e/');
  await page.getByRole('navigation', { name: '画面一覧のページ' }).getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page).toHaveURL(/[?&]page=2(?:&|$)/);
  const historyUrl = page.url(), firstRecord = await screenLinks(page).first().getAttribute('href');
  await screenLinks(page).first().click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(firstRecord);
  await page.goBack(); await expect(page).toHaveURL(historyUrl);
  await expect(page.getByRole('searchbox', { name: '画面名を検索' })).toHaveValue('/e/');
  await expect(page.getByRole('combobox', { name: '画面の種類', exact: true })).toHaveValue('record');
  await expect(screenLinks(page).first()).toHaveAttribute('href', firstRecord ?? '');
  // An actual record page above made its authorized list request; the search assertions below remain metadata-only.
  recordRequests.length = 0;
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await page.getByRole('combobox', { name: 'Screen type', exact: true }).selectOption('');
  await page.getByRole('searchbox', { name: 'Search screens' }).fill('PIVOT');
  await expect(page.locator('.directory-records a[href="/analytics"]')).toContainText('Pivot analytics');
  expect(recordRequests).toEqual([]);
  await shot(page, 'navigation-search-desktop.png');
});

test('navigation AC-6/7: area and original list breadcrumbs preserve a cancelled draft', async ({ page }) => {
  await login(page);
  await menu(page).getByRole('link', { name: '販売・仕入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '販売・仕入', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '画面名を検索' }).fill('/e/partner');
  await page.locator('.directory-records a[href="/e/partner"]').click();
  await expect(page).toHaveURL(/\/e\/partner$/);
  let trail = page.getByRole('navigation', { name: '現在位置' });
  await expect(trail.locator('a[href="/"]')).toBeVisible();
  await expect(trail.locator('a[href="/workspaces/sales"]')).toBeVisible();
  await expect(trail.locator('[aria-current="page"]')).toContainText('取引先');
  await page.getByRole('link', { name: /新規/ }).click();
  const value = '移動しても守る入力 ' + Date.now();
  await page.getByTestId('record-form').locator('#f-name').fill(value);
  trail = page.getByRole('navigation', { name: '現在位置' });
  await expect(trail.locator('[aria-current="page"]')).toHaveText('新規作成');
  await expect(trail.locator('a[href="/e/partner"]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'navigation-breadcrumb-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await cancelledLeave(page, () => trail.getByRole('link', { name: 'ホーム', exact: true }).click(), value);
  await cancelledLeave(page, () => trail.locator('a[href="/e/partner"]').click(), value);
  await cancelledLeave(page, () => menu(page).getByRole('link', { name: '分析・レポート', exact: true }).click(), value);
  const dialog = page.waitForEvent('dialog');
  const leave = trail.locator('a[href="/workspaces/sales"]').click();
  await (await dialog).accept(); await leave;
  await expect(page).toHaveURL(/\/workspaces\/sales$/);
  await expect(page.getByRole('heading', { name: '販売・仕入', exact: true })).toBeVisible();
});

test('navigation AC-8: 390px modal drawer traps focus, closes with Escape and returns to its trigger', async ({ page }) => {
  await login(page); await page.setViewportSize({ width: 390, height: 844 });
  const opener = page.getByRole('button', { name: 'メニューを開く', exact: true });
  await expect(menu(page)).toBeHidden();
  await opener.focus(); await opener.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'メニュー', exact: true });
  await expect(drawer).toBeVisible(); await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('main', { includeHidden: true })).toHaveAttribute('inert', '');
  const first = drawer.locator('a.brand'), last = drawer.getByRole('button', { name: '言語: en', exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
  await page.keyboard.press('Tab'); await expect(first).toBeFocused();
  await shot(page, 'navigation-drawer-mobile.png');
  await page.keyboard.press('Escape'); await expect(drawer).toHaveCount(0); await expect(opener).toBeFocused();
  await expect(menu(page)).toBeHidden();
  await page.keyboard.press('Tab'); await expect(menu(page).locator(':focus')).toHaveCount(0);
  await opener.click();
  await menu(page).getByRole('link', { name: '販売・仕入', exact: true }).click();
  await expect(drawer).toHaveCount(0); await expect(page).toHaveURL(/\/workspaces\/sales$/);
  await expect(page.locator('#screen-content')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'navigation-mobile-390.png');
});

test('navigation AC-3/10: a store employee finds permitted operations but no privileged destination', async ({ page, request, browser }) => {
  await login(page); const companyId = await restaurant(page), headers = await adminHeaders(request, companyId);
  const stores = await api<{ items: Row[] }>(request, headers, '/api/restaurant_chain_store?limit=500');
  const store = stores.items.find((item) => item.code === 'RC-A'); expect(store).toBeDefined();
  if (!store) throw new Error('The standard restaurant fixture is required.');
  const staff = await member(request, headers, companyId, store.id, 'chain_staff');
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  try {
    const employee = await context.newPage(); await login(employee, staff.email, PASSWORD);
    await openScreen(employee, '/operations');
    await expect(employee.getByTestId('operations-board')).toBeVisible();
    for (const href of ['/admin/users', '/settings', '/e/sales_invoice', '/workforce/payroll']) {
      await findScreen(employee, href);
      await expect(employee.locator(`main a[data-screen-href="${href}"]`)).toHaveCount(0);
      await expect(employee.locator('.directory-count')).toHaveText('0 画面');
    }
    const session = await api<{ token: string }>(request, {}, '/auth/login', { email: staff.email, password: PASSWORD });
    const denied = await request.get(API + '/api/sales_invoice', { headers: { authorization: 'Bearer ' + session.token, 'x-company-id': companyId } });
    expect(denied.status()).toBe(403);
  } finally { await context.close(); }
});


test('navigation AC-9: home fetches no document totals until opened, then only the selected module', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const countRequests: { entity: string; status: number }[] = [], counts = new Map<string, number>(), pending: Promise<void>[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url()), entity = /^\/api\/([a-z_]+)$/.exec(url.pathname)?.[1];
    if (!entity || url.searchParams.get('limit') !== '1' || !url.searchParams.has('where')) return;
    const where = JSON.parse(url.searchParams.get('where') ?? '{}') as { docstatus?: number };
    if (typeof where.docstatus !== 'number') return;
    const status = where.docstatus;
    countRequests.push({ entity, status });
    pending.push((async () => { expect(response.status()).toBe(200); const data = await response.json() as { total: number }; counts.set(`${entity}:${status}`, data.total); })());
  });
  const meta = await loginWithMeta(page);
  await expect(page.getByTestId('workspace-card').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(countRequests).toEqual([]); await expect(page.getByTestId('doc-card')).toHaveCount(0);
  await shot(page, 'navigation-home-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'navigation-home-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await menu(page).getByRole('link', { name: '人事・労務', exact: true }).click();
  await expect(page.getByRole('heading', { name: '人事・労務', exact: true })).toBeVisible();
  await shot(page, 'navigation-workforce-desktop.png');
  await menu(page).getByRole('link', { name: 'ホーム', exact: true }).click();
  await page.locator('summary').filter({ hasText: '伝票の状況を確認' }).click();
  const selector = page.getByRole('combobox', { name: '状況を確認する業務', exact: true });
  await expect(selector).toHaveValue('sales');
  const children = new Set(meta.entities.flatMap((entity) => (entity.lines ?? []).map((line) => line.entity)));
  for (const module of ['sales', 'purchase']) {
    if (module !== 'sales') { countRequests.length = 0; await selector.selectOption(module); }
    const documents = meta.entities.filter((entity) => entity.kind === 'document' && entity.module === module && !children.has(entity.name));
    expect(documents.length).toBeGreaterThan(0);
    await expect(page.getByTestId('module-section')).toHaveAttribute('data-module', module);
    await expect(page.getByTestId('doc-card')).toHaveCount(documents.length);
    await expect.poll(() => countRequests.length).toBe(documents.length * 3); await Promise.all(pending);
    expect(new Set(countRequests.map((request) => request.entity))).toEqual(new Set(documents.map((entity) => entity.name)));
    for (const entity of documents) for (const status of [0, 1, 2]) {
      const count = counts.get(`${entity.name}:${status}`); expect(count).toBeDefined();
      await expect(page.locator(`[data-entity="${entity.name}"] [data-docstatus="${status}"] [data-testid="doc-count"]`)).toHaveText(Number(count).toLocaleString('ja-JP'));
    }
  }
});
