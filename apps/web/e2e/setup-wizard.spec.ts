// setup-wizard (docs/specs/setup-wizard.md): a tenant administrator creates a second company on /admin/companies,
// switches to it from "Switch and start the setup", sees the home card, walks the nine steps (saving the profile,
// checking the fiscal year, skipping the template with a reason, adding a user to the company, turning stock off),
// the state survives a reload and the card goes away, and a goods invoice of that company can be submitted. Also: the
// stepper's keys and aria-current, 390px for every step, English, axe, the fiscal-year conflict (409), failures of the
// status read and of saves, and who may open the screen. Each run creates companies and users with fresh codes.
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { BUSINESS_DATE } from './environment.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { API, api, PASSWORD, type Headers, type Row } from './operations-helpers.ts';
import { assertNoOverflow, failedRead, qualitySession, signInQuality } from './quality-helpers.ts';

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

const STEPS = [
  'company_profile',
  'fiscal_year',
  'chart_of_accounts',
  'tax',
  'invoice_issuer',
  'inventory',
  'industry_template',
  'users',
  'workforce',
] as const;

const suffixOf = () => Date.now().toString(36).toUpperCase().slice(-6);

/** A new company of the tenant (company-admin), so the shared fixture companies keep their settings. */
async function setupCompany(
  request: APIRequestContext,
  label: string,
): Promise<{ id: string; code: string; name: string; headers: Headers }> {
  const { headers } = await qualitySession(request);
  const suffix = suffixOf();
  const company = await api<{ id: string; code: string; name: string }>(request, headers, '/admin/companies', {
    code: `SW-${suffix}`,
    name: `${label} ${suffix}`,
  });
  return { ...company, headers: { ...headers, 'x-company-id': company.id } };
}

async function switchTo(page: Page, company: { code: string; name: string }) {
  await page.goto('/admin/companies');
  await page
    .getByTestId(`company-row-${company.code}`)
    .getByRole('button', { name: `${company.name} に切り替える` })
    .click();
  await expect(page.locator('.company-name')).toContainText(company.name);
}

