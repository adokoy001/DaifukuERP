// Route failures affect only this browser; all successful reads/writes use isolated real E2E data.
import { expect, test, type Page } from '@playwright/test';
import { api, PASSWORD } from './operations-helpers.ts';
import { assertNoOverflow, failedRead, qualityEmployee, qualityPartner, qualitySession, signInQuality } from './quality-helpers.ts';

async function openExpense(page: Page, email: string) {
  await page.setViewportSize({ width: 375, height: 812 }); await signInQuality(page, email, PASSWORD);
  await expect(page.getByTestId('employee-portal')).toBeVisible();
  await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: '経費', exact: true }).click();
  await page.getByRole('button', { name: '経費を記録', exact: true }).click();
  return page.getByRole('dialog');
}
async function pollRead(page: Page, suffix: string) {
  const response = page.waitForResponse((r) => r.url().endsWith(suffix));
  await page.clock.runFor(30_100); return response;
}

test('read recovery: mobile expense draft survives polling failure, retry and successful save', async ({ page, request }) => {
  const person = await qualityEmployee(request), description = '通信中も保持する経費 ' + crypto.randomUUID();
  await page.clock.install(); const dialog = await openExpense(page, person.email);
  await dialog.getByLabel('経費の区分', { exact: true }).fill('交通費');
  await dialog.getByLabel('精算する金額（円）', { exact: true }).fill('1234');
  await dialog.getByLabel('利用目的・内容', { exact: true }).fill(description);
  await dialog.getByLabel('証憑の内容・保管場所', { exact: true }).fill('品質検証で作成した合成領収書');
  await page.route('**/actions/workforce.my_portal', (route) => route.fulfill(failedRead()));
  expect((await pollRead(page, '/actions/workforce.my_portal')).status()).toBe(503);
  const notice = dialog.getByTestId('read-refresh-notice');
  await expect(notice).toBeVisible(); await expect(dialog.getByLabel('利用目的・内容', { exact: true })).toHaveValue(description);
  await expect(dialog.getByLabel('精算する金額（円）', { exact: true })).toHaveValue('1234'); await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('expense-recovery-mobile-375.png'), fullPage: true });
  await page.unroute('**/actions/workforce.my_portal');
  const restored = page.waitForResponse((r) => r.url().endsWith('/actions/workforce.my_portal') && r.ok());
  await notice.getByRole('button', { name: '再取得', exact: true }).click(); await restored;
  await expect(notice).toHaveCount(0); await expect(dialog.getByLabel('利用目的・内容', { exact: true })).toHaveValue(description);
  const saved = page.waitForResponse((r) => r.url().endsWith('/actions/workforce.save_expense'));
  await dialog.getByRole('button', { name: '下書きを保存', exact: true }).click();
  const response = await saved; expect(response.ok(), await response.text()).toBe(true);
  const command = await response.json(); expect(command).toMatchObject({ status: 'draft' });
  expect(await api(request, person.headers, '/api/workforce_expense/' + command.id)).toMatchObject({ description, amount: '1234', status: 'draft' });
  await expect(dialog).toHaveCount(0); await expect(page.locator('article.workforce-record').filter({ hasText: description })).toBeVisible();
});

for (const status of [401, 403, 404]) test(`read recovery: ${status} removes the open draft and cached employee view`, async ({ page, request }) => {
  const person = await qualityEmployee(request); await page.clock.install();
  const dialog = await openExpense(page, person.email);
  await dialog.getByLabel('利用目的・内容', { exact: true }).fill('非公開の編集中の内容');
  await page.route('**/actions/workforce.my_portal', (route) => route.fulfill(failedRead(status)));
  expect((await pollRead(page, '/actions/workforce.my_portal')).status()).toBe(status);
  await expect(page.getByTestId('employee-portal')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('textarea[name=description]')).toHaveCount(0);
  await expect(page.getByTestId('read-refresh-notice')).toHaveCount(0);
  if (status === 401) await expect(page).toHaveURL(/\/login/);
});

test('read recovery: headquarters input survives a temporary management read error', async ({ page, request }) => {
  const person = await qualityEmployee(request); await page.clock.install(); await signInQuality(page); await page.goto('/workforce');
  await expect(page.getByTestId('workforce-management')).toBeVisible();
  await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: '従業員', exact: true }).click();
  await page.getByRole('button', { name: '有給を付与', exact: true }).click();
  const dialog = page.getByRole('dialog'), basis = '付与する前に確認中の根拠 ' + crypto.randomUUID();
  await dialog.getByLabel('対象の従業員', { exact: true }).selectOption(person.employee.id);
  await dialog.getByLabel('付与日数・資格の根拠', { exact: true }).fill(basis);
  await page.route('**/actions/workforce.management_portal', (route) => route.fulfill(failedRead()));
  expect((await pollRead(page, '/actions/workforce.management_portal')).status()).toBe(503);
  await expect(dialog.getByTestId('read-refresh-notice')).toBeVisible();
  await expect(dialog.getByLabel('付与日数・資格の根拠', { exact: true })).toHaveValue(basis);
  await expect(dialog.getByLabel('対象の従業員', { exact: true })).toHaveValue(person.employee.id);
  await page.unroute('**/actions/workforce.management_portal');
  await dialog.getByTestId('read-refresh-notice').getByRole('button').click();
  await expect(dialog.getByTestId('read-refresh-notice')).toHaveCount(0);
  await expect(dialog.getByLabel('付与日数・資格の根拠', { exact: true })).toHaveValue(basis);
});

async function reconnect(page: Page) {
  await page.clock.runFor(6_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('read recovery: generic record reconnect preserves dirty values, then 404 hides the form', async ({ page, request }) => {
  const { headers } = await qualitySession(request), partner = await qualityPartner(request, headers, '再取得検証 ' + crypto.randomUUID());
  await page.clock.install(); await signInQuality(page); await page.goto('/e/partner/' + partner.id);
  const input = page.getByTestId('record-form').locator('input[name=name]'), changed = '編集中の取引先 ' + crypto.randomUUID();
  await input.fill(changed);
  const path = '**/api/partner/' + partner.id;
  await page.route(path, (route) => route.fulfill(failedRead()));
  const failed = page.waitForResponse((r) => r.url().endsWith('/api/partner/' + partner.id));
  await reconnect(page); expect((await failed).status()).toBe(503);
  await expect(page.getByTestId('read-refresh-notice')).toBeVisible(); await expect(input).toHaveValue(changed);
  await page.unroute(path); await page.getByTestId('read-refresh-notice').getByRole('button').click();
  await expect(page.getByTestId('read-refresh-notice')).toHaveCount(0); await expect(input).toHaveValue(changed);
  await page.route(path, (route) => route.fulfill(failedRead(404)));
  const missing = page.waitForResponse((r) => r.url().endsWith('/api/partner/' + partner.id));
  await reconnect(page); expect((await missing).status()).toBe(404);
  await expect(page.getByTestId('record-form')).toHaveCount(0); await expect(page.getByTestId('read-refresh-notice')).toHaveCount(0);
});
