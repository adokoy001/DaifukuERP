// navigation-assist (docs/specs/navigation-assist.md): command palette, recent records, favourites, help link and
// storage failures in a real browser. Records are created through the API in the isolated E2E database.
import { expect, test, type Page } from '@playwright/test';
import { login } from './operations-helpers.ts';
import { assertNoOverflow, qualityEmployee, qualityPartner, qualitySession } from './quality-helpers.ts';

const FARM = '農家サンプル｜ひなた農園';
const menu = (page: Page) => page.getByRole('navigation', { name: 'メニュー', exact: true });
const palette = (page: Page) => page.getByRole('dialog', { name: '画面と記録を開く', exact: true });
const combobox = (page: Page) => palette(page).getByRole('combobox', { name: '画面名や記録名で検索', exact: true });
const recentGroup = (page: Page) => menu(page).getByRole('group', { name: '最近', exact: true });
const favoriteGroup = (page: Page) => menu(page).getByRole('group', { name: 'お気に入り', exact: true });
const suffix = () => crypto.randomUUID().slice(0, 8);

async function openPaletteByKey(page: Page) {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await expect(combobox(page)).toBeFocused();
}
async function selectedOption(page: Page) {
  const id = await combobox(page).getAttribute('aria-activedescendant');
  expect(id).toBeTruthy();
  const option = palette(page).locator(`[role="option"][id="${id}"]`);
  await expect(option).toHaveAttribute('aria-selected', 'true');
  return option;
}
async function storedFavorites(page: Page, items: string[]) {
  await page.evaluate((hrefs) => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('daifuku.favorites.'));
    if (!key) throw new Error('no favourites key');
    localStorage.setItem(key, JSON.stringify({ version: 1, items: hrefs }));
  }, items);
}
async function selectCompany(page: Page, name: string) {
  await page.goto('/templates');
  await page.getByLabel('対象の会社', { exact: true }).selectOption({ label: name });
  await expect(page.locator('.company-name')).toContainText(name);
}

