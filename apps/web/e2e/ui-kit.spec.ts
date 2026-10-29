// ui-kit (docs/specs/ui-kit.md): loading, empty and error states of the generic screens, and <html lang>.
// Synthetic route responses only change this browser's view; data writes go to the isolated E2E database.
import { expect, test, type Page } from '@playwright/test';
import { assertNoOverflow, qualityPartner, qualitySession, signInQuality } from './quality-helpers.ts';

const LIST = '**/api/partner?*';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (page: Page) => page.locator('.ui-table-frame');

test('ui-kit AC-4/AC-6/AC-14: an empty list loads with skeleton rows, then offers the create step', async ({
  page,
}) => {
  await signInQuality(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(LIST, async (route) => {
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
  });
  await page.goto('/e/partner');
  await expect(page.getByTestId('skeleton-row').first()).toBeVisible();
  await expect(frame(page)).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('該当するデータがありません')).toHaveCount(0);
  release();
  const empty = page.getByTestId('empty-state');
  await expect(empty).toContainText('まだ記録がありません');
  await expect(page.getByTestId('skeleton-row')).toHaveCount(0);
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false');
  // The header keeps the single "+ 新規" link; the empty state's step has its own name.
  await expect(page.getByRole('link', { name: /新規/ })).toHaveCount(1);
  expect(
    await page
      .locator('th')
      .first()
      .evaluate((th) => getComputedStyle(th).position),
  ).toBe('sticky');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(empty.getByRole('link', { name: '取引先を登録する', exact: true })).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('list-empty-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await empty.getByRole('link', { name: '取引先を登録する', exact: true }).click();
  await expect(page).toHaveURL(/\/e\/partner\/new$/);
  await expect(page.getByTestId('record-form')).toHaveAttribute('data-mode', 'create');
});

test('ui-kit AC-5/AC-6: a search without matches shows skeleton rows, then a clear-search step', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const name = 'UIキット検証 ' + crypto.randomUUID().slice(0, 8);
  const partner = await qualityPartner(request, headers, name);
  await signInQuality(page);
  await page.goto('/e/partner');
  await expect(page.getByTestId('row').first()).toBeVisible();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(LIST, async (route) => {
    // The page's `?q=` is sent to the API as `search=`; hold only the searched read.
    if (new URL(route.request().url()).searchParams.has('search')) await held;
    await route.continue();
  });
  const missing = 'zz-no-match-' + crypto.randomUUID().slice(0, 8);
  await page.getByRole('searchbox', { name: '検索' }).fill(missing);
  await expect(page).toHaveURL(/[?&]q=/);
  // Previous rows are not shown dimmed under the new query: skeleton rows replace them until the answer arrives.
  await expect(page.getByTestId('skeleton-row').first()).toBeVisible();
  await expect(page.getByTestId('row')).toHaveCount(0);
  release();
  const empty = page.getByTestId('empty-state');
  await expect(empty).toContainText('検索条件に一致する記録はありません');
  await expect(empty).toContainText(missing);
  await empty.getByRole('button', { name: '検索をクリア', exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByRole('searchbox', { name: '検索' })).toHaveValue('');
  await page.getByRole('searchbox', { name: '検索' }).fill(name);
  await expect(page.locator(`tr[data-id="${partner.id}"]`)).toContainText(name);
  await page.unroute(LIST);
});

test('ui-kit AC-7/AC-8: settings load as a skeleton; a failure shows the human sentence and folds the code away', async ({
  page,
}) => {
  await signInQuality(page);
  await page.route('**/meta/settings', async (route) => {
    await delay(1_500);
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INTERNAL', message: 'Synthetic settings failure', hint: 'Retry the settings read.' },
      }),
    });
  });
  await page.goto('/settings');
  const loading = page.getByTestId('loading-view');
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('aria-busy', 'true');
  const error = page.getByTestId('meta-error');
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toContainText('読み込みに失敗しました');
  await expect(error.getByText('一時的な問題が発生した可能性があります', { exact: false })).toBeVisible();
  await expect(error.getByText('Synthetic settings failure', { exact: true })).toBeVisible();
  const details = error.locator('details');
  await expect(details).not.toHaveAttribute('open');
  await expect(error.getByText('Retry the settings read.', { exact: true })).toBeHidden();
  await details.locator('summary').click();
  await expect(error.getByText('Retry the settings read.', { exact: true })).toBeVisible();
  await expect(details).toContainText('INTERNAL');
  await expect(details).toContainText('503');
  await page.unroute('**/meta/settings');
  await error.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByTestId('meta-error')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '設定', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('form[data-testid^="setting-"]').first()).toBeVisible();
});

test('ui-kit AC-9: an error toast shows the message first, then the hint, then the code', async ({ page }) => {
  await signInQuality(page);
  await page.route(LIST, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'CONFLICT', message: '一覧を取得できませんでした（合成）', hint: 'Reload and retry.' },
      }),
    }),
  );
  await page.goto('/e/partner');
  const toast = page.locator('[aria-live="polite"]').getByRole('alert');
  await expect(toast).toContainText('一覧を取得できませんでした（合成）');
  const text = await toast.innerText();
  expect(text.indexOf('一覧を取得できませんでした（合成）')).toBe(0);
  expect(text.indexOf('Reload and retry.')).toBeGreaterThan(0);
  expect(text.indexOf('CONFLICT')).toBeGreaterThan(text.indexOf('Reload and retry.'));
  // The table does not pretend the list is empty when the read failed.
  await expect(page.getByTestId('empty-state')).toContainText('読み込みに失敗しました');
  await expect(page.getByTestId('empty-state')).not.toContainText('まだ記録がありません');
  await page.unroute(LIST);
});

test('ui-kit AC-10: <html lang> follows the selected language, including after reload', async ({ page }) => {
  await signInQuality(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ja');
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await expect(html).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Language: ja', exact: true })).toBeVisible();
  await expect(html).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Language: ja', exact: true }).click();
  await expect(html).toHaveAttribute('lang', 'ja');
});
