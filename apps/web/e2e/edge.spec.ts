import { expect, test } from '@playwright/test';
import { qualitySession, signInQuality, assertNoOverflow, failedRead } from './quality-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
async function fixture(request: Parameters<typeof qualitySession>[0], role = 'edge_manager') {
  const session = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const site = await api(request, session.headers, '/api/workforce_site', {
    code: 'EDGE-' + suffix,
    name: '店舗連携検証 ' + suffix,
  });
  const email = `edge-${suffix}@example.com`;
  const user = await api(request, session.headers, '/admin/users', { name: '店舗機器担当', email, password: PASSWORD });
  await api(
    request,
    session.headers,
    `/admin/users/${user.id}/companies/${session.companyId}`,
    { expectedVersion: 0, roles: [role], accessScope: 'sites', siteIds: [site.id], storeIds: [] },
    'PUT',
  );
  const login = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  return {
    ...session,
    site,
    email,
    suffix,
    userId: user.id,
    adminHeaders: session.headers,
    headers: { authorization: 'Bearer ' + login.token, 'x-company-id': session.companyId },
  };
}
async function action(page: Parameters<typeof signInQuality>[0], name: string, execute: () => Promise<void>) {
  const waiting = page.waitForResponse(
    (response) => response.url().endsWith('/actions/edge.' + name) && response.request().method() === 'POST',
  );
  await execute();
  const response = await waiting;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<Row>;
}
test('site-scoped relay registration, simulator requests and cancellation work at 390px in both languages', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInQuality(page, f.email, PASSWORD);
  await page.goto('/operations/devices');
  await expect(page.getByRole('heading', { name: '店舗と機器を、つなぐ。', exact: true })).toBeVisible();
  await assertNoOverflow(page);
  await page.getByRole('button', { name: '中継を登録', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '設置する拠点', exact: true }).selectOption(f.site.id);
  expect(await dialog.getByLabel('設置する拠点').locator('option').count()).toBe(2);
  await dialog.getByLabel('中継コード', { exact: true }).fill('relay-' + f.suffix);
  await dialog.getByLabel('中継の名前', { exact: true }).fill('こもれび店 中継');
  const gateway = await action(page, 'create_gateway', () =>
    dialog.getByRole('button', { name: '中継を登録', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'この中継を見る', exact: true }).click();
  await page.getByRole('button', { name: '選択した中継に機器を登録', exact: true }).click();
  await dialog.getByLabel('機器名', { exact: true }).fill('カウンターの模擬機器');
  await dialog.getByLabel('店舗内の機器ID', { exact: true }).fill('counter-sim');
  await dialog.getByRole('combobox', { name: '接続方式', exact: true }).selectOption('simulator');
  await action(page, 'register_device', () => dialog.getByRole('button', { name: '機器を登録', exact: true }).click());
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '処理を依頼', exact: true }).click();
  await dialog.getByRole('combobox', { name: '処理の種類', exact: true }).selectOption('cash.dispense');
  await expect(
    dialog.getByText('これはシミュレーターです。実際の現金を払い出さず、会計や支払伝票も作成しません。'),
  ).toBeVisible();
  await dialog.getByLabel('模擬払い出し額（円）', { exact: true }).fill('1200');
  const job = await action(page, 'enqueue', () =>
    dialog.getByRole('button', { name: '処理を登録', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.edge-table')).toContainText('待機中');
  await assertNoOverflow(page);
  await page
    .locator('.edge-page')
    .evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: test.info().outputPath('edge-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.getByLabel('理由', { exact: true }).fill('模擬処理の取消を確認');
  await action(page, 'cancel', () => dialog.getByRole('button', { name: '理由を記録して取消', exact: true }).click());
  const board = await api<{ jobs: Row[]; gateways: Row[] }>(request, f.headers, '/actions/edge.board', {
    gatewayId: gateway.id,
  });
  expect(board.jobs.find((row) => row.id === job.id)?.state).toBe('cancelled');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('.edge-page')
    .evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your stores, connected.', exact: true })).toBeVisible();
  await expect(page.locator('.edge-table')).toContainText('Cancelled');
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('edge-desktop.png'), fullPage: true });
});
test('lost enqueue response retries the same payload and ID; failed refresh keeps print content', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  const gateway = await api(request, f.headers, '/actions/edge.create_gateway', {
    siteId: f.site.id,
    code: 'relay-' + f.suffix,
    name: '再送確認の中継',
  });
  const device = await api(request, f.headers, '/actions/edge.register_device', {
    gatewayId: gateway.id,
    localDeviceId: 'printer',
    name: '再送確認プリンター',
    driver: 'ipp_text',
  });
  await signInQuality(page, f.email, PASSWORD);
  await page.goto('/operations/devices');
  await page.getByRole('button', { name: '処理を依頼', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('印刷内容', { exact: true }).fill('重複させない印刷内容');
  const sent: unknown[] = [];
  let lose = true;
  await page.route('**/actions/edge.enqueue', async (route) => {
    sent.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (lose) {
      lose = false;
      await route.fulfill(failedRead());
    } else await route.fulfill({ response });
  });
  await dialog.getByRole('button', { name: '処理を登録', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '同じ依頼を確認', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('印刷内容', { exact: true })).toHaveValue('重複させない印刷内容');
  await page.route('**/actions/edge.board', (route) => route.fulfill(failedRead()));
  await page.waitForResponse(
    (response) => response.url().endsWith('/actions/edge.board') && response.status() === 503,
    { timeout: 25000 },
  );
  await expect(dialog.getByTestId('read-refresh-notice')).toBeVisible();
  await expect(dialog.getByLabel('印刷内容', { exact: true })).toHaveValue('重複させない印刷内容');
  await page.unroute('**/actions/edge.board');
  await dialog.getByRole('button', { name: '同じ依頼を確認', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  const board = await api<{ jobs: Row[] }>(request, f.headers, '/actions/edge.board', { gatewayId: gateway.id });
  expect(board.jobs.filter((row) => row.deviceId === device.id)).toHaveLength(1);
  await page.unroute('**/actions/edge.enqueue');
});
test('ordinary employees cannot open the device board or expose relay controls', async ({ page, request }) => {
  const f = await fixture(request, 'workforce_employee');
  await signInQuality(page, f.email, PASSWORD);
  await page.goto('/operations/devices');
  await expect(page.getByText('この会社で機器連携を利用する権限がありません。')).toBeVisible();
  await expect(page.getByRole('button', { name: '中継を登録', exact: true })).toHaveCount(0);
  await expect(page.locator('.edge-fleet')).toHaveCount(0);
});

test('role demotion removes an open management form on the next permission refresh', async ({ page, request }) => {
  const f = await fixture(request);
  await signInQuality(page, f.email, PASSWORD);
  await page.goto('/operations/devices');
  await page.getByRole('button', { name: '中継を登録', exact: true }).click();
  await page.getByRole('dialog').getByLabel('中継の名前', { exact: true }).fill('権限失効後に残さない入力');
  await api(
    request,
    f.adminHeaders,
    `/admin/users/${f.userId}/companies/${f.companyId}`,
    { expectedVersion: 1, roles: ['edge_operator'], accessScope: 'sites', siteIds: [f.site.id], storeIds: [] },
    'PUT',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 25000 });
  await expect(page.getByRole('button', { name: '中継を登録', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '店舗と機器を、つなぐ。', exact: true })).toBeVisible();
});
test('changing allowed sites removes an open request and the previous site data', async ({ page, request }) => {
  const f = await fixture(request);
  const gateway = await api(request, f.headers, '/actions/edge.create_gateway', {
    siteId: f.site.id,
    code: 'relay-' + f.suffix,
    name: '以前の拠点の中継',
  });
  await api(request, f.headers, '/actions/edge.register_device', {
    gatewayId: gateway.id,
    localDeviceId: 'printer',
    name: '以前の拠点の機器',
    driver: 'ipp_text',
  });
  const other = await api(request, f.adminHeaders, '/api/workforce_site', {
    code: 'NEW-' + f.suffix,
    name: '新しい拠点',
  });
  await signInQuality(page, f.email, PASSWORD);
  await page.goto('/operations/devices');
  await page.getByRole('button', { name: '処理を依頼', exact: true }).click();
  await page.getByRole('dialog').getByLabel('印刷内容', { exact: true }).fill('以前の拠点の本文');
  await api(
    request,
    f.adminHeaders,
    `/admin/users/${f.userId}/companies/${f.companyId}`,
    { expectedVersion: 1, roles: ['edge_manager'], accessScope: 'sites', siteIds: [other.id], storeIds: [] },
    'PUT',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 25000 });
  await expect(page.getByText('以前の拠点の機器', { exact: true })).toHaveCount(0);
  await expect(page.getByText('以前の拠点の中継', { exact: true })).toHaveCount(0);
});
