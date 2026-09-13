import { expect, test } from '@playwright/test';
import { api, API, type Row } from './operations-helpers.ts';
import { fiscalDialogAction, fiscalFixture, fiscalSignIn, fiscalTab, PASSWORD } from './fiscal-helpers.ts';

test('payroll rules: installation keeps failed review input and repeated installation preserves saved rules', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const f = await fiscalFixture(request);
  const before = await api<{ items: Row[] }>(request, f.headers, '/api/workforce_payroll_rules?limit=20');
  expect(before.items).toHaveLength(0);
  await fiscalSignIn(page, f.payroll.email);
  await page.goto('/workforce/payroll');
  await expect(page.locator('article.workforce-record > header').getByText('未導入', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '制度の詳細・導入', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '制度の内容と導入を確認', exact: true })).toBeVisible();
  await dialog.getByText('公式の出典を確認', { exact: false }).click();
  await expect(
    dialog.locator('a[href="https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf"]'),
  ).toBeVisible();
  const submit = dialog.getByRole('button', { name: '確認した制度版をこの会社に導入', exact: true });
  await expect(submit).toBeDisabled();
  const basis = 'Synthetic preserved package sources reviewed for this company';
  await dialog.getByLabel('導入の確認記録', { exact: true }).fill(basis);
  await dialog
    .getByRole('checkbox', { name: '出典・対応期間・計算方式と、この会社への適用を確認しました', exact: true })
    .check();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(dialog.getByText('入力中の内容を破棄しますか？', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '入力に戻る', exact: true }).click();
  await expect(dialog.getByLabel('導入の確認記録', { exact: true })).toHaveValue(basis);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('heading', { name: '制度の内容と導入を確認', exact: true }).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('payroll-rule-review-390.png'), fullPage: true });
  await dialog.getByLabel('導入の確認記録', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('payroll-rule-confirm-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/actions/workforce.install_payroll_rule', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INTERNAL',
          message: 'Synthetic temporary installation failure',
          hint: 'Retry using the retained review.',
        },
      }),
    }),
  );
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Synthetic temporary installation failure');
  await expect(dialog.getByLabel('導入の確認記録', { exact: true })).toHaveValue(basis);
  await page.unroute('**/actions/workforce.install_payroll_rule');
  await fiscalDialogAction(page, 'install_payroll_rule', '確認した制度版をこの会社に導入');
  await expect(page.locator('article.workforce-record > header').getByText('導入済み', { exact: true })).toBeVisible();
  const after = await api<{ items: Row[] }>(request, f.headers, '/api/workforce_payroll_rules?limit=20');
  expect(after.items).toHaveLength(1);
  await api(request, f.headers, '/actions/workforce.initialize_payroll_rules', {});
  const repeated = await api<{ items: Row[] }>(request, f.headers, '/api/workforce_payroll_rules?limit=20');
  expect(repeated.items).toEqual(after.items);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('対応期間・出典を表示', { exact: true }).click();
  await page.getByText('内容の識別情報', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('payroll-rule-periods-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await expect(page.getByLabel('Tax year', { exact: true })).toHaveValue('2026');
  await expect(page.getByRole('heading', { name: 'Rule versions and sources', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review / install package', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Review rule package and installation', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Health / pension insurance months', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('payroll-rule-review-en-1280.png'), fullPage: true });
});

test('payroll rules: unsupported periods stay blocked and employees cannot install packages', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const f = await fiscalFixture(request);
  await fiscalSignIn(page, f.person.email);
  await fiscalTab(page, '年末調整');
  await expect(page.getByRole('button', { name: '年末調整を申告', exact: true })).toBeDisabled();
  await expect(page.getByText('この税年の制度資料はこの会社に準備されていません。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '制度の詳細・導入', exact: true })).toHaveCount(0);
  const personSession = await api<{ token: string }>(request, {}, '/auth/login', {
    email: f.person.email,
    password: PASSWORD,
  });
  const forbidden = await request.post(API + '/actions/workforce.payroll_rule_catalog', {
    headers: { authorization: 'Bearer ' + personSession.token, 'x-company-id': f.company.id },
    data: {},
  });
  expect(forbidden.status()).toBe(403);
  await api(request, f.headers, '/actions/workforce.initialize_payroll_rules', {});
  await page.reload();
  await fiscalTab(page, '年末調整');
  await expect(page.getByRole('button', { name: '年末調整を申告', exact: true })).toBeEnabled();
  await expect(page.getByLabel('税年', { exact: true })).toHaveValue('2026');
  await expect(page.getByLabel('税年', { exact: true }).locator('option[value="2027"]')).toHaveCount(0);

  await fiscalSignIn(page, f.payroll.email);
  await page.goto('/workforce/payroll');
  await page.getByLabel('従業員', { exact: true }).selectOption(f.employee.id);
  await fiscalTab(page, '給与の算定');
  await page.getByLabel('給与対象月', { exact: true }).fill('2027-01');
  const calculate = page.getByRole('button', { name: '選択した従業員の税・保険込みで算定', exact: true });
  await expect(calculate).toBeDisabled();
  await expect(
    page.getByText('この給与対象月と税年を計算できる導入済み制度がありません。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('給与対象月', { exact: true }).fill('2026-08');
  await calculate.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('給与支払日', { exact: true }).fill('2027-01-10');
  await expect(dialog.getByRole('button', { name: '根拠を確認して算定', exact: true })).toHaveCount(0);
  await expect(
    dialog.getByText('支払日または保険対象月がこの制度版の対応期間外です。', { exact: false }),
  ).toBeVisible();
  await dialog.getByLabel('給与支払日', { exact: true }).fill('2026-09-10');
  await dialog.getByLabel('健康保険・厚生年金の対象月', { exact: true }).fill('2025-11');
  await expect(dialog.getByRole('button', { name: '根拠を確認して算定', exact: true })).toHaveCount(0);
  await dialog.getByLabel('健康保険・厚生年金の対象月', { exact: true }).fill('2026-08');
  await expect(dialog.getByRole('button', { name: '根拠を確認して算定', exact: true })).toBeVisible();
});

test('payroll rules: switching companies isolates installation status and review records', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const first = await fiscalFixture(request);
  const second = await fiscalFixture(request);
  await api(
    request,
    second.headers,
    `/admin/users/${first.payroll.id}/companies/${second.company.id}`,
    { expectedVersion: 0, roles: ['workforce_payroll'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await api(request, first.headers, '/actions/workforce.initialize_payroll_rules', {});
  await fiscalSignIn(page, first.payroll.email);
  await page.goto('/templates');
  await page.getByLabel('対象の会社', { exact: true }).selectOption(first.company.id);
  await expect(page.getByLabel('対象の会社', { exact: true })).toHaveValue(first.company.id);
  await page.goto('/workforce/payroll');
  const status = page.locator('article.workforce-record > header');
  await expect(status.getByText('導入済み', { exact: true })).toBeVisible();
  await page.getByText('対応期間・出典を表示', { exact: true }).click();
  await expect(page.getByText('導入記録日時', { exact: true })).toBeVisible();

  await page.goto('/templates');
  await page.getByLabel('対象の会社', { exact: true }).selectOption(second.company.id);
  await expect(page.getByLabel('対象の会社', { exact: true })).toHaveValue(second.company.id);
  await page.goto('/workforce/payroll');
  await expect(status.getByText('未導入', { exact: true })).toBeVisible();
  await page.getByText('対応期間・出典を表示', { exact: true }).click();
  await expect(page.getByText('導入記録日時', { exact: true })).toHaveCount(0);
  await expect(page.getByText('導入の確認記録', { exact: true })).toHaveCount(0);

  await page.goto('/templates');
  await page.getByLabel('対象の会社', { exact: true }).selectOption(first.company.id);
  await expect(page.getByLabel('対象の会社', { exact: true })).toHaveValue(first.company.id);
  await page.goto('/workforce/payroll');
  await expect(status.getByText('導入済み', { exact: true })).toBeVisible();
  const untouched = await api<{ items: Row[] }>(request, second.headers, '/api/workforce_payroll_rules?limit=20');
  expect(untouched.items).toHaveLength(0);
});
