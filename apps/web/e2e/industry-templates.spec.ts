import { findScreen } from './navigation-helpers.ts';
// Real UI workflows in the three prepared demo companies. Core documents/actions are entered through the browser;
// API writes only prepare supporting restaurant stock/masters. Every run uses new operational records.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';

const API = (process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const TENANT = process.env.E2E_TENANT_ID;
const DATE = BUSINESS_DATE;
const companies = {
  appliance_store: '電器店サンプル｜あかり電器',
  farm: '農家サンプル｜ひなた農園',
  restaurant_chain: '飲食チェーンサンプル｜こもれび食堂',
};
const menuNames = { appliance_store: '設置・修理受付', farm: '農作業・資材投入', restaurant_chain: '店舗の日次締め' };
type Pack = keyof typeof companies;
type Row = Record<string, unknown> & { id: string };
type PageResult = { items: Row[]; total: number };
type Headers = Record<string, string>;

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
async function selectCompany(page: Page, pack: Pack) {
  await page.goto('/templates');
  const picker = page.getByLabel('対象の会社', { exact: true });
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: companies[pack] });
  await expect(page.getByLabel('対象の会社', { exact: true })).toHaveValue(/^[0-9a-f-]{36}$/);
  await expect(page.getByLabel('対象の会社', { exact: true }).locator('option:checked')).toHaveText(companies[pack]);
  return page.getByLabel('対象の会社', { exact: true }).inputValue();
}
async function applyTemplate(page: Page, pack: Pack) {
  const card = page.getByTestId(`template-${pack}`);
  await expect(card).toBeVisible();
  if (await card.getByLabel('サンプルデータも追加する').count()) {
    await card.getByLabel('サンプルデータも追加する').check();
    await card.getByRole('button', { name: /この会社に導入|サンプルを追加/ }).click();
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/actions/pack.apply'),
    );
    await page.getByRole('dialog').getByRole('button', { name: 'テンプレートを適用', exact: true }).click();
    const applied = await response;
    expect(applied.ok(), await applied.text()).toBe(true);
    expect(applied.request().postDataJSON()).toEqual({ name: pack, sample: true });
  }
  await expect(card).toContainText('サンプル追加済み');
  await expect(card).toContainText('利用中');
}
async function api(request: APIRequestContext, headers: Headers, path: string, data?: unknown): Promise<Row> {
  const response =
    data === undefined
      ? await request.get(`${API}${path}`, { headers })
      : await request.post(`${API}${path}`, { headers, data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<Row>;
}
async function headersFor(request: APIRequestContext, companyId: string): Promise<Headers> {
  const session = await api(request, {}, '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
    ...(TENANT ? { tenantId: TENANT } : {}),
  });
  return { authorization: `Bearer ${String(session.token)}`, 'x-company-id': companyId };
}
async function list(request: APIRequestContext, headers: Headers, entity: string): Promise<Row[]> {
  const result = (await api(request, headers, `/api/${entity}?limit=500`)) as unknown as PageResult;
  return result.items;
}
async function choose(cell: Locator, name: string) {
  const input = cell.getByRole('combobox');
  await input.fill(name);
  await cell.getByRole('option').filter({ hasText: name }).first().click();
  await expect(input).toHaveValue(name);
}
async function number(cell: Locator, value: string) {
  const input = cell.locator('input');
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.pressSequentially(value);
  await input.press('Tab');
  await expect(input).toHaveAttribute('data-raw', value);
}
async function save(page: Page, entity: string): Promise<Row> {
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/${entity}`));
  await page.getByTestId('record-form').getByRole('button', { name: '保存', exact: true }).click();
  const saved = await response;
  expect(saved.ok(), await saved.text()).toBe(true);
  const row = (await saved.json()) as Row;
  await expect(page).toHaveURL(new RegExp(`/e/${entity}/${row.id}$`));
  await expect(page.getByTestId('record-form')).toHaveAttribute('data-dirty', 'false');
  return row;
}
async function submit(page: Page, entity: string): Promise<Row> {
  await page.getByRole('button', { name: '確定', exact: true }).click();
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(`/api/${entity}/`) && r.url().endsWith('/submit'),
  );
  await page.getByRole('dialog').getByRole('button', { name: '確定', exact: true }).click();
  const submitted = await response;
  expect(submitted.ok(), await submitted.text()).toBe(true);
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');
  return submitted.json() as Promise<Row>;
}
async function action(page: Page, name: string, title: string, extra: Record<string, string> = {}): Promise<Row> {
  await page.goto(`/a/${name}`);
  const form = page.getByTestId('business-action-form');
  await choose(form.locator('[data-field="serviceId"]'), title);
  for (const [key, value] of Object.entries(extra))
    await form.locator(`[data-field="${key}"]`).locator('input,textarea').fill(value);
  await form.getByRole('button', { name: '実行', exact: true }).click();
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/actions/${name}`));
  await page.getByRole('dialog').getByRole('button', { name: '実行する', exact: true }).click();
  const completed = await response;
  expect(completed.ok(), await completed.text()).toBe(true);
  await expect(page.getByTestId('business-action-result')).toBeVisible();
  return completed.json() as Promise<Row>;
}
async function isolatedMenu(page: Page, pack: Pack) {
  for (const candidate of Object.keys(companies) as Pack[]) {
    await findScreen(page, menuNames[candidate]);
    const link = page
      .locator('main .screen-card')
      .filter({ has: page.getByText(menuNames[candidate], { exact: true }) });
    if (candidate === pack) await expect(link).toBeVisible();
    else await expect(link).toHaveCount(0);
  }
}