/** A user with one company-wide membership (roles as given) in `companyId`. */
async function member(request: APIRequestContext, companyId: string, roles: string[]) {
  const { headers } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `setup-${roles.join('-')}-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `段階確認 ${suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles, accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  return { email, id: user.id };
}

const panel = (page: Page) => page.getByTestId('setup-step-panel');
async function expectStep(page: Page, id: (typeof STEPS)[number]) {
  await expect(panel(page)).toHaveAttribute('data-step', id);
}
async function confirmAndNext(page: Page, next: (typeof STEPS)[number]) {
  await page.getByTestId('setup-confirm').click();
  await expectStep(page, next);
}

test('setup-wizard AC-1..AC-7/AC-17..AC-23/AC-27: a second company walks the nine steps and submits a goods invoice', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const suffix = suffixOf();
  const code = `SW-${suffix}`;
  const name = `段階会社 ${suffix}`;
  await signInQuality(page);
  await openScreen(page, '/admin/companies');
  await page.getByTestId('company-add').click();
  const form = page.getByTestId('company-create-form');
  await form.getByLabel('会社コード', { exact: true }).fill(code);
  await form.getByLabel('会社名', { exact: true }).fill(name);
  const created = page.waitForResponse((r) => r.url().endsWith('/admin/companies') && r.request().method() === 'POST');
  await page.getByTestId('company-create-submit').click();
  const company = (await (await created).json()) as { id: string };
  // AC-27: the main action after creating is the wizard.
  await expect(page.getByTestId('company-switch-setup')).toHaveText('切り替えてセットアップを始める');
  await page.getByTestId('company-switch-setup').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/setup');
  await expect(page.locator('.company-name')).toContainText(name);
  await expectStep(page, 'company_profile');

  // AC-7: the home card names the next step and links to it.
  await page.goto('/');
  const card = page.getByTestId('setup-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('setup-card-next')).toContainText('会社情報');
  await expect(card.getByTestId('setup-card-progress')).toContainText('8 段階中');
  await card.getByTestId('setup-card-link').click();
  await expect(page).toHaveURL(/\/setup\?step=company_profile$/);

  // AC-1: nine steps in order, statuses in words, the optional step marked.
  const stepper = page.getByTestId('setup-stepper');
  await expect(stepper.locator('li')).toHaveCount(9);
  for (const [index, id] of STEPS.entries())
    await expect(stepper.locator('li').nth(index).getByRole('button')).toHaveAttribute(
      'data-testid',
      `setup-step-${id}`,
    );
  await expect(page.getByTestId('setup-step-company_profile')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('setup-step-company_profile')).toContainText('未完了');
  await expect(page.getByTestId('setup-step-workforce')).toContainText('任意');

  // Step 1 (AC-17): the same setting card as /settings, saved through PUT /meta/settings/company.profile.
  const profile = panel(page).getByTestId('setting-company.profile');
  await profile.getByLabel('正式名称', { exact: true }).fill(`株式会社段階 ${suffix}`);
  await profile.getByLabel('登録番号（適格請求書）', { exact: true }).fill('T1111111111111');
  await profile.getByLabel('住所', { exact: true }).fill('東京都千代田区段階1-1');
  await profile.getByLabel('消費税の課税区分', { exact: true }).selectOption({ label: '課税事業者' });
  await profile.getByLabel('決算月', { exact: true }).fill('3');
  await profile.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('setup-step-status')).toHaveText('完了');
  await confirmAndNext(page, 'fiscal_year');

  // Step 2 (AC-3): the seeded calendar year contains today; it is shown with the year-end mismatch note and no year is
  // added. Within 30 days of its end the step proposes the next year instead (the test does not depend on the date).
  const yearsBefore = await api<{ total: number }>(
    request,
    { ...(await qualitySession(request)).headers, 'x-company-id': company.id },
    '/api/fiscal_year?limit=1',
  );
  await expect(panel(page).getByTestId('setup-fiscal-end-month')).toContainText('決算月: 3 月');
  if ((await page.getByTestId('setup-step-status').textContent()) === '未完了') {
    await panel(page).getByTestId('setup-fiscal-create').click();
    await expect(page.getByTestId('setup-step-status')).toHaveText('完了');
  } else {
    await expect(panel(page).getByTestId('setup-fiscal-current')).toContainText(BUSINESS_DATE.slice(0, 4));
    await expect(panel(page).getByTestId('setup-fiscal-mismatch')).toBeVisible();
    await expect(panel(page).getByTestId('setup-fiscal-create')).toHaveCount(0);
    const yearsAfter = await api<{ total: number }>(
      request,
      { ...(await qualitySession(request)).headers, 'x-company-id': company.id },
      '/api/fiscal_year?limit=1',
    );
    expect(yearsAfter.total).toBe(yearsBefore.total);
  }
  await confirmAndNext(page, 'chart_of_accounts');

  // Step 3 (AC-18): counts only, a link to the accounts.
  await expect(panel(page).getByTestId('setup-check-setup.chart_of_accounts')).toHaveAttribute('data-status', 'ok');
  await expect(panel(page).getByTestId('setup-accounts-link')).toBeVisible();
  await confirmAndNext(page, 'tax');

  // Step 4 (AC-19): the standard rate check and the rounding card with the once-per-invoice rule.
  await expect(panel(page).getByTestId('setup-check-tax.standard_rate')).toHaveAttribute('data-status', 'ok');
  await expect(panel(page).getByTestId('setting-tax.rounding')).toBeVisible();
  await expect(panel(page)).toContainText('税率ごとに 1 回');
  await confirmAndNext(page, 'invoice_issuer');

  // Step 5 (AC-20, AC-9): the profile already prints a complete issuer. "Copy" fills the issuer card (unsaved), so
  // leaving asks first; declining stays on the step.
  await expect(panel(page).getByTestId('setup-check-sales.issuer')).toHaveAttribute('data-status', 'ok');
  await panel(page).getByTestId('setup-issuer-copy').click();
  const issuer = panel(page).getByTestId('setting-sales.issuer');
  await expect(issuer.getByRole('textbox', { name: '名称', exact: true })).toHaveValue(`株式会社段階 ${suffix}`);
  await expect(issuer.getByRole('textbox', { name: '登録番号', exact: true })).toHaveValue('T1111111111111');
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('未保存の変更があります。破棄して移動しますか？');
    void dialog.dismiss();
  });
  await page.getByTestId('setup-next').click();
  await expectStep(page, 'invoice_issuer');
  await expect(issuer.getByRole('textbox', { name: '名称', exact: true })).toHaveValue(`株式会社段階 ${suffix}`);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('setup-next').click();
  await expectStep(page, 'inventory');

  // Step 6 (AC-4): "do not use stock" saves both automatic settings as false.
  await panel(page).getByTestId('setup-inventory-none').click();
  await panel(page).getByTestId('setup-inventory-save').click();
  await expect(page.getByTestId('setup-live')).toHaveText('在庫の扱いを保存しました。');
  const inNew = { ...(await qualitySession(request)).headers, 'x-company-id': company.id };
  const settings = await api<{ key: string; value: unknown }[]>(request, inNew, '/meta/settings');
  expect(settings.find((s) => s.key === 'inventory.auto_issue_on_sales')?.value).toBe(false);
  expect(settings.find((s) => s.key === 'inventory.auto_receipt_on_purchase')?.value).toBe(false);
  await expect(page.getByTestId('setup-step-status')).toHaveText('完了');
  await confirmAndNext(page, 'industry_template');

  // Step 7 (AC-21, AC-6, AC-26): the template cards are offered; skipping needs a reason.
  await expect(panel(page).getByTestId('setup-templates')).toBeVisible();
  await expect(panel(page).getByTestId('template-example')).toHaveCount(0);
  await page.getByTestId('setup-skip').click();
  await page.getByTestId('setup-skip-submit').click();
  await expect(page.getByTestId('setup-skip-error')).toHaveText('スキップする理由を入力してください。');
  await expect(page.getByTestId('setup-skip-reason')).toBeFocused();
  await page.getByTestId('setup-skip-reason').fill('業界テンプレートは使わない');
  await page.getByTestId('setup-skip-submit').click();
  await expect(page.getByTestId('setup-step-status')).toHaveText('スキップ');
  await expect(page.getByTestId('setup-step-reason')).toContainText('業界テンプレートは使わない');
  await expect(page.getByTestId('setup-step-industry_template')).toContainText('スキップ');
  await page.getByTestId('setup-next').click();
  await expectStep(page, 'users');

  // Step 8 (AC-22): a tenant administrator creates a user and gives it a membership in this company (opened on it).
  await expect(page.getByTestId('setup-step-status')).toHaveText('未完了');
  await panel(page).getByTestId('setup-users-create').click();
  const createForm = panel(page).getByRole('form', { name: '利用者の新規作成' });
  await createForm.getByLabel('氏名', { exact: true }).fill(`段階利用者 ${suffix}`);
  await createForm.getByLabel('メールアドレス', { exact: true }).fill(`setup-walk-${suffix.toLowerCase()}@example.com`);
  await createForm.getByLabel('初期パスワード', { exact: true }).fill(PASSWORD);
  await createForm.getByRole('button', { name: '利用者を作成', exact: true }).click();
  const membership = panel(page).getByRole('form', { name: '会社へのアクセス設定' });
  await expect(membership.getByRole('heading', { name, level: 3 })).toBeVisible();
  await membership.getByLabel('販売', { exact: true }).check();
  await membership.getByRole('button', { name: '会社へのアクセスを保存', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'アクセスを更新', exact: true }).click();
  await expect(page.getByTestId('setup-step-status')).toHaveText('完了');
  await expect(panel(page).getByTestId('setup-check-setup.users')).toContainText('2 人');
  await confirmAndNext(page, 'workforce');

  // Step 9 (AC-23): optional; the seed already prepared the policy.
  await expect(page.getByTestId('setup-step-status')).toHaveText('完了');
  await page.getByTestId('setup-confirm').click();
  await expect(page.getByTestId('setup-live')).toHaveText('確認を記録しました。');

  // AC-6: a reload shows the same state from the record and the data.
  await page.reload();
  await expect(page.getByTestId('setup-step-industry_template')).toHaveAttribute('data-status', 'skipped');
  await expect(page.getByTestId('setup-progress')).toContainText('8 段階中 7 段階完了、スキップ 1');
  for (const id of STEPS.filter((s) => s !== 'industry_template'))
    await expect(page.getByTestId(`setup-step-${id}`)).toHaveAttribute('data-status', 'done');
  await page.screenshot({ path: test.info().outputPath('setup-done-desktop.png'), fullPage: true });

  // AC-7: nothing remains, so the home card is gone.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日の仕事を、ここから。', level: 1 })).toBeVisible();
  await expect(page.getByTestId('setup-card')).toHaveCount(0);

  // The company can bill goods: SAMPLE-GOODS has no stock, and stock is off, so the invoice submits.
  const partners = await api<{ items: Row[] }>(request, inNew, '/api/partner?limit=50');
  const partner = partners.items.find((p) => p.code === 'C-0001');
  const products = await api<{ items: Row[] }>(request, inNew, '/api/product?limit=50');
  const goods = products.items.find((p) => p.code === 'SAMPLE-GOODS');
  expect(partner && goods, 'the partner and product seeds ran for the new company').toBeTruthy();
  const draft = await api(request, inNew, '/api/sales_invoice', {
    date: BUSINESS_DATE,
    partnerId: partner?.id,
    lines: {
      sales_invoice_line: [{ productId: goods?.id, quantity: '2', unitPrice: '1500', taxCategory: 'standard' }],
    },
  });
  const submitted = await api<Row>(request, inNew, `/api/sales_invoice/${draft.id}/submit`, {});
  expect(submitted.docstatus).toBe(1);
  await page.goto(`/e/sales_invoice/${draft.id}`);
  await expect(page.getByTestId('docstatus').first()).toContainText('確定');
});

