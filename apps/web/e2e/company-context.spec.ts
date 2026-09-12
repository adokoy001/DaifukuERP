import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const FARM = '農家サンプル｜ひなた農園';
const APPLIANCE = '電器店サンプル｜あかり電器';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill(PASSWORD);
  if (process.env.E2E_TENANT_ID) {
    await page.getByText('組織を指定してログイン', { exact: true }).click();
    await page.getByLabel('組織ID（任意）').fill(process.env.E2E_TENANT_ID);
  }
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
}

async function selectCompany(page: Page, name: string) {
  await page.goto('/templates');
  await page.getByLabel('対象の会社').selectOption({ label: name });
  await expect(page.getByLabel('対象の会社')).toHaveValue(/^[0-9a-f-]{36}$/);
  await expect(page.locator('.company-name')).toContainText(name);
}

test('another tab cannot change an open form company or log it out', async ({ page, context }) => {
  await login(page);
  await selectCompany(page, APPLIANCE);
  await page.goto('/e/partner/new');
  const name = page.getByTestId('record-form').locator('div[data-field="name"] input');
  await name.fill('タブ内の未保存入力');
  const companyA = await page.evaluate(() => {
    const user = JSON.parse(sessionStorage.getItem('daifuku.user') ?? '{}') as { tenantId: string; id: string };
    return sessionStorage.getItem(`daifuku.company.${user.tenantId}.${user.id}`);
  });
  const other = await context.newPage();
  await login(other);
  await selectCompany(other, FARM);
  await expect(page.locator('.company-name')).toContainText(APPLIANCE);
  await expect(name).toHaveValue('タブ内の未保存入力');
  await other.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(other).toHaveURL(/\/login/);
  const meta = page.waitForResponse((response) => response.url().endsWith('/meta'));
  await page.reload();
  const response = await meta;
  expect(response.ok()).toBe(true);
  expect(response.request().headers()['x-company-id']).toBe(companyA);
  await expect(page.locator('.company-name')).toContainText(APPLIANCE);
  await other.close();
});

test('browser history after company switch uses current company and discards the old draft', async ({ page }) => {
  await login(page);
  await selectCompany(page, APPLIANCE);
  await page.goto('/e/partner/new');
  await page.getByTestId('record-form').locator('div[data-field="name"] input').fill('以前の会社の未保存入力');
  await selectCompany(page, FARM);
  await page.waitForLoadState('networkidle');
  await page.goBack();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/e\/partner\/new$/);
  await expect(page.locator('.company-name')).toContainText(FARM);
  await expect(page.getByTestId('record-form').locator('div[data-field="name"] input')).toHaveValue('');
});
