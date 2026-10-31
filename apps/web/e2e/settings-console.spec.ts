// settings-console (docs/specs/settings-console.md AC-8..AC-14): category tabs kept in ?tab= (with the kit Tabs keyboard
// model, first exercised here), labelled fields and code pickers, the default and "reset to default" behind the kit
// Dialog, the change history, and 390px. Writes go to the isolated E2E database; every changed setting is put back.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { api, type Headers } from './operations-helpers.ts';
import { assertNoOverflow, failedRead, qualitySession, signInQuality } from './quality-helpers.ts';

interface SettingOut {
  key: string;
  value: unknown;
  isDefault: boolean;
}

const card = (page: Page, key: string) => page.getByTestId(`setting-${key}`);
const tablist = (page: Page) => page.getByRole('tablist', { name: '設定の分類' });
const tab = (page: Page, name: string) => tablist(page).getByRole('tab', { name, exact: true });

async function storedSetting(request: APIRequestContext, headers: Headers, key: string): Promise<SettingOut> {
  const list = await api<SettingOut[]>(request, headers, '/meta/settings');
  const found = list.find((s) => s.key === key);
  expect(found, key).toBeTruthy();
  return found as SettingOut;
}

/** Remembers the company value of `keys`, starts each from the module default, and puts the old value back after. */
async function withDefaults(request: APIRequestContext, keys: string[], run: (headers: Headers) => Promise<void>) {
  const { headers } = await qualitySession(request);
  const saved = await Promise.all(keys.map((key) => storedSetting(request, headers, key)));
  for (const key of keys) await api(request, headers, `/meta/settings/${key}`, undefined, 'DELETE');
  try {
    await run(headers);
  } finally {
    for (const s of saved) {
      if (s.isDefault) await api(request, headers, `/meta/settings/${s.key}`, undefined, 'DELETE');
      else await api(request, headers, `/meta/settings/${s.key}`, { value: s.value }, 'PUT');
    }
  }
}

test('settings-console AC-8/AC-14: category tabs keep ?tab= and follow the Arrow / Home / End keyboard model', async ({
  page,
}) => {
  await signInQuality(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '設定', exact: true, level: 1 })).toBeVisible();
  const names = await tablist(page).getByRole('tab').allTextContents();
  // Only categories that have settings, in the kernel order (workforce / integration have none here); later items
  // may add the company tab in front, so the first tab is read from the page.
  const known = ['会社', '会計', '消費税', '販売', '購買', '在庫', '契約', '人事・労務', '業界', '連携', 'システム'];
  expect(names).toEqual(known.filter((n) => names.includes(n)));
  expect(names).toEqual(expect.arrayContaining(['会計', '消費税', '販売', '購買', '在庫', '契約', '業界', 'システム']));
  expect(names).not.toContain('人事・労務');
  const first = names[0] ?? '';
  const last = names[names.length - 1] ?? '';
  expect(last).toBe('システム');
  // No ?tab=: the first tab is selected.
  await expect(tab(page, first)).toHaveAttribute('aria-selected', 'true');
  await tab(page, '会計').click();
  await expect(page.getByRole('tabpanel', { name: '会計' })).toContainText('入出金の勘定科目');
  await expect(page.getByRole('tabpanel', { name: '会計' }).getByRole('combobox').first()).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('settings-accounting-desktop.png') });

  await tab(page, '販売').click();
  await expect(page).toHaveURL(/[?&]tab=sales\b/);
  const sales = page.getByRole('tabpanel', { name: '販売' });
  // order: the issuer (10) before the posting accounts (20).
  await expect(sales.locator('form[data-testid^="setting-"]')).toHaveCount(2);
  expect(
    await sales.locator('form[data-testid^="setting-"]').evaluateAll((f) => f.map((e) => e.dataset.testid)),
  ).toEqual(['setting-sales.issuer', 'setting-sales.accounts']);

  // Roving tabindex: only the selected tab is in the Tab order; arrows move and select (automatic activation).
  await expect(tab(page, '販売')).toHaveAttribute('tabindex', '0');
  await expect(tab(page, first)).toHaveAttribute('tabindex', '-1');
  await tab(page, '販売').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, '購買')).toBeFocused();
  await expect(tab(page, '購買')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]tab=purchase\b/);
  await expect(page.getByRole('tabpanel', { name: '購買' })).toContainText('仕入の転記科目');
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, '販売')).toBeFocused();
  await expect(page).toHaveURL(/[?&]tab=sales\b/);
  await page.keyboard.press('End');
  await expect(tab(page, last)).toBeFocused();
  await expect(tab(page, last)).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]tab=system\b/);
  await page.keyboard.press('ArrowRight'); // wraps to the first
  await expect(tab(page, first)).toBeFocused();
  await page.keyboard.press('ArrowLeft'); // wraps to the last
  await expect(tab(page, last)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, first)).toBeFocused();
  await expect(tab(page, first)).toHaveAttribute('aria-selected', 'true');
  // Tab leaves the tab list for the panel (a single tab stop).
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: first })).toBeFocused();

  // The URL selects the tab on load; an unknown value falls back to the first tab.
  await page.goto('/settings?tab=inventory');
  await expect(tab(page, '在庫')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '在庫' })).toContainText('既定の倉庫コード');
  await page.goto('/settings?tab=nope');
  await expect(tab(page, first)).toHaveAttribute('aria-selected', 'true');
});