test('setup-wizard AC-10: stepper keys, aria-current and heading focus; 390px for every step; English; axe', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const company = await setupCompany(request, 'キー操作会社');
  await signInQuality(page);
  await switchTo(page, company);
  await page.goto('/setup');
  await expectStep(page, 'company_profile');
  const first = page.getByTestId('setup-step-company_profile');
  // Roving tabindex: only the open step is in the Tab order.
  await expect(first).toHaveAttribute('tabindex', '0');
  await expect(page.getByTestId('setup-step-tax')).toHaveAttribute('tabindex', '-1');
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('setup-step-fiscal_year')).toBeFocused();
  await expect(page.getByTestId('setup-step-fiscal_year')).toHaveAttribute('tabindex', '0');
  await expect(first).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('End');
  await expect(page.getByTestId('setup-step-workforce')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('setup-step-workforce')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/setup\?step=chart_of_accounts$/);
  await expect(page.getByTestId('setup-step-chart_of_accounts')).toHaveAttribute('aria-current', 'step');
  await expect(first).not.toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('setup-step-heading')).toBeFocused();
  await expect(page.getByTestId('setup-step-heading')).toHaveText('3. 勘定科目の確認');

  // 390px: every step can be opened and used without horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of STEPS) {
    await page.getByTestId(`setup-step-${id}`).click();
    await expectStep(page, id);
    await assertNoOverflow(page);
  }
  await page.getByTestId('setup-step-company_profile').click();
  await page.screenshot({ path: test.info().outputPath('setup-mobile.png'), fullPage: true });

  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto('/setup?step=company_profile');
    await expectStep(page, 'company_profile');
    await page.waitForLoadState('networkidle');
    if (run.locale === 'en') {
      await expect(page.getByRole('heading', { name: 'Setup', level: 1 })).toBeVisible();
      await expect(page.getByTestId('setup-step-company_profile')).toContainText('To do');
    }
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'setup', locale: run.locale, width: run.width };
    const judgement = judge(results.violations, exceptions, a11yRun, results.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
  }
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
});

