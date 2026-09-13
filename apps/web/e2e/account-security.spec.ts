import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API, api, PASSWORD } from './operations-helpers.ts';

const NEXT = 'Quality-next-passphrase-927!';
async function fixture(request: APIRequestContext) {
  const admin = await api<{ token: string }>(request, {}, '/auth/login', {
    email: process.env.E2E_EMAIL ?? 'admin@example.com',
    password: process.env.E2E_PASSWORD ?? 'password',
  });
  const email = `account-quality.${crypto.randomUUID()}@example.com`;
  await api(request, { authorization: 'Bearer ' + admin.token }, '/admin/users', {
    name: 'アカウント検証',
    email,
    password: PASSWORD,
  });
  // Deliberately no company membership: personal security must remain reachable.
  const old = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  return { email, oldToken: old.token };
}
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('メールアドレス', { exact: true }).fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function passwords(page: Page, current = PASSWORD, next = NEXT, confirmation = NEXT) {
  await page.getByLabel('現在のパスワード', { exact: true }).fill(current);
  await page.getByLabel('新しいパスワード', { exact: true }).fill(next);
  await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill(confirmation);
}

test('quality-foundation AC-2/3: mobile password change works without company access and revokes previous sessions', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, f.email, PASSWORD);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: '自分のアカウント', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('account-mobile-375.png'), fullPage: true });
  await passwords(page, 'incorrect-current-password', NEXT, 'not-matching-passphrase');
  const submit = page.getByRole('button', { name: '変更してログインし直す', exact: true });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('確認用の入力が一致していません');
  await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill(NEXT);
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('現在のパスワードを確認');
  await expect(page.getByLabel('新しいパスワード', { exact: true })).toHaveValue(NEXT);
  await passwords(page);
  await page.route('**/auth/password', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Synthetic temporary failure', hint: 'Retry' } }),
    }),
  );
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('通信を確認');
  await expect(page.getByLabel('新しいパスワード', { exact: true })).toHaveValue(NEXT);
  await page.unroute('**/auth/password');
  await submit.click();
  await expect(page).toHaveURL(/\/login\?reason=password-changed$/);
  await expect(page.getByRole('status')).toContainText('パスワードを変更');
  expect((await request.get(API + '/auth/me', { headers: { authorization: 'Bearer ' + f.oldToken } })).status()).toBe(
    401,
  );
  expect((await request.post(API + '/auth/login', { data: { email: f.email, password: PASSWORD } })).status()).toBe(
    401,
  );
  await signIn(page, f.email, NEXT);
  await page.goto('/account');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My account', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: test.info().outputPath('account-desktop.png'), fullPage: true });
});

test('quality-foundation AC-3: all-device logout confirms scope, preserves input on cancel and ends every old login', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await signIn(page, f.email, PASSWORD);
  await page.goto('/account');
  await page.getByLabel('現在のパスワード', { exact: true }).fill('unsaved-synthetic-input');
  await page.getByRole('button', { name: '全端末からログアウト', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('この画面を含むすべての端末');
  await dialog.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.getByLabel('現在のパスワード', { exact: true })).toHaveValue('unsaved-synthetic-input');
  await page.getByRole('button', { name: '全端末からログアウト', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '全端末のログインを終了', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=signed-out-all$/);
  await expect(page.getByRole('status')).toContainText('全端末からログアウト');
  expect((await request.get(API + '/auth/me', { headers: { authorization: 'Bearer ' + f.oldToken } })).status()).toBe(
    401,
  );
  await signIn(page, f.email, PASSWORD);
  await page.goto('/account');
  await expect(page.getByTestId('account-security')).toBeVisible();
});

test('quality-foundation AC-3: expired session escapes an account form with unsaved input', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await signIn(page, f.email, PASSWORD);
  await page.goto('/account');
  await passwords(page);
  await request.post(API + '/auth/logout-all', { headers: { authorization: 'Bearer ' + f.oldToken }, data: {} });
  page.on('dialog', () => {
    throw new Error('Expired authentication must not show a discard confirmation');
  });
  await page.getByRole('button', { name: '変更してログインし直す', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
  await expect(page.getByTestId('account-security')).toHaveCount(0);
});