test('settings-console AC-9/AC-10/AC-11/AC-12: pick a sales posting account, see history, reset to the default', async ({
  page,
  request,
}) => {
  await withDefaults(request, ['sales.accounts'], async (headers) => {
    await signInQuality(page);
    await page.goto('/settings?tab=sales');
    const accounts = card(page, 'sales.accounts');
    await expect(accounts.getByTestId('setting-status')).toHaveText('既定値を使用中');
    await expect(accounts.getByTestId('setting-default')).toHaveText(
      '既定値: 売掛金 1300、売上高 4000、仮受消費税 2200',
    );
    // AC-9: Japanese labels instead of property names; AC-10: a picker of "code name" prefilled with the default.
    const revenue = accounts.getByRole('combobox', { name: '売上高', exact: true });
    await expect(revenue).toHaveJSProperty('tagName', 'SELECT');
    await expect(revenue).toHaveValue('4000');
    await expect(revenue.locator('option:checked')).toHaveText('4000 売上高');
    await expect(accounts.getByRole('combobox', { name: '売掛金', exact: true })).toHaveValue('1300');
    await expect(accounts.getByText('taxPayable', { exact: true })).toHaveCount(0);
    await expect(accounts.getByText('Revenue', { exact: true })).toHaveCount(0);

    await revenue.selectOption('4100');
    await accounts.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('設定を保存しました', { exact: true })).toBeVisible();
    await expect(accounts.getByTestId('setting-status')).toHaveText('会社の値');
    expect((await storedSetting(request, headers, 'sales.accounts')).value).toEqual({
      receivable: '1300',
      revenue: '4100',
      taxPayable: '2200',
    });

    // A stored code that is not an active account stays selected and is flagged.
    await api(
      request,
      headers,
      '/meta/settings/sales.accounts',
      { value: { receivable: '1300', revenue: '9999', taxPayable: '2200' } },
      'PUT',
    );
    await page.reload();
    await expect(accounts.getByRole('combobox', { name: '売上高', exact: true })).toHaveValue('9999');
    await expect(accounts.getByTestId('code-missing-revenue')).toHaveText('「9999」は有効な勘定科目にありません');
    await expect(accounts.getByRole('combobox', { name: '売上高', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // AC-12: the history lists the two changes, newest first, with the changed property only.
    const historyButton = accounts.getByRole('button', { name: '変更履歴', exact: true });
    await expect(historyButton).toHaveAttribute('aria-expanded', 'false');
    await historyButton.click();
    await expect(historyButton).toHaveAttribute('aria-expanded', 'true');
    const entries = accounts.getByTestId('setting-history-entry');
    await expect(entries.first()).toBeVisible();
    await expect(entries.first()).toContainText('変更');
    await expect(entries.first()).toContainText('売上高: 4100');
    await expect(entries.first()).toContainText('9999');
    await expect(entries.first()).not.toContainText('売掛金');
    // The first save: the unset side reads as the default the module used (not "not set").
    await expect(entries.nth(1)).toContainText('売上高: 既定値（4000）');
    await expect(entries.nth(1)).not.toContainText('未設定');

    // AC-11: reset through the kit Dialog; Escape keeps the value and returns focus to the opener.
    const resetButton = accounts.getByRole('button', { name: '既定に戻す', exact: true });
    await resetButton.click();
    const dialog = page.getByRole('dialog', { name: '「売上転記の勘定科目」を既定に戻す' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('既定値（売掛金 1300、売上高 4000、仮受消費税 2200）');
    await expect(dialog.getByRole('button', { name: '戻る', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(resetButton).toBeFocused();
    await expect(accounts.getByTestId('setting-status')).toHaveText('会社の値');

    await resetButton.click();
    await dialog.getByRole('button', { name: '既定に戻す', exact: true }).click();
    await expect(page.getByText('既定に戻しました', { exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(accounts.getByTestId('setting-status')).toHaveText('既定値を使用中');
    await expect(accounts.getByRole('button', { name: '既定に戻す', exact: true })).toHaveCount(0);
    await expect(accounts.getByRole('button', { name: '保存', exact: true })).toBeFocused();
    await expect(accounts.getByRole('combobox', { name: '売上高', exact: true })).toHaveValue('4000');
    expect(await storedSetting(request, headers, 'sales.accounts')).toMatchObject({ isDefault: true, value: null });
    await expect(entries.first()).toContainText('既定に戻す');
    await expect(entries.first()).toContainText('売上高: 9999');
    await expect(entries.first()).toContainText('既定値（4000）');
    await page.screenshot({ path: test.info().outputPath('settings-sales-history.png'), fullPage: true });
  });
});

test('settings-console AC-9/AC-10: checkboxes, warehouse picker, enum labels and textareas; English labels', async ({
  page,
}) => {
  await signInQuality(page);
  await page.goto('/settings?tab=inventory');
  const negative = card(page, 'inventory.allow_negative_stock');
  await expect(negative.getByRole('checkbox', { name: 'マイナス在庫を許可', exact: true })).toBeVisible();
  await expect(negative.getByRole('textbox')).toHaveCount(0);
  const warehouse = card(page, 'inventory.default_warehouse').getByRole('combobox', {
    name: '既定の倉庫コード',
    exact: true,
  });
  await expect(warehouse).toHaveJSProperty('tagName', 'SELECT');
  await expect(warehouse.locator('option', { hasText: /^MAIN / })).toHaveCount(1);

  await tab(page, '消費税').click();
  const mode = card(page, 'tax.rounding').getByRole('combobox', { name: '端数処理', exact: true });
  await expect(mode.locator('option')).toContainText(['四捨五入', '切捨て', '切上げ']);
  await tab(page, '契約').click();
  await expect(card(page, 'contract.default_proration').getByRole('combobox')).toContainText('日割り（当月の実日数）');
  await tab(page, '販売').click();
  const issuer = card(page, 'sales.issuer');
  await expect(issuer.getByRole('textbox', { name: '住所', exact: true })).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(issuer.getByRole('textbox', { name: '登録番号', exact: true })).toBeVisible();
  await expect(issuer.getByText('T と数字 13 桁', { exact: false })).toBeVisible();

  // A user who may not read accounts (e.g. only the settings role) types the code instead of picking it; the note
  // names the permission (not a load failure) and the field keeps its help text.
  await page.route('**/api/account?*', (route) => route.fulfill(failedRead(403)));
  await page.reload();
  const typed = card(page, 'sales.accounts').getByRole('textbox', { name: '売上高', exact: true });
  await expect(typed).toBeEditable();
  await expect(typed).toHaveAccessibleDescription(/勘定科目を参照する権限が無いため/);
  await expect(card(page, 'sales.accounts').getByText('一覧を読み込めないため', { exact: false })).toHaveCount(0);
  await tab(page, '会計').click();
  const cash = card(page, 'payment.accounts').getByRole('textbox', { name: '現金', exact: true });
  await expect(cash).toHaveAccessibleDescription(/権限が無いため.*支払方法が現金のときの口座/);
  await tab(page, '販売').click();
  await page.unroute('**/api/account?*');

  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'en'));
  await page.reload();
  await expect(tablist(page)).toHaveCount(0);
  const enTabs = page.getByRole('tablist', { name: 'Setting categories' });
  await expect(enTabs.getByRole('tab', { name: 'Sales', exact: true })).toHaveAttribute('aria-selected', 'true');
  const accounts = card(page, 'sales.accounts');
  await expect(accounts.getByRole('combobox', { name: 'Revenue', exact: true })).toBeVisible();
  await expect(accounts.getByRole('combobox', { name: 'Accounts receivable', exact: true })).toBeVisible();
  await expect(issuer.getByRole('textbox', { name: 'Registration number', exact: true })).toBeVisible();
});

test('settings-console AC-10: optional codes can be emptied, a code can be typed, a cut-off list is not misread', async ({
  page,
  request,
}) => {
  await withDefaults(
    request,
    ['real_estate.accounts', 'inventory.default_warehouse', 'sales.accounts'],
    async (headers) => {
      await signInQuality(page);
      // An optional code field offers "not specified" even while it holds a code (the module's own fallback applies).
      await page.goto('/settings?tab=industry');
      const rental = card(page, 'real_estate.accounts');
      const bank = rental.getByRole('combobox', { name: '敷金の入出金口座', exact: true });
      await expect(bank).toHaveValue('1100');
      await expect(bank).toHaveAccessibleDescription(/省略時は入出金の勘定科目の普通預金/);
      await bank.selectOption({ label: '指定しない' });
      await rental.getByRole('button', { name: '保存', exact: true }).click();
      await expect(rental.getByTestId('setting-status')).toHaveText('会社の値');
      const stored = (await storedSetting(request, headers, 'real_estate.accounts')).value as Record<string, unknown>;
      expect(stored).toMatchObject({ deposit: '2500', rentRevenue: '4200', deduction: '4100' });
      expect(stored).not.toHaveProperty('bank');
      // A required code field has no empty choice once it holds a code.
      await expect(
        rental
          .getByRole('combobox', { name: '預り金（敷金）', exact: true })
          .locator('option', { hasText: '指定しない' }),
      ).toHaveCount(0);

      // A code that does not exist yet can be typed (the warehouse is created later) and is flagged after saving.
      await page.goto('/settings?tab=inventory');
      const warehouseCard = card(page, 'inventory.default_warehouse');
      await warehouseCard
        .getByRole('combobox', { name: '既定の倉庫コード', exact: true })
        .selectOption({ label: 'コードを直接入力…' });
      const typed = warehouseCard.getByRole('textbox', { name: '既定の倉庫コード', exact: true });
      await expect(typed).toBeFocused();
      await typed.fill('W-LATER');
      await warehouseCard.getByRole('button', { name: '保存', exact: true }).click();
      await expect(warehouseCard.getByTestId('setting-status')).toHaveText('会社の値');
      expect((await storedSetting(request, headers, 'inventory.default_warehouse')).value).toBe('W-LATER');
      await warehouseCard.getByRole('button', { name: '一覧から選ぶ', exact: true }).click();
      const picker = warehouseCard.getByRole('combobox', { name: '既定の倉庫コード', exact: true });
      await expect(picker).toBeFocused();
      await expect(warehouseCard.getByTestId('code-missing-value')).toHaveText('「W-LATER」は倉庫にありません');

      // More active accounts than the list holds: a stored code beyond it is looked up by itself before any warning.
      await page.route('**/api/account?*', (route) => {
        const where = JSON.parse(new URL(route.request().url()).searchParams.get('where') ?? '{}') as { code?: string };
        if (typeof where.code === 'string') {
          const items =
            where.code === '2200' ? [] : [{ id: `id-${where.code}`, code: where.code, name: `科目${where.code}` }];
          return route.fulfill({ json: { items, total: items.length, limit: 1, offset: 0 } });
        }
        const items = Array.from({ length: 500 }, (_, i) => ({
          id: `a${i}`,
          code: `0${String(i).padStart(3, '0')}`,
          name: `科目${i}`,
        }));
        return route.fulfill({ json: { items, total: 620, limit: 500, offset: 0 } });
      });
      await page.goto('/settings?tab=sales');
      const accounts = card(page, 'sales.accounts');
      const revenue = accounts.getByRole('combobox', { name: '売上高', exact: true });
      await expect(revenue.locator('option:checked')).toHaveText('4000 科目4000');
      await expect(revenue).not.toHaveAttribute('aria-invalid', 'true');
      await expect(accounts.getByTestId('code-missing-revenue')).toHaveCount(0);
      await expect(accounts.getByTestId('codes-truncated-revenue')).toHaveText(
        '先頭 500 件だけを表示しています（全 620 件）。',
      );
      await expect(accounts.getByTestId('code-missing-taxPayable')).toHaveText('「2200」は有効な勘定科目にありません');
      await page.unroute('**/api/account?*');
    },
  );
});

test('settings-console AC-14: the console works at 390px without horizontal page scroll', async ({ page, request }) => {
  await withDefaults(request, ['contract.auto_submit'], async (headers) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInQuality(page);
    await page.goto('/settings?tab=sales');
    await expect(card(page, 'sales.accounts')).toBeVisible();
    await assertNoOverflow(page);
    // The tab list scrolls inside itself instead of widening the page.
    expect(await tablist(page).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('settings-sales-390.png'), fullPage: true });
    // A tab selected from the URL is scrolled into the visible part of the list.
    await page.goto('/settings?tab=system');
    await expect(tab(page, 'システム')).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(async () => {
        const list = await tablist(page).boundingBox();
        const selected = await tab(page, 'システム').boundingBox();
        return (
          !!list && !!selected && selected.x >= list.x - 1 && selected.x + selected.width <= list.x + list.width + 1
        );
      })
      .toBe(true);
    await page.goto('/settings?tab=sales');

    await tab(page, '契約').click();
    const auto = card(page, 'contract.auto_submit');
    await auto.getByRole('checkbox', { name: '契約請求書を自動で確定', exact: true }).check();
    await auto.getByRole('button', { name: '保存', exact: true }).click();
    await expect(auto.getByTestId('setting-status')).toHaveText('会社の値');
    expect((await storedSetting(request, headers, 'contract.auto_submit')).value).toBe(true);
    await auto.getByRole('button', { name: '変更履歴', exact: true }).click();
    await expect(auto.getByTestId('setting-history-entry').first()).toContainText('既定値（いいえ）');
    await expect(auto.getByTestId('setting-history-entry').first()).toContainText('はい');
    await assertNoOverflow(page);
    await auto.getByRole('button', { name: '既定に戻す', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await assertNoOverflow(page);
    await page.screenshot({ path: test.info().outputPath('settings-reset-390.png') });
    // While the DELETE is in flight the confirm button is disabled and says so (no second press).
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/meta/settings/contract.auto_submit', async (route) => {
      if (route.request().method() === 'DELETE') await held;
      await route.continue();
    });
    await dialog.getByRole('button', { name: '既定に戻す', exact: true }).click();
    const pending = dialog.getByRole('button', { name: '戻しています…', exact: true });
    await expect(pending).toBeDisabled();
    release();
    await expect(auto.getByTestId('setting-status')).toHaveText('既定値を使用中');
    await page.unroute('**/meta/settings/contract.auto_submit');
    expect(await storedSetting(request, headers, 'contract.auto_submit')).toMatchObject({ isDefault: true });
  });
});
