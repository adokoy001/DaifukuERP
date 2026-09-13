// Regression: the invoice itself must be entered through the UI, including product defaults and correction date.
// Requires the seeded isolated API/Web servers managed by the orchestrator; only supporting masters use API setup.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { BUSINESS_DATE, nextDate } from './environment.ts';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const TENANT = process.env.E2E_TENANT_ID;
const API = (process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

async function fixtures(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, ...(TENANT ? { tenantId: TENANT } : {}) },
  });
  expect(login.status()).toBe(200);
  const session = (await login.json()) as { token: string; user: { defaultCompanyId: string } };
  const headers = { authorization: `Bearer ${session.token}`, 'x-company-id': session.user.defaultCompanyId };
  const marker = Date.now().toString();
  const partnerName = `UI回帰 顧客 ${marker}`;
  const productName = `UI回帰 サービス ${marker}`;
  for (const [entity, data] of [
    ['partner', { code: `UI${marker}`, name: partnerName, isCustomer: true }],
    [
      'product',
      { code: `UI${marker}`, name: productName, kind: 'service', salePrice: '8000', taxCategory: 'standard' },
    ],
  ] as const) {
    const response = await request.post(`${API}/api/${entity}`, { headers, data });
    expect(response.ok(), `${entity}: ${await response.text()}`).toBe(true);
  }
  return { partnerName, productName };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill(PASSWORD);
  if (TENANT) {
    await page.getByText('組織を指定してログイン', { exact: true }).click();
    await page.getByLabel('組織ID（任意）').fill(TENANT);
  }
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
}

async function selectRef(cell: Locator, name: string) {
  await cell.getByRole('combobox').fill(name);
  await cell.getByRole('option').filter({ hasText: name }).first().click();
  await expect(cell.getByRole('combobox')).toHaveValue(name);
}

test('invoice UI defaults, dirty save protection, submit and dated cancellation', async ({ page, request }) => {
  const { partnerName, productName } = await fixtures(request);
  await login(page);
  await page.goto('/e/sales_invoice/new');
  const form = page.getByTestId('record-form');
  await expect(form).toHaveAttribute('data-mode', 'create');
  await selectRef(form.locator('div[data-field="partnerId"]'), partnerName);
  const invoiceDate = BUSINESS_DATE;
  const correctionDate = nextDate(invoiceDate);
  await form.locator('div[data-field="date"] input').fill(invoiceDate);
  await form.locator('div[data-field="priceIncludesTax"] input').uncheck();
  await expect(form.locator('div[data-field="taxSummary"] textarea')).toHaveCount(0);

  const grid = page.getByTestId('lines-sales_invoice_line');
  await grid.getByRole('button', { name: '行を追加' }).click();
  const row = grid.getByTestId('line-row');
  await selectRef(row.locator('td[data-field="productId"]'), productName);
  await expect(row.locator('td[data-field="description"] input')).toHaveValue(productName);
  await expect(row.locator('td[data-field="unitPrice"] input')).toHaveAttribute('data-raw', '8000');
  await expect(row.locator('td[data-field="quantity"] input')).toHaveAttribute('data-raw', '1');
  await expect(row.locator('td[data-field="taxCategory"] select')).toHaveValue('standard');
  await expect(row.locator('td[data-field="amount"] input')).toBeDisabled();
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(/\/e\/sales_invoice\/[0-9a-f-]{36}$/);
  await expect(form).toHaveAttribute('data-dirty', 'false');
  await expect(form.getByRole('table', { name: '税率別内訳' })).toContainText('8,800');

  const price = row.locator('td[data-field="unitPrice"] input');
  await price.click();
  await price.press('ControlOrMeta+a');
  await price.pressSequentially('9000');
  await expect(price).toHaveAttribute('data-raw', '9000');
  await expect(form).toHaveAttribute('data-dirty', 'true');
  await expect(page.getByRole('button', { name: '確定', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '削除', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form).toHaveAttribute('data-dirty', 'false');
  await expect(form.getByRole('table', { name: '税率別内訳' })).toContainText('9,900');
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');

  await page.getByRole('button', { name: '取消', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('訂正日（任意）').fill(correctionDate);
  await expect(dialog.getByLabel('訂正日（任意）')).toHaveValue(correctionDate);
  const cancelled = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/sales_invoice\/[^/]+\/cancel$/.test(r.url()),
  );
  // No blur step: submit must read the displayed value even if native date events differ across browsers.
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const response = await cancelled;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({ correctionDate });
  expect(await response.json()).toMatchObject({ docstatus: 2, cancelledDate: correctionDate });
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '2');
});