test('setup-wizard AC-3/AC-24: a proposal the server refuses as overlapping (409) is explained and adds no year', async ({
  page,
  request,
}) => {
  const company = await setupCompany(request, '年度重複会社');
  const before = await api<{ total: number }>(request, company.headers, '/api/fiscal_year?limit=1');
  await signInQuality(page);
  await switchTo(page, company);
  // The wizard sees no year (stubbed list), so it proposes the year containing today, which the seed already made.
  await page.route('**/api/fiscal_year?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, limit: 200, offset: 0 }),
    }),
  );
  await page.goto('/setup?step=fiscal_year');
  const proposal = panel(page).getByTestId('setup-fiscal-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal.getByTestId('setup-fiscal-proposal-range')).toContainText(`${BUSINESS_DATE.slice(0, 4)}-01-01`);
  const conflict = page.waitForResponse((r) => r.url().endsWith('/actions/accounting.open_fiscal_year'));
  await panel(page).getByTestId('setup-fiscal-create').click();
  expect((await conflict).status()).toBe(409);
  await expect(panel(page).getByTestId('setup-fiscal-conflict')).toContainText(
    '既存の会計年度と重なるため作成しませんでした',
  );
  await expectStep(page, 'fiscal_year');
  const after = await api<{ total: number }>(request, company.headers, '/api/fiscal_year?limit=1');
  expect(after.total).toBe(before.total);
});

