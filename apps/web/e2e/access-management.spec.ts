import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { PASSWORD, adminHeaders, api, login, newStore, restaurant, type Headers, type Row } from './operations-helpers.ts';

async function createUser(page: Page, name: string, email: string): Promise<Row> {
  await page.getByRole('button', { name: '利用者を追加', exact: true }).click();
  const form = page.getByRole('form', { name: '利用者の新規作成', exact: true });
  await form.getByLabel('氏名', { exact: true }).fill(name);
  await form.getByLabel('メールアドレス', { exact: true }).fill(email);
  await form.getByLabel('初期パスワード', { exact: true }).fill(PASSWORD);
  const saved = page.waitForResponse((r) => r.url().endsWith('/admin/users') && r.request().method() === 'POST');
  await form.getByRole('button', { name: '利用者を作成', exact: true }).click();
  const response = await saved; expect(response.ok(), await response.text()).toBe(true);
  await expect(form).toHaveCount(0);
  await page.getByRole('searchbox', { name: '利用者を検索' }).fill(email);
  await page.locator('.access-user').filter({ hasText: email }).click();
  return response.json() as Promise<Row>;
}

async function confirmSave(page: Page, form: Locator, button: string, title: string, path: string, method: string, status = 200) {
  await form.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const response = page.waitForResponse((r) => r.url().endsWith(path) && r.request().method() === method);
  await dialog.getByRole('button', { name: title, exact: true }).click();
  const result = await response; expect(result.status(), await result.text()).toBe(status);
  await expect(dialog).toHaveCount(0);
  return result;
}

async function assignStore(page: Page, companyId: string, store: Row, userId: string) {
  await page.getByLabel('権限を設定する会社', { exact: true }).selectOption(companyId);
  const form = page.getByRole('form', { name: '会社へのアクセス設定', exact: true });
  await form.getByLabel('店舗スタッフ', { exact: true }).check();
  await form.getByLabel('店舗のアクセス範囲', { exact: true }).selectOption('stores');
  await form.getByLabel(String(store.name), { exact: true }).check();
  const response = await confirmSave(page, form, '会社へのアクセスを保存', 'アクセスを更新', '/admin/users/' + userId + '/companies/' + companyId, 'PUT');
  expect(await response.json()).toMatchObject({ accessScope: 'stores', roles: ['chain_staff'], storeIds: [store.id], version: 1 });
  const profile = page.getByRole('form', { name: '利用者情報', exact: true });
  // Assigning the first company also changes the user's default company and profile version.
  await expect(profile.getByRole('button', { name: '最新情報を読み込む', exact: true })).toBeVisible();
  await profile.getByRole('button', { name: '最新情報を読み込む', exact: true }).click();
}

async function conflictAndRefresh(page: Page, request: APIRequestContext, headers: Headers, user: Row) {
  const profile = page.getByRole('form', { name: '利用者情報', exact: true });
  const field = profile.getByLabel('表示名', { exact: true });
  const catalog = await api<{ users: Row[] }>(request, headers, '/admin/access');
  const current = catalog.users.find((u) => u.id === user.id); expect(current).toBeDefined();
  const pendingName = '未保存の入力 ' + user.id;
  await field.fill(pendingName);
  const elsewhere = await api(request, headers, '/admin/users/' + user.id, { expectedVersion: current?.version, name: '別の管理者の更新 ' + user.id }, 'PATCH');
  const conflict = await confirmSave(page, profile, '利用者情報を保存', '利用者情報を更新', '/admin/users/' + user.id, 'PATCH', 409);
  expect(conflict.request().postDataJSON()).toMatchObject({ expectedVersion: current?.version, name: pendingName });
  expect(await conflict.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  await expect(field).toHaveValue(pendingName);
  await expect(profile.getByRole('button', { name: '利用者情報を保存', exact: true })).toBeDisabled();
  const reload = profile.getByRole('button', { name: '最新情報を読み込む', exact: true });
  await expect(reload).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss()); await reload.click();
  await expect(field).toHaveValue(pendingName);
  page.once('dialog', (dialog) => dialog.accept()); await reload.click();
  await expect(field).toHaveValue(String(elsewhere.name));
  await field.fill(pendingName);
  const latest = await api(request, headers, '/admin/users/' + user.id, { expectedVersion: elsewhere.version, name: '背景更新の最新値 ' + user.id }, 'PATCH');
  const refreshed = page.waitForResponse((r) => r.url().endsWith('/admin/access') && r.request().method() === 'GET');
  // Exercise the same focus-refetch event as returning to this tab, without navigating away.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  expect((await refreshed).ok()).toBe(true);
  await expect(reload).toBeVisible(); await expect(field).toHaveValue(pendingName);
  return { profile, field, reload, latest, pendingName };
}

