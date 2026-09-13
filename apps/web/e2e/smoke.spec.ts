import { openScreen } from './navigation-helpers.ts';
// AC-9 smoke: login -> create partner -> find in list -> edit -> audit shows 2 entries.
// Requires `pnpm dev:api` (http://localhost:3000, dev DB seeded by `pnpm db:reset`) and `pnpm dev:web` (http://localhost:5173).
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const NAME = 'E2E商事';
const EDITED = 'E2E商事（編集済）';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  // AC-1: token stored, /meta loaded -> sidebar menu rendered
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.sessionStorage.getItem('daifuku.token'))).not.toBeNull();
}

test('AC-9 smoke: login, create partner, list, edit, audit', async ({ page }) => {
  await login(page);

  // AC-2: entity reachable from the menu; AC-3: list page with New button
  await openScreen(page, '/e/partner');
  await expect(page).toHaveURL(/\/e\/partner$/);
  await page.getByRole('link', { name: /新規/ }).click();
  await expect(page).toHaveURL(/\/e\/partner\/new$/);

  // AC-4: create
  const form = page.getByTestId('record-form');
  await expect(form).toHaveAttribute('data-mode', 'create');
  await form.locator('#f-name').fill(NAME);
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page).toHaveURL(/\/e\/partner\/[0-9a-f-]{36}$/);
  const recordUrl = page.url();
  const id = recordUrl.slice(recordUrl.lastIndexOf('/') + 1);
  await expect(page.getByTestId('record-title')).toHaveText(NAME);

  // AC-3: search finds the new record (debounced search box)
  await page.locator('main a[href="/e/partner"]').first().click();
  await expect(page).toHaveURL(/\/e\/partner$/);
  await page.getByRole('searchbox', { name: '検索' }).fill(NAME);
  await expect(page).toHaveURL(/[?&]q=/);
  const row = page.locator(`tr[data-id="${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(NAME);
  await expect(page.getByTestId('total')).toContainText('件');

  // AC-4/AC-7: edit (PATCH with expectedVersion) and save
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/e/partner/${id}$`));
  await expect(form).toHaveAttribute('data-mode', 'update');
  await expect(form.locator('#f-code')).toBeDisabled(); // immutable field locked on edit
  await form.locator('#f-name').fill(EDITED);
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
  await expect(page.getByTestId('record-title')).toHaveText(EDITED);

  // AC-6: audit panel lists create + update
  const audit = page.getByTestId('audit-panel');
  await expect(audit.getByTestId('audit-entry')).toHaveCount(2);
  await expect(audit).toContainText('update');
  await expect(audit).toContainText('create');

  // AC-2: locale toggle switches labels
  await page.getByRole('button', { name: '言語: en' }).click();
  await expect(audit).toContainText('Audit');
});

test('AC-1/AC-8: no token shows login; bad password shows the error hint', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill('wrong-password');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('form', { name: 'ログイン' }).getByRole('alert')).toContainText('ログインに失敗しました');
  await expect(page).toHaveURL(/\/login$/);
});