test('setup-wizard AC-24/AC-25/AC-7: failed reads and saves keep inputs, do not advance and re-read the status', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const company = await setupCompany(request, '失敗確認会社');
  await signInQuality(page);
  await switchTo(page, company);
  const statusReads: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/meta/setup-status')) statusReads.push(r.method());
  });

  // AC-7: the home card is hidden when the status cannot be read; the rest of home renders.
  await page.route('**/meta/setup-status', (route) => route.fulfill(failedRead(500)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日の仕事を、ここから。', level: 1 })).toBeVisible();
  await expect(page.getByTestId('setup-card')).toHaveCount(0);
  await page.unroute('**/meta/setup-status');

  // AC-25: a failed re-read keeps the previous result and the typed value, with an alert and "Reload".
  await page.goto('/setup?step=company_profile');
  const profile = panel(page).getByTestId('setting-company.profile');
  await profile.getByLabel('正式名称', { exact: true }).fill('入力中の正式名称');
  await page.route('**/meta/setup-status', (route) => route.fulfill(failedRead(500)));
  await page.getByTestId('setup-recheck').click();
  const alert = page.getByTestId('setup-status-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText('最新の状態を取得できませんでした');
  await expect(alert.getByTestId('setup-status-retry')).toHaveText('再読込');
  await expect(profile.getByLabel('正式名称', { exact: true })).toHaveValue('入力中の正式名称');
  await expectStep(page, 'company_profile');
  await page.unroute('**/meta/setup-status');
  await alert.getByTestId('setup-status-retry').click();
  await expect(alert).toHaveCount(0);

  // AC-24: a failed settings save keeps the input, does not advance and re-reads the status.
  await page.route('**/meta/settings/company.profile', (route) =>
    route.request().method() === 'PUT' ? route.fulfill(failedRead(500)) : route.continue(),
  );
  const readsBefore = statusReads.length;
  await profile.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => statusReads.length).toBeGreaterThan(readsBefore);
  await expect(profile.getByLabel('正式名称', { exact: true })).toHaveValue('入力中の正式名称');
  await expectStep(page, 'company_profile');
  await expect(page.getByTestId('setup-step-status')).toHaveText('未完了');
  await page.unroute('**/meta/settings/company.profile');

  // AC-24 / decision 13: the second of the two inventory saves fails — the error is shown, the step stays, the status
  // is re-read and the mixed state that was really stored is shown.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('setup-step-inventory').click();
  await expectStep(page, 'inventory');
  await page.route('**/meta/settings/inventory.auto_receipt_on_purchase', (route) =>
    route.request().method() === 'PUT' ? route.fulfill(failedRead(500)) : route.continue(),
  );
  await panel(page).getByTestId('setup-inventory-none').click();
  const readsBeforeInventory = statusReads.length;
  await panel(page).getByTestId('setup-inventory-save').click();
  await expect(panel(page).getByTestId('setup-save-error')).toContainText('保存できませんでした');
  await expect.poll(() => statusReads.length).toBeGreaterThan(readsBeforeInventory);
  await expectStep(page, 'inventory');
  await expect(panel(page).getByTestId('setup-inventory-mixed')).toBeVisible();
  await page.unroute('**/meta/settings/inventory.auto_receipt_on_purchase');
});