async function cancelSwitches(page: Page, profile: Locator, pendingName: string, companyId: string, email: string) {
  await page.getByRole('searchbox', { name: '利用者を検索' }).fill(process.env.E2E_EMAIL ?? 'admin@example.com');
  page.once('dialog', (dialog) => dialog.dismiss()); await page.locator('.access-user').first().click();
  await expect(profile.getByLabel('表示名', { exact: true })).toHaveValue(pendingName);
  await page.getByRole('searchbox', { name: '利用者を検索' }).fill(email);
  page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('link', { name: 'BI・レポート', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(profile.getByLabel('表示名', { exact: true })).toHaveValue(pendingName);
  const membership = page.getByRole('form', { name: '会社へのアクセス設定', exact: true });
  await membership.getByLabel('店長', { exact: true }).check();
  const company = page.getByLabel('権限を設定する会社', { exact: true });
  const other = await company.locator('option').evaluateAll((options, current) => options.map((o) => (o as HTMLOptionElement).value).find((v) => v !== current), companyId);
  expect(other).toBeDefined();
  page.once('dialog', (dialog) => dialog.dismiss()); await company.selectOption(other ?? '');
  await expect(company).toHaveValue(companyId);
  await expect(membership.getByLabel('店長', { exact: true })).toBeChecked();
  await membership.getByRole('button', { name: '会社へのアクセスを保存', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '戻る', exact: true }).click();
  await expect(membership.getByLabel('店長', { exact: true })).toBeChecked();
  return membership;
}

test('access: store membership, preserved drafts, conflict reload, cancelled navigation and audited changes', async ({ page, request }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  await login(page); const companyId = await restaurant(page); const headers = await adminHeaders(request, companyId);
  const suffix = String(Date.now()); const email = 'access-ui.' + suffix + '@example.com';
  const store = await newStore(request, headers, '権限UI店舗 ' + suffix);
  await page.getByRole('link', { name: '利用者と権限', exact: true }).click();
  const user = await createUser(page, '権限UI利用者 ' + suffix, email);
  await assignStore(page, companyId, store, user.id);
  const { profile, field, reload, latest, pendingName } = await conflictAndRefresh(page, request, headers, user);
  const membership = await cancelSwitches(page, profile, pendingName, companyId, email);
  page.once('dialog', (dialog) => dialog.accept()); await reload.click();
  await expect(field).toHaveValue(String(latest.name));
  const finalName = '保存した利用者名 ' + suffix;
  await field.fill(finalName);
  await profile.getByRole('button', { name: '利用者情報を保存', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '戻る', exact: true }).click();
  await expect(field).toHaveValue(finalName);
  const saved = await confirmSave(page, profile, '利用者情報を保存', '利用者情報を更新', '/admin/users/' + user.id, 'PATCH');
  expect(saved.request().postDataJSON()).toMatchObject({ expectedVersion: latest.version, name: finalName });
  await confirmSave(page, membership, '会社へのアクセスを保存', 'アクセスを更新', '/admin/users/' + user.id + '/companies/' + companyId, 'PUT');
  const history = page.locator('.access-audit');
  const profileEntry = history.locator('details').filter({ hasText: finalName });
  await expect(profileEntry).toHaveCount(1); await profileEntry.locator('summary').click();
  const nameRow = profileEntry.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '表示名', exact: true }) });
  await expect(nameRow.getByRole('cell')).toHaveText([String(latest.name), finalName]);
  const roleEntry = history.locator('details').filter({ hasText: '店長, 店舗スタッフ' });
  await expect(roleEntry).toHaveCount(1); await roleEntry.locator('summary').click();
  const roleRow = roleEntry.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '業務ロール', exact: true }) });
  await expect(roleRow.getByRole('cell')).toHaveText(['店舗スタッフ', '店長, 店舗スタッフ']);
  expect(await history.textContent()).not.toContain(PASSWORD);
  await page.screenshot({ path: test.info().outputPath('access-management-ui.png'), fullPage: true });
});
