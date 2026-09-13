import { findScreen, openScreen } from './navigation-helpers.ts';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { API, DAY, PASSWORD, adminHeaders, api, boardAction, login, member, newStore, openOperations, restaurant, type Row } from './operations-helpers.ts';

test('BI: exact sources, fresh CSV authorization, changed-filter guard and mobile layout', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1180 });
  await login(page); const companyId = await restaurant(page); const headers = await adminHeaders(request, companyId);
  await openScreen(page, '/reports');
  await expect(page.getByRole('heading', { name: '数字から、次の判断へ。' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'レポートを検索' }).fill('店舗');
  await expect(page.locator('.report-catalog .report-card').first()).toBeVisible();
  await openOperations(page);
  const input = { from: DAY, to: DAY, asOf: DAY };
  const data = await api<{ overview: { grossSales: string }; sourceTable: { rows: Row[] } }>(request, headers, '/actions/restaurant_chain.operations_snapshot', input);
  expect(data.sourceTable.rows.length).toBeGreaterThan(0);
  await expect(page.locator('.operations-metric').first()).toContainText(Number(data.overview.grossSales).toLocaleString('ja-JP'));
  const sources = page.locator('.control-panel').filter({ has: page.getByRole('heading', { name: '集計の根拠となる日次締め' }) });
  const fresh = page.waitForResponse((r) => r.url().endsWith('/actions/restaurant_chain.operations_sources/export') && r.request().method() === 'POST');
  const downloading = page.waitForEvent('download');
  await sources.getByRole('button', { name: /CSV/ }).click();
  const exportResponse = await fresh; expect(exportResponse.ok()).toBe(true); expect(exportResponse.request().postDataJSON()).toEqual(input);
  const download = await downloading; const path = await download.path(); expect(path).not.toBeNull();
  const csv = await readFile(path ?? '', 'utf8'); expect(csv).toContain('元の締め,締め番号,店舗');
  for (const row of data.sourceTable.rows) expect(csv).toContain(String(row.closingId));
  expect(csv).toContain(data.overview.grossSales);
  await page.getByLabel('対象期間・開始').fill(DAY.slice(0, 8) + '01');
  if (!DAY.endsWith('-01')) {
    await expect(page.getByRole('status').filter({ hasText: '条件が変わりました' })).toBeVisible();
    await expect(sources.getByRole('button', { name: /CSV/ })).toBeDisabled();
  }
  await page.getByRole('button', { name: '集計する', exact: true }).click();
  await expect(sources.getByRole('button', { name: /CSV/ })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('operations-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('対象店舗', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('operations-mobile.png'), fullPage: true });
});

test('stores: plan -> staff no-sales submission -> manager return/approve -> headquarters posting', async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  await login(page); const companyId = await restaurant(page); const headers = await adminHeaders(request, companyId);
  const store = await newStore(request, headers, '運営UI店舗 ' + Date.now());
  const staff = await member(request, headers, companyId, store.id, 'chain_staff');
  const manager = await member(request, headers, companyId, store.id, 'chain_manager');
  await openOperations(page, store.id);
  await page.getByRole('button', { name: '営業計画', exact: true }).click();
  let dialog = page.getByRole('dialog'); await dialog.getByLabel('対象店舗').selectOption(store.id);
  await dialog.getByLabel('1営業日の税込売上目標（円）').fill('10000');
  await dialog.getByRole('button', { name: '営業計画を作成', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByTestId('operations-board')).toContainText('未提出');
  const contextOptions = { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' };
  const staffContext = await browser.newContext(contextOptions);
  const managerContext = await browser.newContext(contextOptions);
  try {
    const clerkPage = await staffContext.newPage(); await login(clerkPage, staff.email, PASSWORD);
    await findScreen(clerkPage, '/admin/users');
    await expect(clerkPage.locator('main a[href="/admin/users"]')).toHaveCount(0);
    await openOperations(clerkPage);
    await expect(clerkPage.getByLabel('対象店舗', { exact: true }).locator('option')).toHaveCount(2);
    await expect(clerkPage.getByRole('button', { name: '営業計画', exact: true })).toHaveCount(0);
    await clerkPage.getByRole('button', { name: '売上ゼロ・休業を報告', exact: true }).click();
    dialog = clerkPage.getByRole('dialog'); await dialog.getByLabel('理由').fill('開店したが来店がなかったため。');
    await dialog.getByRole('button', { name: '売上ゼロ・休業を報告', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await boardAction(clerkPage, '提出', '店長へ提出');
    await expect(clerkPage.getByTestId('operations-board')).toContainText('店長確認待ち');
    await expect(clerkPage.getByTestId('operations-board').getByRole('button', { name: '承認', exact: true })).toHaveCount(0);
    const managerPage = await managerContext.newPage(); await login(managerPage, manager.email, PASSWORD); await openOperations(managerPage);
    await boardAction(managerPage, '差戻し', '報告を差戻し', '店頭確認の記載をお願いします');
    await openOperations(clerkPage); await expect(clerkPage.getByTestId('operations-board')).toContainText('店頭確認の記載');
    await boardAction(clerkPage, '提出', '店長へ提出');
    await openOperations(managerPage); await boardAction(managerPage, '承認', '報告を承認');
    await expect(managerPage.getByTestId('operations-board')).toContainText('本部確定待ち');
    await expect(managerPage.getByRole('button', { name: '本部確定', exact: true })).toHaveCount(0);
    await openOperations(page, store.id); await boardAction(page, '本部確定', '本部で確定');
    await expect(page.getByTestId('operations-board')).toContainText('売上ゼロ');
    const closings = await api<{ items: Row[] }>(request, headers, '/api/restaurant_chain_closing?limit=500');
    const closing = closings.items.find((row) => row.storeId === store.id);
    expect(closing).toMatchObject({ dayStatus: 'no_sales', docstatus: 1, total: '0', salesInvoiceId: null });
    const staffSession = await api<{ token: string }>(request, {}, '/auth/login', { email: staff.email, password: PASSWORD });
    const financial = await request.get(API + '/api/sales_invoice', { headers: { authorization: 'Bearer ' + staffSession.token, 'x-company-id': companyId } });
    expect(financial.status()).toBe(403);
    // Membership is reloaded for each request; revocation denies an already-open session immediately.
    await api(request, headers, '/admin/users/' + staff.id + '/companies/' + companyId, { expectedVersion: 1 }, 'DELETE');
    const deniedReport = clerkPage.waitForResponse((r) => r.url().endsWith('/actions/restaurant_chain.operations_snapshot') && r.request().method() === 'POST');
    await clerkPage.getByRole('button', { name: '集計する', exact: true }).click();
    expect((await deniedReport).status()).toBe(403);
    await expect(clerkPage.getByTestId('operations-board')).toHaveCount(0);
    await expect(clerkPage.locator('.operations-metric')).toHaveCount(0);
    await expect(clerkPage.getByRole('button', { name: /CSV/ })).toHaveCount(0);
    const deniedCsv = await request.post(API + '/actions/restaurant_chain.operations_sources/export', { headers: { authorization: 'Bearer ' + staffSession.token, 'x-company-id': companyId }, data: { from: DAY, to: DAY, asOf: DAY } });
    expect(deniedCsv.status()).toBe(403);
  } finally { await staffContext.close(); await managerContext.close(); }
});
