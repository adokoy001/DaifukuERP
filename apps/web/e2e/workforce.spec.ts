// Core business transitions use the browser. API setup only creates identities, sites and wage conditions.
import { expect, test, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import type { ManagementPortal, MyPortal } from '@daifuku/mod-workforce/contract';
import { API, api, PASSWORD, type Row } from './operations-helpers.ts';

const ADMIN = process.env.E2E_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
const localTime = (iso: string) =>
  new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 19).replace(/:00$/, '');
async function signIn(page: Page, email = ADMIN, password = ADMIN_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('メールアドレス', { exact: true }).fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function auth(request: APIRequestContext, email = ADMIN, password = ADMIN_PASSWORD) {
  const session = await api<{ token: string; user: { id: string; tenantId: string; defaultCompanyId: string } }>(
    request,
    {},
    '/auth/login',
    { email, password },
  );
  return {
    session,
    headers: { authorization: 'Bearer ' + session.token, 'x-company-id': session.user.defaultCompanyId },
  };
}
async function fixture(request: APIRequestContext) {
  const { session, headers } = await auth(request);
  const suffix = Date.now().toString(36);
  const day = today();
  const sites = await Promise.all(
    ['中央拠点', '別拠点'].map((name, i) =>
      api(request, headers, '/api/workforce_site', { code: `WF-${i}-${suffix}`, name: `${name} ${suffix}` }),
    ),
  );
  const site = sites[0];
  const otherSite = sites[1];
  if (!site || !otherSite) throw new Error('Expected two work sites');
  const member = async (name: string, roles: string[], scope: 'sites' | 'all', siteIds: string[]) => {
    const email = `wf.${roles[0]}.${siteIds[0] ?? 'hq'}.${suffix}@example.com`;
    const user = await api(request, headers, '/admin/users', { name: `${name} ${suffix}`, email, password: PASSWORD });
    await api(
      request,
      headers,
      `/admin/users/${user.id}/companies/${session.user.defaultCompanyId}`,
      { expectedVersion: 0, roles, accessScope: scope, storeIds: [], siteIds },
      'PUT',
    );
    return { ...user, name: String(user.name), email };
  };
  const employee = await member('本人', ['workforce_employee'], 'sites', [site.id]);
  const manager = await member('拠点管理', ['workforce_manager'], 'sites', [site.id]);
  const payroll = await member('給与本部', ['workforce_payroll'], 'all', []);
  const other = await member('別拠点本人', ['workforce_employee'], 'sites', [otherSite.id]);
  const foreign = await api(request, headers, '/actions/workforce.register_employee', {
    userId: other.id,
    siteId: otherSite.id,
    code: `WF-B-${suffix}`,
    name: other.name,
    hiredOn: day.slice(0, 8) + '01',
  });
  const policy = await api<{ items: Row[] }>(request, headers, '/api/workforce_pay_policy?limit=100');
  expect(policy.items).toHaveLength(1);
  return {
    headers,
    session,
    suffix,
    day,
    site,
    otherSite,
    employee,
    manager,
    payroll,
    other,
    foreign,
    policy: policy.items[0] as Row,
  };
}
async function action(page: Page, name: string, click: () => Promise<void>) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/actions/workforce.' + name) && r.request().method() === 'POST',
  );
  await click();
  const response = await pending;
  expect(response.ok(), name + ': ' + (await response.text())).toBe(true);
  return response.json() as Promise<Row>;
}
async function dialogAction(page: Page, actionName: string, button: string) {
  const result = await action(page, actionName, () =>
    page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return result;
}
async function tab(page: Page, label: string) {
  await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: label, exact: true }).click();
}
const record = (page: Page, text: string): Locator =>
  page.locator('article.workforce-record').filter({ hasText: text });
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('workforce: mobile clock, reviewed correction and leave, receipt expense, headquarters payroll and access isolation', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const f = await fixture(request);
  const period = f.day.slice(0, 7);
  const previous = new Date(f.day + 'T00:00:00Z');
  previous.setUTCDate(0);
  const leaveDate = previous.toISOString().slice(0, 10);
  const payrollPeriod = leaveDate.slice(0, 7);
  await signIn(page);
  await page.goto('/workforce');
  await expect(page.getByTestId('workforce-management')).toBeVisible();
  await tab(page, '従業員');
  await page.getByRole('button', { name: '従業員を登録', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('利用者アカウント', { exact: true }).selectOption(f.employee.id);
  await dialog.getByLabel('所属拠点', { exact: true }).selectOption(f.site.id);
  await dialog.getByLabel('従業員番号', { exact: true }).fill('WF-A-' + f.suffix);
  await dialog.getByLabel('氏名', { exact: true }).fill(f.employee.name);
  await dialog.getByLabel('入社日', { exact: true }).fill(payrollPeriod + '-01');
  const employee = await dialogAction(page, 'register_employee', '登録する');
  await page.getByRole('button', { name: '有給を付与', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('対象の従業員', { exact: true }).selectOption(employee.id);
  await dialog.getByLabel('付与日', { exact: true }).fill(payrollPeriod + '-01');
  await dialog.getByLabel('有効期限', { exact: true }).fill(String(Number(f.day.slice(0, 4)) + 2) + '-12-31');
  await dialog.getByLabel('付与する日数', { exact: true }).fill('10');
  await dialog
    .getByLabel('付与日数・資格の根拠', { exact: true })
    .fill('E2E: 入社・出勤率・会社規程を確認した合成データ');
  await dialog.getByRole('checkbox').check();
  await dialogAction(page, 'grant_leave', '付与を記録');
  await api(request, f.headers, '/api/workforce_pay_terms', {
    employeeId: employee.id,
    policyId: f.policy.id,
    validFrom: payrollPeriod + '-01',
    validTo: f.day.slice(0, 4) + '-12-31',
    payType: 'hourly',
    hourlyRate: '1500',
    monthlySalary: '0',
    monthlyBaseMinutes: 9600,
    paidLeaveDayMinutes: 480,
    confirmed: true,
    basis: 'E2E only: signed hourly conditions',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, f.employee.email, PASSWORD);
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId('employee-portal')).toBeVisible();
  await noOverflow(page);
  await expect(page.getByRole('button', { name: '出勤する', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('employee-mobile-390.png'), fullPage: true });
  for (const label of ['出勤する', '休憩に入る', '休憩を終える', '退勤する']) {
    await action(page, 'punch', () => page.getByRole('button', { name: label, exact: true }).click());
    // Real-time punches must span distinct display seconds before exercising a human correction.
    if (label === '出勤する') await expect.poll(() => Date.now()).toBeGreaterThan(Date.now() + 1100);
  }
  const own = await auth(request, f.employee.email, PASSWORD);
  let portal = await api<MyPortal>(request, own.headers, '/actions/workforce.my_portal', { period });
  expect(portal.attendance?.status).toBe('closed');
  const attendance = portal.attendance;
  if (!attendance?.clockOut) throw new Error('Expected completed attendance');
  await tab(page, '勤怠');
  await record(page, f.day).getByRole('button', { name: '訂正を申請', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('訂正後の出勤', { exact: true }).fill(localTime(attendance.clockIn));
  await dialog.getByLabel('訂正後の退勤', { exact: true }).fill(localTime(attendance.clockOut));
  await dialog.getByRole('button', { name: '最後の休憩を除く', exact: true }).click();
  await dialog.getByLabel('訂正する理由', { exact: true }).fill('E2E: 休憩記録の訂正を申請');
  await dialogAction(page, 'request_correction', '訂正を申請');
  await tab(page, '有給');
  await page.getByRole('button', { name: '有給を申請', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('取得する日', { exact: true }).fill(leaveDate);
  await dialog.getByLabel('申請する理由', { exact: true }).fill('E2E: 私用のため');
  await dialogAction(page, 'request_leave', '有給を申請');
  await expect(record(page, leaveDate)).toContainText('承認待ち');

  await tab(page, '経費');
  await page.getByRole('button', { name: '経費を記録', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('利用日', { exact: true }).fill(f.day);
  await dialog.getByLabel('経費の区分', { exact: true }).fill('交通費');
  await dialog.getByLabel('精算する金額（円）', { exact: true }).fill('1234');
  const purpose = 'E2E 私有申請 ' + f.suffix;
  await dialog.getByLabel('利用目的・内容', { exact: true }).fill(purpose);
  await dialog.getByLabel('証憑の内容・保管場所', { exact: true }).fill('駅発行の領収書。写真を添付。');
  await page.keyboard.press('Escape');
  await expect(dialog.getByText('入力中の内容を破棄しますか？', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '入力に戻る', exact: true }).click();
  let firstKey = '';
  await page.route('**/actions/workforce.save_expense', async (route) => {
    firstKey = route.request().postDataJSON().idempotencyKey;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INTERNAL', message: 'E2E temporary failure', hint: 'Retry after connectivity returns.' },
      }),
    });
  });
  await dialog.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('E2E temporary failure');
  await expect(dialog.getByLabel('利用目的・内容', { exact: true })).toHaveValue(purpose);
  await page.unroute('**/actions/workforce.save_expense');
  const retry = page.waitForRequest((r) => r.url().endsWith('/actions/workforce.save_expense'));
  const expense = await dialogAction(page, 'save_expense', '下書きを保存');
  expect((await retry).postDataJSON().idempotencyKey).toBe(firstKey);
  await record(page, purpose).getByRole('button', { name: '領収書・証憑', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith(`/api/workforce/expenses/${expense.id}/receipts`) && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '領収書を添付', exact: true }).click();
  const receiptResponse = await uploaded;
  expect(receiptResponse.ok(), await receiptResponse.text()).toBe(true);
  const attachment = await receiptResponse.json();
  await expect(dialog).toHaveCount(0);
  await action(page, 'submit_expense', () =>
    record(page, purpose).getByRole('button', { name: '経費を提出', exact: true }).click(),
  );
  await record(page, purpose).getByRole('button', { name: '領収書・証憑', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('input[type=file]')).toHaveCount(0);
  await expect(dialog).toContainText('receipt.png');
  await dialog.getByRole('button', { name: '戻る', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('employee-expense-mobile-375.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, f.manager.email, PASSWORD);
  await page.goto('/workforce');
  await expect(page.getByTestId('workforce-management')).toBeVisible();
  await expect(page.getByLabel('表示する拠点').locator('option')).toHaveCount(2);
  await expect(page.locator('body')).not.toContainText(f.other.name);
  await expect(
    page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: '給与', exact: true }),
  ).toHaveCount(0);
  await record(page, 'E2E: 休憩記録の訂正を申請').getByRole('button', { name: '承認する', exact: true }).click();
  await page.getByRole('dialog').getByLabel('確認した内容・理由').fill('実際の勤務を確認');
  await dialogAction(page, 'review_correction', '勤怠訂正を承認');
  await record(page, purpose).getByRole('button', { name: '承認する', exact: true }).click();
  await page.getByRole('dialog').getByLabel('確認した内容・理由').fill('領収書と業務目的を確認');
  await dialogAction(page, 'review_expense', '経費を承認');
  await page.getByLabel('表示する月').fill(leaveDate.slice(0, 7));
  await record(page, 'E2E: 私用のため').getByRole('button', { name: '承認する', exact: true }).click();
  await page.getByRole('dialog').getByLabel('確認した内容・理由').fill('残数と勤務予定を確認');
  await dialogAction(page, 'review_leave', '有給を承認');
  await signIn(page, f.employee.email, PASSWORD);
  await tab(page, '勤怠');
  await action(page, 'submit_attendance', () =>
    record(page, f.day).getByRole('button', { name: 'この勤怠を提出', exact: true }).click(),
  );
  await signIn(page, f.manager.email, PASSWORD);
  await page.goto('/workforce');
  await record(page, f.employee.name)
    .filter({ hasText: f.day })
    .getByRole('button', { name: '承認する', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('当日の勤務区分').selectOption('workday');
  await dialog.getByLabel('確認した内容・理由').fill('勤務区分・実績を確認');
  await dialogAction(page, 'review_attendance', '勤怠を承認');
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('manager-desktop.png'), fullPage: true });

  await signIn(page, f.payroll.email, PASSWORD);
  await page.goto('/workforce');
  await record(page, purpose).getByRole('button', { name: '精算を記録', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('精算日').fill(f.day);
  await dialog.getByLabel('支払・精算の記録').fill('E2E: 現金精算を実施');
  await dialogAction(page, 'settle_expense', '精算を記録');
  await page.getByLabel('表示する月').fill(payrollPeriod);
  await tab(page, '給与');
  await page.getByRole('button', { name: '給与を計算', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('対象の従業員').selectOption(employee.id);
  await dialog.getByRole('checkbox').check();
  const payroll = await dialogAction(page, 'calculate_payroll', '下書きを計算');
  portal = await api<MyPortal>(request, own.headers, '/actions/workforce.my_portal', { period: payrollPeriod });
  expect(portal.payrolls).toHaveLength(0);
  await record(page, f.employee.name).getByRole('button', { name: '確認・確定', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('input[name="income_tax.amount"]')).toHaveValue('');
  for (const kind of [
    'income_tax',
    'resident_tax',
    'health_insurance',
    'nursing_insurance',
    'pension',
    'employment_insurance',
    'child_support',
    'other',
  ]) {
    await dialog.locator(`[name="${kind}.amount"]`).fill('0');
    await dialog.locator(`[name="${kind}.basis"]`).fill('E2E synthetic payroll: explicitly verified non-applicable');
    await dialog.locator(`[name="${kind}.confirmed"]`).check();
  }
  await dialog.getByLabel('確認記録・根拠', { exact: true }).fill('E2E: 全8項目と計算資料を確認');
  await dialog.locator('[name=calculationConfirmed]').check();
  await dialogAction(page, 'confirm_payroll', '確認して給与を確定');
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('headquarters-payroll-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, f.employee.email, PASSWORD);
  await page.getByLabel('表示する月').fill(payrollPeriod);
  await tab(page, '給与');
  await record(page, payrollPeriod).getByRole('button', { name: '明細を見る', exact: true }).click();
  await expect(record(page, payrollPeriod)).toContainText('所得税');
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('payslip-mobile-390.png'), fullPage: true });
  portal = await api<MyPortal>(request, own.headers, '/actions/workforce.my_portal', { period: payrollPeriod });
  expect(portal.payrolls).toHaveLength(1);
  expect(portal.payrolls[0]).toMatchObject({
    id: payroll.id,
    status: 'confirmed',
    grossPay: '12000',
    netPay: '12000',
    deductions: expect.arrayContaining([
      {
        kind: 'income_tax',
        amount: '0',
        basis: 'E2E synthetic payroll: explicitly verified non-applicable',
        confirmed: true,
      },
    ]),
  });
  expect(portal.leaveBalance).toBe('9');
  const other = await auth(request, f.other.email, PASSWORD);
  const manager = await auth(request, f.manager.email, PASSWORD);
  for (const [headers, path] of [
    [other.headers, '/api/workforce_payroll/' + payroll.id],
    [manager.headers, '/api/workforce_employee/' + f.foreign.id],
    [other.headers, '/api/workforce/receipts/' + attachment.receipt.id + '/download'],
  ] as const) {
    const denied = await request.get(API + path, { headers });
    expect([403, 404], path).toContain(denied.status());
  }
  const managed = await api<ManagementPortal>(request, manager.headers, '/actions/workforce.management_portal', {
    period,
  });
  expect(managed.payrolls).toHaveLength(0);
  expect(await page.evaluate(() => Object.values(localStorage).join(' '))).not.toContain(purpose);
  expect(await page.evaluate(() => Object.values(sessionStorage).join(' '))).not.toContain('E2E synthetic payroll');
  await api(
    request,
    f.headers,
    `/admin/users/${f.employee.id}/companies/${f.session.user.defaultCompanyId}`,
    { expectedVersion: 1 },
    'DELETE',
  );
  await page.getByRole('button', { name: '最新の状態を確認', exact: true }).click();
  await expect(page.getByTestId('employee-portal')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('E2E synthetic payroll');
});

test('workforce: workflow-only creation, self-review denial and company cache separation', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const f = await fixture(request);
  const employee = await api(request, f.headers, '/actions/workforce.register_employee', {
    userId: f.manager.id,
    siteId: f.site.id,
    code: 'WF-M-' + f.suffix,
    name: f.manager.name,
    hiredOn: f.day.slice(0, 8) + '01',
  });
  const own = await auth(request, f.manager.email, PASSWORD);
  const description = '自己承認できない申請 ' + f.suffix;
  const expense = await api(request, own.headers, '/actions/workforce.save_expense', {
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
    expenseDate: f.day,
    category: '交通費',
    description,
    amount: '500',
    evidence: 'E2E synthetic paper receipt',
  });
  const submitted = await api(request, own.headers, '/actions/workforce.submit_expense', {
    expenseId: expense.id,
    expectedVersion: expense.version,
  });
  await signIn(page);
  await page.goto('/admin/users');
  await page.getByRole('searchbox', { name: '利用者を検索' }).fill(f.manager.email);
  await page.locator('.access-user').filter({ hasText: f.manager.email }).click();
  const membership = page.getByRole('form', { name: '会社へのアクセス設定', exact: true });
  await expect(membership.getByLabel('店舗のアクセス範囲', { exact: true })).toHaveValue('sites');
  await expect(membership.getByLabel(String(f.site.name), { exact: true })).toBeChecked();
  await membership.getByLabel(String(f.otherSite.name), { exact: true }).check();
  await membership.getByRole('button', { name: '会社へのアクセスを保存', exact: true }).click();
  const savedScope = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/admin/users/${f.manager.id}/companies/${f.session.user.defaultCompanyId}`) &&
      r.request().method() === 'PUT',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'アクセスを更新', exact: true }).click();
  const scopeResponse = await savedScope;
  expect(scopeResponse.ok(), await scopeResponse.text()).toBe(true);
  expect(await scopeResponse.json()).toMatchObject({
    accessScope: 'sites',
    siteIds: expect.arrayContaining([f.site.id, f.otherSite.id]),
    roles: ['workforce_manager'],
  });
  await page.goto('/e/workforce_employee');
  await expect(page.getByRole('link', { name: '+ 新規', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '従業員・勤怠管理を開く', exact: true }).click();
  await expect(page).toHaveURL(/\/workforce$/);
  await page.goto('/e/workforce_employee/new');
  await expect(page.getByTestId('record-form')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '従業員・勤怠管理を開く', exact: true })).toBeVisible();
  await page.goto('/e/workforce_employee/' + employee.id);
  await expect(page.getByTestId('record-form')).toBeVisible();
  await expect(page.getByRole('button', { name: '削除', exact: true })).toHaveCount(0);
  await signIn(page, f.manager.email, PASSWORD);
  await page.goto('/workforce');
  const card = record(page, description);
  await expect(card.getByRole('button', { name: '承認する', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: '差し戻す', exact: true })).toBeDisabled();
  const denied = await request.post(API + '/actions/workforce.review_expense', {
    headers: own.headers,
    data: {
      expenseId: expense.id,
      expectedVersion: submitted.version,
      decision: 'approve',
      reason: 'self approval must fail',
    },
  });
  expect(denied.status()).toBe(403);
  const catalog = await api<{ companies: { id: string }[] }>(request, f.headers, '/admin/access');
  const otherCompany = catalog.companies.find((c) => c.id !== f.session.user.defaultCompanyId);
  if (!otherCompany) throw new Error('Expected a second synthetic company');
  const secondHeaders = { ...f.headers, 'x-company-id': otherCompany.id };
  const site = await api(request, secondHeaders, '/api/workforce_site', {
    code: 'WF-X-' + f.suffix,
    name: '別会社拠点 ' + f.suffix,
  });
  await api(
    request,
    f.headers,
    `/admin/users/${f.manager.id}/companies/${otherCompany.id}`,
    { expectedVersion: 0, roles: ['workforce_manager'], accessScope: 'sites', storeIds: [], siteIds: [site.id] },
    'PUT',
  );
  await page.goto('/templates');
  await page.getByLabel('対象の会社', { exact: true }).selectOption(otherCompany.id);
  await expect(page.getByLabel('対象の会社', { exact: true })).toHaveValue(otherCompany.id);
  await page.goto('/workforce');
  await expect(page.getByTestId('workforce-management')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(description);
  await page.goto('/templates');
  await page.getByLabel('対象の会社', { exact: true }).selectOption(f.session.user.defaultCompanyId);
  await expect(page.getByLabel('対象の会社', { exact: true })).toHaveValue(f.session.user.defaultCompanyId);
  await page.goto('/workforce');
  await expect(record(page, description)).toBeVisible();
});

test('workforce integration: all fifteen industry entries and searchable mobile catalog', async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await signIn(page);
  await page.goto('/templates');
  await expect(page.getByText('利用できる業界テンプレート 15 種', { exact: true })).toBeVisible();
  for (const name of [
    'retail',
    'real_estate',
    'appliance_store',
    'farm',
    'restaurant_chain',
    'wholesale',
    'manufacturing',
    'construction',
    'logistics',
    'hospitality',
    'clinic',
    'care_service',
    'education',
    'professional_service',
    'beauty_salon',
  ])
    await expect(page.getByTestId('template-' + name)).toBeAttached();
  await page.getByLabel('業界を探す', { exact: true }).fill('manufacturing');
  await expect(page.locator('article.template-card')).toHaveCount(1);
  await expect(page.getByTestId('template-manufacturing')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('industry-catalog-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('navigation', { name: 'メニュー', exact: true })).toBeHidden();
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('industry-catalog-mobile-375.png'), fullPage: true });
});