test('電器店: 画面導入・受付作成・開始・作業完了・請求を汎用業務フォームで通す', async ({ page, request }) => {
  test.setTimeout(180_000);
  await login(page);
  const companyId = await selectCompany(page, 'appliance_store');
  await applyTemplate(page, 'appliance_store');
  await isolatedMenu(page, 'appliance_store');
  const headers = await headersFor(request, companyId);
  const devices = await list(request, headers, 'appliance_store_device');
  const device = devices.find((row) => row.code === 'DEV-APP-FRIDGE');
  expect(device).toBeDefined();
  const partner = await api(request, headers, `/api/partner/${String(device?.partnerId)}`);
  const products = await list(request, headers, 'product');
  const product = products.find((row) => row.code === 'APP-REPAIR');
  const title = `UI修理 ${Date.now()}`;
  await page.goto('/e/appliance_store_service/new');
  const form = page.getByTestId('record-form');
  await form.locator('[data-field="title"] input').fill(title);
  await choose(form.locator('[data-field="partnerId"]'), String(partner.name));
  await choose(form.locator('[data-field="deviceId"]'), String(device?.name));
  await form.locator('[data-field="date"] input').fill(DATE);
  await form.locator('[data-field="request"] textarea').fill('冷蔵庫の異音点検を依頼。');
  const grid = page.getByTestId('lines-appliance_store_service_line');
  await grid.getByRole('button', { name: '行を追加' }).click();
  await choose(grid.getByTestId('line-row').locator('[data-field="productId"]'), String(product?.name));
  const service = await save(page, 'appliance_store_service');
  expect(await action(page, 'appliance_store.start_service', title)).toMatchObject({
    id: service.id,
    status: 'in_progress',
  });
  expect(
    await action(page, 'appliance_store.complete_service', title, {
      completedDate: DATE,
      workReport: '点検、調整、試運転により正常動作を確認。',
    }),
  ).toMatchObject({ id: service.id, docstatus: 1, status: 'completed' });
  expect(await action(page, 'appliance_store.invoice_service', title)).toMatchObject({
    docstatus: 1,
    subtotal: '8000',
    taxTotal: '800',
    total: '8800',
  });
});

test('農家: 画面導入・作期作成確定・収穫入力確定と在庫評価を通す', async ({ page, request }) => {
  test.setTimeout(180_000);
  await login(page);
  const companyId = await selectCompany(page, 'farm');
  await applyTemplate(page, 'farm');
  await isolatedMenu(page, 'farm');
  const headers = await headersFor(request, companyId);
  const warehouse = (await list(request, headers, 'warehouse')).find((row) => row.code === 'FARM');
  const seasonName = `UIトマト作期 ${Date.now()}`;
  await page.goto('/e/farm_season/new');
  let form = page.getByTestId('record-form');
  await form.locator('[data-field="name"] input').fill(seasonName);
  await choose(form.locator('[data-field="fieldId"]'), '北畑（デモ）');
  await choose(form.locator('[data-field="cropId"]'), 'トマト（デモ）');
  await form.locator('[data-field="startDate"] input').fill(DATE.slice(0, 4) + '-01-01');
  await form.locator('[data-field="endDate"] input').fill(DATE.slice(0, 4) + '-12-31');
  await save(page, 'farm_season');
  const season = await submit(page, 'farm_season');
  await page.goto('/e/farm_harvest/new');
  form = page.getByTestId('record-form');
  await choose(form.locator('[data-field="seasonId"]'), seasonName);
  await choose(form.locator('[data-field="warehouseId"]'), String(warehouse?.name));
  await form.locator('[data-field="date"] input').fill(DATE);
  await number(form.locator('[data-field="quantity"]'), '100');
  await number(form.locator('[data-field="valuationUnitCost"]'), '200');
  await save(page, 'farm_harvest');
  const harvest = await submit(page, 'farm_harvest');
  expect(harvest).toMatchObject({ seasonId: season.id, valuationAmount: '20000', docstatus: 1 });
  expect(typeof harvest.stockEntryId).toBe('string');
  expect(await api(request, headers, `/api/stock_entry/${String(harvest.stockEntryId)}`)).toMatchObject({
    docstatus: 1,
  });
});