test('navigation-assist AC-1/AC-2: Ctrl+K opens the palette, arrows and Enter open a screen, Escape returns focus @smoke', async ({
  page,
}) => {
  await login(page);
  await page.goto('/workspaces');
  const directorySearch = page.getByRole('searchbox', { name: '画面名を検索', exact: true });
  await directorySearch.focus();
  await openPaletteByKey(page);
  // Before typing: featured screens in a listbox; the combobox names it and points at the selected option.
  const listbox = palette(page).getByRole('listbox', { name: '候補', exact: true });
  await expect(listbox).toBeVisible();
  await expect(combobox(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(combobox(page)).toHaveAttribute('aria-controls', (await listbox.getAttribute('id')) ?? 'missing');
  await expect(palette(page).getByRole('group', { name: '画面', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(directorySearch).toBeFocused();

  await openPaletteByKey(page);
  await combobox(page).fill('/e/');
  const options = palette(page).getByRole('option');
  await expect(options.first()).toHaveAttribute('data-href', /^\/e\//);
  const ids = await options.evaluateAll((items) => items.map((item) => item.id));
  expect(ids.length).toBeGreaterThan(2);
  const expectSelected = async (id: string | undefined) => {
    await expect(combobox(page)).toHaveAttribute('aria-activedescendant', id ?? 'missing');
    await expect(palette(page).locator(`[role="option"][id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(palette(page).locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  };
  await expectSelected(ids[0]);
  await page.keyboard.press('ArrowDown');
  await expectSelected(ids[1]);
  await page.keyboard.press('ArrowUp');
  await expectSelected(ids[0]);
  await page.keyboard.press('ArrowUp');
  await expectSelected(ids.at(-1));
  // Only authorized screens from the catalog: an exact screen name puts that screen first; Enter opens it.
  await combobox(page).fill('取引先');
  await expect(await selectedOption(page)).toHaveAttribute('data-href', '/e/partner');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/e/partner');
  // A query with no match says so instead of an empty list.
  await openPaletteByKey(page);
  await combobox(page).fill('存在しない画面 zzz');
  await expect(palette(page).getByText('一致する画面や開いた記録がありません。', { exact: false })).toBeVisible();
  await expect(combobox(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(palette(page).getByRole('link', { name: 'すべての画面を探す', exact: true })).toHaveAttribute(
    'href',
    /\/workspaces\?q=/,
  );
});

test('navigation-assist AC-1/AC-2: from a dirty form, a palette move still asks first and focus returns to the field', async ({
  page,
}) => {
  await login(page);
  await page.goto('/e/partner/new');
  const field = page.getByTestId('record-form').locator('#f-name');
  const value = 'パレットでも守る入力 ' + Date.now();
  await field.fill(value);
  await openPaletteByKey(page);
  await combobox(page).fill('ぴぼっと');
  await expect(await selectedOption(page)).toHaveAttribute('data-href', '/analytics');
  const confirm = page.waitForEvent('dialog');
  const enter = page.keyboard.press('Enter');
  await (await confirm).dismiss();
  await enter;
  await expect(palette(page)).toBeHidden();
  await expect(page).toHaveURL(/\/e\/partner\/new$/);
  await expect(field).toHaveValue(value);
  await expect(field).toBeFocused();
});

test('navigation-assist AC-1/AC-8: the top-bar button opens a full-width palette at 390px, in Japanese and English', async ({
  page,
}) => {
  await login(page);
  const button = page.getByRole('button', { name: '画面と記録を検索', exact: true });
  // Linux/Windows advertise Ctrl+K only; ⌘+K is the macOS shortcut (Ctrl+K stays the text-field key there).
  await expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K');
  await button.click();
  await expect(palette(page)).toBeVisible();
  await expect(combobox(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page);
  await expect(button).toBeVisible();
  await button.click();
  await expect(combobox(page)).toBeFocused();
  const box = await palette(page).boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.y).toBe(0);
  expect(box?.width).toBe(390);
  await combobox(page).fill('取引先');
  await expect(palette(page).locator('[role="option"][data-href="/e/partner"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('palette-390.png'), fullPage: true });
  await palette(page).getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(palette(page)).toBeHidden();
  await expect(button).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  const english = page.getByRole('button', { name: 'Search screens and records', exact: true });
  await english.click();
  const dialog = page.getByRole('dialog', { name: 'Open a screen or record', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Search by screen or record name', exact: true })).toBeFocused();
  await expect(dialog.getByRole('listbox', { name: 'Suggestions', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(english).toBeFocused();
  await page.goto('/e/partner');
  await expect(page.getByRole('link', { name: /^Help for this screen \(Japanese\)/ })).toHaveAttribute(
    'hreflang',
    'ja',
  );
});

test('navigation-assist AC-3/AC-5: opened records appear under Recent per company, five in the menu, no employee names', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const tag = suffix();
  const partners = [];
  for (let n = 1; n <= 6; n++) partners.push(await qualityPartner(request, headers, `最近の取引先 ${tag}-${n}`));
  const { employee } = await qualityEmployee(request);
  await login(page);
  await expect(recentGroup(page)).toHaveCount(0);

  for (const partner of partners) {
    await page.goto(`/e/partner/${partner.id}`);
    await expect(page.getByTestId('record-title')).toHaveText(String(partner.name));
  }
  // Newest first, five in the menu; each opens the record.
  const links = recentGroup(page).getByRole('link');
  await expect(links).toHaveCount(5);
  await expect(links.first()).toContainText(`${tag}-6`);
  await expect(links.first()).toHaveAttribute('href', `/e/partner/${partners[5]?.id}`);
  await expect(recentGroup(page)).not.toContainText(`${tag}-1`);
  await page.screenshot({ path: test.info().outputPath('recent-sidebar-desktop.png') });

  // The palette lists recent records after screens and opens one with Enter.
  await page.goto('/');
  await openPaletteByKey(page);
  await combobox(page).fill(`${tag}-1`);
  const records = palette(page).getByRole('group', { name: '最近開いた記録', exact: true });
  await expect(records.getByRole('option')).toHaveCount(1);
  await expect(await selectedOption(page)).toHaveAttribute('data-href', `/e/partner/${partners[0]?.id}`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('record-title')).toHaveText(String(partners[0]?.name));
  await expect(recentGroup(page).getByRole('link').first()).toContainText(`${tag}-1`);

  // Personal data: an employee record is listed by entity and short id; the name is not stored in the browser.
  await page.goto(`/e/workforce_employee/${employee.id}`);
  await expect(page.getByTestId('record-title')).toHaveText(/^品質検証 [0-9a-f]{8}$/);
  const employeeName = await page.getByTestId('record-title').innerText();
  await expect(recentGroup(page).getByRole('link').first()).toHaveAttribute(
    'href',
    `/e/workforce_employee/${employee.id}`,
  );
  await expect(recentGroup(page).getByRole('link').first()).not.toContainText(employeeName);
  const stored = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('daifuku.recent.'))
      .map((key) => localStorage.getItem(key) ?? ''),
  );
  expect(stored.join('')).toContain(employee.id);
  expect(stored.join('')).not.toContain(employeeName);
  expect(stored.join('')).toContain(`${tag}-6`);

  // Another company: none of these records are listed; switching back shows them again.
  await page.goto('/templates');
  // The company list loads after the page: read the selected company only once it is a real id.
  await expect(page.getByLabel('対象の会社', { exact: true })).toHaveValue(/^[0-9a-f-]{36}$/);
  const original = await page.getByLabel('対象の会社', { exact: true }).inputValue();
  await selectCompany(page, FARM);
  await expect(menu(page).getByRole('link', { name: 'ホーム', exact: true })).toBeVisible();
  await expect(recentGroup(page)).toHaveCount(0);
  await openPaletteByKey(page);
  await combobox(page).fill(tag);
  await expect(palette(page).getByRole('group', { name: '最近開いた記録', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByLabel('対象の会社', { exact: true }).selectOption(original);
  await expect(page.locator('.company-name')).not.toContainText(FARM);
  await expect(recentGroup(page).getByRole('link')).toHaveCount(5);

  // Signing out drops the stored names (a shared computer shows none afterwards); the records stay by short id.
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  const afterSignOut = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('daifuku.recent.'))
      .map((key) => localStorage.getItem(key) ?? '')
      .join(''),
  );
  expect(afterSignOut).toContain(String(partners[0]?.id));
  expect(afterSignOut).not.toContain(tag);
  await login(page);
  const partnerLink = recentGroup(page).locator(`a[href="/e/partner/${partners[0]?.id}"]`);
  await expect(partnerLink).toHaveText(`取引先 ${String(partners[0]?.id).slice(0, 8)}…`);
  await expect(recentGroup(page)).not.toContainText(tag);
});

test('navigation-assist AC-4/AC-5/AC-6: a favourite screen is added, listed, kept and removed; help opens its chapter', async ({
  page,
}) => {
  await login(page);
  await expect(favoriteGroup(page)).toHaveCount(0);
  await page.goto('/e/partner');
  const star = page.getByRole('button', { name: 'お気に入り', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(favoriteGroup(page).locator('a[href="/e/partner"]')).toBeVisible();

  // Before typing, the palette offers favourites first.
  await openPaletteByKey(page);
  const favorites = palette(page).getByRole('group', { name: 'お気に入り', exact: true });
  await expect(favorites.getByRole('option').first()).toHaveAttribute('data-href', '/e/partner');
  await page.screenshot({ path: test.info().outputPath('palette-favourites-desktop.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: test.info().outputPath('favourite-trail-desktop.png') });

  // Kept in this browser for this user and company.
  await page.reload();
  await expect(favoriteGroup(page).locator('a[href="/e/partner"]')).toBeVisible();
  await favoriteGroup(page).locator('a[href="/e/partner"]').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/e/partner');

  // The manual chapter for this screen opens in a new tab.
  const help = page.getByRole('link', { name: /この画面の説明/ });
  await expect(help).toHaveAttribute(
    'href',
    `https://github.com/adokoy001/DaifukuERP/blob/main/docs/manual/04-masters.md#${encodeURIComponent('取引先')}`,
  );
  await expect(help).toHaveAttribute('target', '_blank');
  await expect(help).toHaveAttribute('rel', 'noreferrer');
  // The manual is written in Japanese only; the link says so to the browser (and in English to the reader).
  await expect(help).toHaveAttribute('hreflang', 'ja');
  // At phone width the trail tools wrap under the breadcrumb without a horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'お気に入り', exact: true })).toBeVisible();
  await expect(help).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('favourite-trail-390.png') });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('button', { name: 'お気に入り', exact: true }).click();
  await expect(page.getByRole('button', { name: 'お気に入り', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(favoriteGroup(page)).toHaveCount(0);

  // Favourites are whole screens: a new-record page offers no toggle; a screen with no chapter has no help link.
  await page.goto('/e/partner/new');
  await expect(page.getByRole('button', { name: 'お気に入り', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /この画面の説明/ })).toBeVisible();
  await page.goto('/a/sales.record_payment');
  await expect(page.getByRole('navigation', { name: '現在位置', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /この画面の説明/ })).toHaveCount(0);
});

test('navigation-assist AC-1: Ctrl+K does not open the palette over the phone menu or a confirmation dialog', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, `モーダル中の確認 ${suffix()}`);
  const settle = () =>
    page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))));
  await login(page);
  await page.goto(`/e/partner/${partner.id}`);
  await expect(page.getByTestId('record-title')).toHaveText(String(partner.name));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  await expect(page.locator('#app-navigation[aria-modal="true"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  // Nothing to wait for when the key is ignored: give the handler a frame, then expect no palette.
  await settle();
  await expect(page.locator('dialog.command-palette')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-navigation[aria-modal="true"]')).toHaveCount(0);

  // A kit confirmation inside the shell (record delete): the palette does not open over it.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '削除', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '削除', exact: true });
  await expect(confirm.getByRole('button', { name: '戻る', exact: true })).toBeFocused();
  await page.keyboard.press('Control+k');
  await settle();
  await expect(page.locator('dialog.command-palette')).toHaveCount(0);
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  // With no other modal open the same key opens it, and pressing it again inside does not stack a second one.
  await openPaletteByKey(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('dialog.command-palette')).toHaveCount(1);
  await expect(combobox(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('record-title')).toHaveText(String(partner.name));
});

test('navigation-assist AC-2: while the screen list loads, and after it failed, the palette says so', async ({
  page,
}) => {
  await login(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname.endsWith('/meta'),
    async (route) => {
      await held;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL"}}' });
    },
  );
  await page.reload();
  await page.getByRole('button', { name: '画面と記録を検索', exact: true }).click();
  await expect(palette(page).locator('.palette-empty')).toHaveText('読み込み中…');
  await expect(palette(page).getByText('一致する画面や開いた記録がありません。', { exact: false })).toHaveCount(0);
  release();
  await expect(palette(page).locator('.palette-empty')).toContainText('画面の一覧を読み込めませんでした。');
  await expect(combobox(page)).toHaveAttribute('aria-expanded', 'false');
});

test('navigation-assist AC-8: the top-bar search button shows its label from 768px and only the icon below', async ({
  page,
}) => {
  await login(page);
  const button = page.getByRole('button', { name: '画面と記録を検索', exact: true });
  await page.setViewportSize({ width: 768, height: 800 });
  await expect(button.getByText('検索', { exact: true })).toBeVisible();
  await expect(button.locator('kbd')).toBeVisible();
  await page.setViewportSize({ width: 767, height: 800 });
  await expect(button.getByText('検索', { exact: true })).toBeHidden();
  await expect(button.locator('kbd')).toBeHidden();
  await expect(button.locator('svg')).toBeVisible();
  await expect(button).toHaveAccessibleName('画面と記録を検索');
});

test('navigation-assist AC-4: twenty visible favourites refuse a new one with a notice; a hidden one makes room', async ({
  page,
}) => {
  await login(page);
  await page.goto('/e/partner');
  await page.getByRole('button', { name: 'お気に入り', exact: true }).click();
  await expect(page.getByRole('button', { name: 'お気に入り', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Twenty record lists the user may open, from the palette's own search (capped at 20 screens).
  await openPaletteByKey(page);
  await combobox(page).fill('/e/');
  const hrefs = await palette(page)
    .locator('[role="option"][data-href^="/e/"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-href') ?? ''));
  expect(hrefs).toHaveLength(20);
  expect(hrefs).not.toContain('/analytics');
  await page.keyboard.press('Escape');
  await storedFavorites(page, hrefs);
  await page.goto('/analytics');
  await expect(favoriteGroup(page).getByRole('link')).toHaveCount(20);
  const star = page.getByRole('button', { name: 'お気に入り', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(page.getByRole('status').filter({ hasText: 'お気に入りは 20 画面までです' })).toBeVisible();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(favoriteGroup(page).getByRole('link')).toHaveCount(20);

  // A favourite the user can no longer open (not in the catalog) is dropped first to make room.
  await storedFavorites(page, ['/e/no_such_entity', ...hrefs.slice(1)]);
  await page.reload();
  await expect(favoriteGroup(page).getByRole('link')).toHaveCount(19);
  await page.getByRole('button', { name: 'お気に入り', exact: true }).click();
  await expect(page.getByRole('button', { name: 'お気に入り', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(favoriteGroup(page).getByRole('link')).toHaveCount(20);
  await expect(favoriteGroup(page).locator('a[href="/analytics"]')).toBeVisible();
});

test('navigation-assist AC-4: a favourite added in another tab appears without a reload', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await login(first);
    await login(second);
    await first.goto('/e/partner');
    await second.goto('/e/product');
    await second.getByRole('button', { name: 'お気に入り', exact: true }).click();
    await expect(favoriteGroup(second).locator('a[href="/e/product"]')).toBeVisible();
    // The other tab learns about it from the browser's storage event.
    await expect(favoriteGroup(first).locator('a[href="/e/product"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('navigation-assist AC-7: a refused favourite write shows a notice and nothing else breaks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('daifuku.favorites.') || key.startsWith('daifuku.recent.'))
        throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await login(page);
  await page.goto('/e/partner');
  const star = page.getByRole('button', { name: 'お気に入り', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(page.getByRole('status').filter({ hasText: 'お気に入りを保存できませんでした' })).toBeVisible();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(favoriteGroup(page)).toHaveCount(0);
  await openPaletteByKey(page);
  await combobox(page).fill('ぴぼっと');
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/analytics');
  expect(errors).toEqual([]);
});

test('navigation-assist AC-7: blocked browser storage hides Recent and Favourites and nothing else breaks', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, `保存不可の確認 ${suffix()}`);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Site data is blocked', 'SecurityError');
      },
    });
  });
  await login(page);
  await page.goto(`/e/partner/${partner.id}`);
  await expect(page.getByTestId('record-title')).toHaveText(String(partner.name));
  await expect(recentGroup(page)).toHaveCount(0);
  await page.goto('/e/partner');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'お気に入り', exact: true })).toHaveCount(0);
  await expect(favoriteGroup(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /この画面の説明/ })).toBeVisible();
  await openPaletteByKey(page);
  await combobox(page).fill('ぴぼっと');
  await expect(await selectedOption(page)).toHaveAttribute('data-href', '/analytics');
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/analytics');
  expect(errors).toEqual([]);
});