test('setup-wizard AC-8/AC-7/AC-22: who may open the screen and see the card', async ({ page, request }) => {
  test.setTimeout(180_000);
  const company = await setupCompany(request, '権限確認会社');

  // A settings-role member: no entry, no card, no status request from home; the URL explains; the API refuses.
  const settingsUser = await member(request, company.id, ['settings']);
  const statusReads: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/meta/setup-status')) statusReads.push(r.url());
  });
  await signInQuality(page, settingsUser.email, PASSWORD);
  await expect(page.getByRole('heading', { name: '今日の仕事を、ここから。', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('setup-card')).toHaveCount(0);
  expect(statusReads).toEqual([]);
  await findScreen(page, '/setup');
  await expect(page.locator('main a[data-screen-href="/setup"]')).toHaveCount(0);
  await page.goto('/setup');
  await expect(page.getByTestId('setup-forbidden')).toBeVisible();
  await expect(page.getByTestId('setup-stepper')).toHaveCount(0);
  expect(statusReads).toEqual([]);
  const login = await api<{ token: string }>(request, {}, '/auth/login', {
    email: settingsUser.email,
    password: PASSWORD,
  });
  const refused = await request.fetch(`${API}/meta/setup-status`, {
    headers: { authorization: `Bearer ${login.token}`, 'x-company-id': company.id },
  });
  expect(refused.status()).toBe(403);

  // A 403 from the API (e.g. a store-limited admin) shows the same explanation, not the reload view.
  await page.evaluate(() => sessionStorage.clear());
  const adminAccounting = await member(request, company.id, ['admin', 'accounting']);
  await signInQuality(page, adminAccounting.email, PASSWORD);
  // AC-7: an admin who also has a business role sees the card, whatever the home view.
  await expect(page.getByTestId('setup-card')).toBeVisible();
  await page.route('**/meta/setup-status', (route) => route.fulfill(failedRead(403)));
  await page.goto('/setup');
  await expect(page.getByTestId('setup-forbidden')).toBeVisible();
  await expect(page.getByTestId('setup-status-error')).toHaveCount(0);
  await page.unroute('**/meta/setup-status');

  // AC-22: a company admin who is not a tenant administrator gets the explanation instead of create / invite.
  await page.goto('/setup?step=users');
  await expect(panel(page).getByTestId('setup-users-not-tenant-admin')).toBeVisible();
  await expect(panel(page).getByTestId('setup-users-create')).toHaveCount(0);
  // Three members belong to this company by now (creator, settings, admin + accounting), so the step is done anyway.
  await expect(page.getByTestId('setup-step-status')).toHaveText('完了');
});