test('飲食店: 画面導入・店内持帰り日次締め・集計・会社切替後のメニュー分離', async ({ page, request }) => {
  test.setTimeout(180_000);
  await login(page);
  const companyId = await selectCompany(page, 'restaurant_chain');
  await applyTemplate(page, 'restaurant_chain');
  await isolatedMenu(page, 'restaurant_chain');
  const headers = await headersFor(request, companyId);
  const marker = Date.now().toString();
  const source = (await list(request, headers, 'restaurant_chain_store')).find((row) => row.code === 'RC-A');
  const warehouse = await api(request, headers, '/api/warehouse', { code: `RU${marker}`, name: `UI厨房 ${marker}` });
  const storeName = `UI店舗 ${marker}`;
  const store = await api(request, headers, '/api/restaurant_chain_store', {
    code: `RU${marker}`,
    name: storeName,
    warehouseId: warehouse.id,
    cashAccountId: source?.cashAccountId,
    partnerId: source?.partnerId,
  });
  const products = await list(request, headers, 'product');
  const rice = products.find((row) => row.code === 'RC-RICE'),
    chicken = products.find((row) => row.code === 'RC-CHICKEN');
  const receipt = await api(request, headers, '/api/stock_entry', {
    type: 'receipt',
    date: DATE,
    warehouseId: warehouse.id,
    lines: {
      stock_entry_line: [
        { productId: rice?.id, quantity: '10', unitCost: '500' },
        { productId: chicken?.id, quantity: '5', unitCost: '1000' },
      ],
    },
  });
  await api(request, headers, `/api/stock_entry/${receipt.id}/submit`, {});
  await page.goto('/e/restaurant_chain_closing/new');
  const form = page.getByTestId('record-form');
  await choose(form.locator('[data-field="storeId"]'), storeName);
  await form.locator('[data-field="date"] input').fill(DATE);
  await number(form.locator('[data-field="cashAmount"]'), '10000');
  await number(form.locator('[data-field="cardAmount"]'), '5000');
  await number(form.locator('[data-field="qrAmount"]'), '1400');
  const grid = page.getByTestId('lines-restaurant_chain_closing_line');
  for (const [index, mode, quantity, price] of [
    [0, 'dine_in', '10', '1100'],
    [1, 'takeaway', '5', '1080'],
  ] as const) {
    await grid.getByRole('button', { name: '行を追加' }).click();
    const row = grid.getByTestId('line-row').nth(index);
    await choose(row.locator('[data-field="recipeId"]'), 'チキンカレー v1');
    await row.locator('[data-field="serviceMode"] select').selectOption(mode);
    await number(row.locator('[data-field="quantity"]'), quantity);
    await number(row.locator('[data-field="unitPrice"]'), price);
  }
  const waste = page.getByTestId('lines-restaurant_chain_waste_line');
  await waste.getByRole('button', { name: '行を追加' }).click();
  await choose(waste.getByTestId('line-row').locator('[data-field="productId"]'), String(rice?.name));
  await number(waste.getByTestId('line-row').locator('[data-field="quantity"]'), '0.1');
  await save(page, 'restaurant_chain_closing');
  const closed = await submit(page, 'restaurant_chain_closing');
  expect(closed).toMatchObject({
    storeId: store.id,
    total: '16400',
    taxTotal: '1400',
    consumptionCost: '3000',
    wasteCost: '50',
  });
  await page.goto('/r/restaurant_chain.daily_summary');
  const report = page.getByTestId('report-form');
  await report.locator('[data-field="from"] input').fill(DATE);
  await report.locator('[data-field="to"] input').fill(DATE);
  await choose(report.locator('[data-field="storeId"]'), storeName);
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/actions/restaurant_chain.daily_summary'),
  );
  await report.getByRole('button', { name: '実行', exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBe(true);
  expect(await result.json()).toMatchObject({
    totals: { total: '16400', taxTotal: '1400', consumptionCost: '3000', wasteCost: '50' },
  });
  await expect(page.getByTestId('report-result')).toContainText(storeName);
  await selectCompany(page, 'appliance_store');
  await isolatedMenu(page, 'appliance_store');
  await selectCompany(page, 'farm');
  await isolatedMenu(page, 'farm');
  await selectCompany(page, 'restaurant_chain');
  await isolatedMenu(page, 'restaurant_chain');
});
