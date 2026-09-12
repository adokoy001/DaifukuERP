// Current input, debounce, delayed responses and explicit retries all identify the same candidate set.
import { expect, test } from '@playwright/test';
import { assertNoOverflow, failedRead, qualityPartner, qualitySession, signInQuality } from './quality-helpers.ts';

test.use({ hasTouch: true });

test('reference search: keyboard cannot select old candidates during debounce or a delayed response', async ({ page, request }) => {
  const { headers } = await qualitySession(request), key = crypto.randomUUID().slice(0, 8);
  const oldName = '旧候補-' + key, newName = '最新候補-' + key;
  await qualityPartner(request, headers, oldName); await qualityPartner(request, headers, newName);
  let release = () => {}, started = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; }), seen = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/api/partner?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search') === newName) { started(); await held; }
    await route.continue();
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await signInQuality(page); await page.goto('/e/sales_invoice/new');
  const input = page.locator('input[role=combobox][name=partnerId]');
  await input.fill(oldName); await expect(page.getByRole('option', { name: oldName, exact: false })).toBeVisible();
  await input.fill(newName); await input.press('Enter');
  await expect(input).toHaveAttribute('aria-expanded', 'true'); await expect(input).toHaveValue(newName);
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(0);
  await seen; await input.press('Enter');
  await expect(input).toHaveAttribute('aria-expanded', 'true'); await expect(input).toHaveValue(newName);
  release(); await expect(page.getByRole('option', { name: newName, exact: false })).toBeVisible();
  await input.press('ArrowDown'); await expect(input).toHaveAttribute('aria-activedescendant', /-0$/);
  await input.press('Enter'); await expect(input).toHaveAttribute('aria-expanded', 'false'); await expect(input).toHaveValue(newName);
  await assertNoOverflow(page);
});

test('reference search: failure preserves text, retry works and keyboard keeps the active option visible', async ({ page, request }) => {
  const { headers } = await qualitySession(request), key = '再検索-' + crypto.randomUUID().slice(0, 8);
  for (let i = 0; i < 12; i++) await qualityPartner(request, headers, key + '-' + String(i).padStart(2, '0'));
  let fail = true;
  await page.route('**/api/partner?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search') === key && fail) await route.fulfill(failedRead());
    else await route.continue();
  });
  await page.setViewportSize({ width: 375, height: 812 }); await signInQuality(page); await page.goto('/e/sales_invoice/new');
  const input = page.locator('input[role=combobox][name=partnerId]');
  await input.fill(key); await expect(page.getByRole('alert')).toContainText('候補を取得できませんでした');
  await input.press('Enter'); await expect(input).toHaveValue(key); await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(0);
  await assertNoOverflow(page); await page.screenshot({ path: test.info().outputPath('reference-failure-mobile-375.png'), fullPage: true });
  fail = false; await page.getByRole('alert').getByRole('button').tap();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(12); await expect(input).toHaveValue(key);
  await input.focus(); await input.press('ArrowDown'); await expect(input).toHaveAttribute('aria-activedescendant', /-0$/);
  for (let i = 0; i < 11; i++) await input.press('ArrowDown');
  const active = await input.getAttribute('aria-activedescendant'); if (!active) throw new Error('Expected active option');
  expect(await page.evaluate((id) => {
    const option = document.getElementById(id), list = option?.closest('[role=listbox]');
    if (!option || !list) return false;
    const itemBox = option.getBoundingClientRect(), listBox = list.getBoundingClientRect();
    return itemBox.top >= listBox.top && itemBox.bottom <= listBox.bottom;
  }, active)).toBe(true);
  await input.press('Enter'); await expect(input).toHaveValue(new RegExp('^' + key));
  await input.focus(); await input.press('Escape'); await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.tap(); await input.fill(key); await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(12);
  const choice = page.getByRole('listbox').getByRole('option').first(), chosen = (await choice.innerText()).split('Q')[0]?.trim();
  if (!chosen) throw new Error('Expected candidate label');
  await choice.tap(); await expect(input).toHaveValue(chosen); await expect(input).toHaveAttribute('aria-expanded', 'false');
  await assertNoOverflow(page); await page.screenshot({ path: test.info().outputPath('reference-mobile-375.png'), fullPage: true });
});
