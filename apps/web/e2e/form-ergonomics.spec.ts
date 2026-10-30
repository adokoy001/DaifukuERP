// form-ergonomics (docs/specs/form-ergonomics.md) in a real browser: labelled sections and narrow-screen tabs, the
// error summary and focus, required marks and helper text, Ctrl+S / Ctrl+Enter, the line grid keys, the 390px bottom
// bar, restoring unsaved input after a reload, and previous / next from the list. Records are created through the API
// in the isolated E2E database.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { FAILING_IMPACTS, WCAG_TAGS } from './a11y-policy.ts';
import { BUSINESS_DATE } from './environment.ts';
import { api, PASSWORD, type Headers, type Row } from './operations-helpers.ts';
import {
  assertNoOverflow,
  failedRead,
  qualityEmployee,
  qualityPartner,
  qualitySession,
  signInQuality,
} from './quality-helpers.ts';

const suffix = () => crypto.randomUUID().slice(0, 8);
const form = (page: Page) => page.getByTestId('record-form');
const summary = (page: Page) => page.getByTestId('error-summary');
/** The alert sentence of the last failed attempt inside the summary (AC-3). */
const summaryAlert = (page: Page) => summary(page).getByRole('alert');
/** Alerts in the toast area (a failed save that the summary lists pushes none). */
const toastAlerts = (page: Page) => page.locator('.toast-viewport').getByRole('alert');

async function draftInvoice(request: APIRequestContext, headers: Headers, note: string) {
  const partner = await qualityPartner(request, headers, `D3 得意先 ${note}`);
  const invoice = await api(request, headers, '/api/sales_invoice', {
    date: BUSINESS_DATE,
    partnerId: partner.id,
    note,
    lines: {
      sales_invoice_line: [{ description: `D3 ${note}`, quantity: '1', unitPrice: '1000', taxCategory: 'standard' }],
    },
  });
  return { partner, invoice };
}

/** The draft keys of this tab (lib/form-draft.ts). */
async function draftKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('daifuku.form-draft.v1.')));
}

/** Whether the last keydown that reached `window` had its default action (the browser's save dialog) prevented. */
async function watchDefaultPrevented(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __lastKey?: { key: string; prevented: boolean } };
    window.addEventListener('keydown', (event) => {
      w.__lastKey = { key: event.key, prevented: event.defaultPrevented };
    });
  });
}
async function lastKey(page: Page) {
  return page.evaluate(() => (window as unknown as { __lastKey?: { key: string; prevented: boolean } }).__lastKey);
}
async function resetLastKey(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __lastKey?: unknown }).__lastKey = undefined;
  });
}

test('form-ergonomics AC-2/AC-4: labelled sections with legends, required marks and helper text on the invoice form', async ({
  page,
}) => {
  await signInQuality(page);
  await page.goto('/e/sales_invoice/new');
  await expect(form(page)).toHaveAttribute('data-layout', 'stack');
  // AC-2: labelled groups are fieldsets named by their legend (create mode shows the enterable ones).
  await expect(form(page).getByRole('group', { name: '請求', exact: true })).toBeVisible();
  await expect(form(page).getByRole('group', { name: '備考・仕訳', exact: true })).toBeVisible();
  await expect(form(page).getByRole('group', { name: '金額', exact: true })).toHaveCount(0);
  // AC-4: a required field without a default is marked and required for assistive technology.
  const partner = form(page).locator('input[name=partnerId]');
  await expect(partner).toHaveAttribute('aria-required', 'true');
  await expect(form(page).getByTestId('required-legend')).toContainText('は入力が必要な項目です');
  // AC-4: the field description is helper text tied to the input.
  const due = form(page).locator('input[name=dueDate]');
  const describedBy = await due.getAttribute('aria-describedby');
  expect(describedBy).toBe('f-dueDate-desc');
  await expect(page.locator('#f-dueDate-desc')).toBeVisible();
  await expect(form(page).locator('input[name=date]')).not.toHaveAttribute('aria-required', 'true');
});

test('form-ergonomics AC-3: a failed save shows the summary, focuses the first invalid input and links to grid cells', async ({
  page,
}) => {
  await signInQuality(page);
  await page.goto('/e/sales_invoice/new');
  const grid = page.getByTestId('lines-sales_invoice_line');
  await grid.getByRole('button', { name: '行を追加' }).click();
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  const box = summary(page);
  await expect(box).toBeVisible();
  // One alert per attempt: the attempt's sentence (the list below shrinks, so it is not the live region), and no
  // error toast read at the same time.
  await expect(summaryAlert(page)).toHaveText(/^保存できませんでした。入力内容の問題が \d+ 件ありました。$/);
  await expect(summaryAlert(page)).toHaveAttribute('data-attempt', '1');
  await expect(toastAlerts(page)).toHaveCount(0);
  await expect(box.getByRole('heading')).toHaveText(/入力内容に \d+ 件の問題があります/);
  await expect(box.getByRole('link', { name: '得意先: 必須項目です' })).toBeVisible();
  const cellLink = box.getByRole('link', { name: '売上請求書明細 1 行目の品名・摘要: 必須項目です', exact: true });
  await expect(cellLink).toBeVisible();
  // Focus moved to the first invalid input (the header comes first).
  await expect(form(page).locator('input[name=partnerId]')).toBeFocused();
  // A cell link focuses the cell (no page jump to #id).
  await cellLink.click();
  await expect(grid.getByTestId('line-row').first().locator('td[data-field="description"] input')).toBeFocused();
  await expect(page).toHaveURL(/\/e\/sales_invoice\/new$/);
  // Fixing the cell shrinks the summary; the inline error is read with its input.
  const description = grid.getByTestId('line-row').first().locator('td[data-field="description"] input');
  await expect(description).toHaveAttribute('aria-describedby', /-error$/);
  await description.fill('D3 品名');
  await expect(box.getByRole('link', { name: /1 行目の品名・摘要/ })).toHaveCount(0);
  await expect(box.getByRole('link', { name: '得意先: 必須項目です' })).toBeVisible();
  // The alert keeps the attempt's text while the list shrinks (nothing is read again on each keystroke).
  await expect(summaryAlert(page)).toHaveAttribute('data-attempt', '1');
  await page.screenshot({ path: test.info().outputPath('form-error-summary.png') });
  // A second attempt with the same remaining problem mounts a new alert (announced again) and moves focus again.
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(summaryAlert(page)).toHaveAttribute('data-attempt', '2');
  const remaining = await box.getByRole('listitem').count();
  await expect(summaryAlert(page)).toHaveText(`保存できませんでした。入力内容の問題が ${remaining} 件ありました。`);
  await expect(form(page).locator('input[name=partnerId]')).toBeFocused();
  await expect(toastAlerts(page)).toHaveCount(0);
});

test('form-ergonomics AC-3: focus moves to the invalid input again after a successful save and after a restore', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, `D3 焦点 ${suffix()}`);
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
  await signInQuality(page);
  // Update mode keeps the same form after a save (keyed by the record id): fail, fix and save, then fail again.
  await page.goto(`/e/partner/${partner.id}`);
  const name = form(page).locator('input[name=name]');
  const save = form(page).getByRole('button', { name: '保存', exact: true });
  await name.fill('');
  await save.click();
  await expect(summary(page)).toBeVisible();
  await expect(name).toBeFocused();
  await name.fill(`D3 焦点 ${suffix()} 修正`);
  await save.click();
  await expect(form(page)).toHaveAttribute('data-dirty', 'false');
  await expect(summary(page)).toHaveCount(0);
  await save.focus();
  await name.fill('');
  await save.click();
  await expect(summary(page)).toBeVisible();
  await expect(name).toBeFocused();
  // A restored draft starts the count again as well: fail, restore, fail -> focus moves.
  await page.goto('/e/partner/new');
  const newName = form(page).locator('input[name=name]');
  await newName.fill('D3 復元してから失敗');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await page.getByRole('link', { name: '← 取引先' }).click();
  await expect(page).toHaveURL(/\/e\/partner(\?.*)?$/);
  await page.goto('/e/partner/new');
  const offer = page.getByTestId('draft-offer');
  await expect(offer).toBeVisible();
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(summary(page)).toBeVisible();
  await expect(newName).toBeFocused();
  await offer.getByRole('button', { name: '復元する', exact: true }).click();
  await expect(newName).toHaveValue('D3 復元してから失敗');
  await expect(summary(page)).toHaveCount(0);
  await newName.fill('');
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(summary(page)).toBeVisible();
  await expect(newName).toBeFocused();
});

test('form-ergonomics AC-5: Ctrl+S saves without the browser dialog; Ctrl+Enter saves changes or opens the submit confirmation', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const { invoice } = await draftInvoice(request, headers, `キー ${suffix()}`);
  await signInQuality(page);
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  await expect(form(page)).toHaveAttribute('data-mode', 'update');
  await watchDefaultPrevented(page);
  const note = form(page).locator('textarea[name=note]');
  await note.fill('Ctrl+S で保存');
  await expect(form(page)).toHaveAttribute('data-dirty', 'true');
  await page.keyboard.press('Control+s');
  await expect(form(page)).toHaveAttribute('data-dirty', 'false');
  expect(await lastKey(page)).toEqual({ key: 's', prevented: true });
  const saved = await api<Row>(request, headers, `/api/sales_invoice/${invoice.id}`);
  expect(saved.note).toBe('Ctrl+S で保存');
  // A clean draft document: Ctrl+Enter opens the submit confirmation (the same dialog as the 確定 button).
  await note.focus();
  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: '確定', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '戻る', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(note).toBeFocused();
  // Unsaved changes: Ctrl+Enter saves (document actions still wait for a save).
  await note.fill('Ctrl+Enter で保存');
  await page.keyboard.press('Control+Enter');
  await expect(form(page)).toHaveAttribute('data-dirty', 'false');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Ctrl+S outside the form (focus on the page header) still saves nothing new but never opens the browser dialog.
  await page.getByTestId('record-title').click();
  await page.keyboard.press('Control+s');
  expect(await lastKey(page)).toEqual({ key: 's', prevented: true });
  // AC-10: the "?" button lists the shortcuts.
  await note.fill('モーダルの間は保存しない');
  await form(page).getByTestId('form-shortcuts').click();
  const help = page.getByRole('dialog', { name: 'キーボード操作', exact: true });
  await expect(help.getByTestId('form-shortcut-list')).toContainText('Ctrl+S');
  await expect(help.getByTestId('form-shortcut-list')).toContainText('Alt+↑ / Alt+↓');
  // While a modal is open Ctrl+S saves nothing, and still keeps the browser's save dialog closed.
  await resetLastKey(page);
  await page.keyboard.press('Control+s');
  expect(await lastKey(page)).toEqual({ key: 's', prevented: true });
  await expect(form(page)).toHaveAttribute('data-dirty', 'true');
  await help.getByRole('button', { name: '閉じる', exact: true }).first().click();
  await expect(help).toHaveCount(0);
  expect((await api<Row>(request, headers, `/api/sales_invoice/${invoice.id}`)).note).toBe('Ctrl+Enter で保存');
});

test('form-ergonomics AC-6: Enter walks the line cells and adds a row at the end; Alt+↑ moves the row', async ({
  page,
}) => {
  await signInQuality(page);
  await page.goto('/e/sales_invoice/new');
  const grid = page.getByTestId('lines-sales_invoice_line');
  await grid.getByRole('button', { name: '行を追加' }).click();
  const rows = grid.getByTestId('line-row');
  await expect(rows).toHaveCount(1);
  const cell = (row: number, name: string) =>
    rows.nth(row).locator(`td[data-field="${name}"]`).locator('input, select');
  await cell(0, 'description').fill('一行目');
  // The Enter that confirms an IME conversion stays with the IME: no move, no row. React's synthetic event has no
  // isComposing, so this checks the native one (Chrome) and keyCode 229 (Safari).
  const imeEnter = (nativeComposing: boolean) =>
    cell(0, 'description').evaluate((element, composing) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: composing,
      });
      if (!composing) Object.defineProperty(event, 'keyCode', { get: () => 229 });
      element.dispatchEvent(event);
    }, nativeComposing);
  await imeEnter(true);
  await expect(cell(0, 'description')).toBeFocused();
  await imeEnter(false);
  await expect(cell(0, 'description')).toBeFocused();
  await expect(rows).toHaveCount(1);
  await cell(0, 'description').press('Enter');
  await expect(cell(0, 'quantity')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cell(0, 'unitPrice')).toBeFocused();
  await page.keyboard.type('1200');
  await page.keyboard.press('Enter');
  await expect(cell(0, 'taxCategory')).toBeFocused();
  // The last input cell of the last row appends a row and moves to its first input cell.
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(cell(1, 'productId')).toBeFocused();
  // An untouched product box (opened by focus, nothing typed) lets Enter move on instead of picking a product.
  await page.keyboard.press('Enter');
  await expect(cell(1, 'description')).toBeFocused();
  await expect(cell(1, 'productId')).toHaveValue('');
  await page.keyboard.type('二行目');
  // Alt+↑ moves the row up and keeps the focus in the same cell.
  await page.keyboard.press('Alt+ArrowUp');
  await expect(cell(0, 'description')).toHaveValue('二行目');
  await expect(cell(1, 'description')).toHaveValue('一行目');
  await expect(cell(0, 'description')).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(cell(1, 'description')).toHaveValue('二行目');
  await expect(cell(1, 'description')).toBeFocused();
  // At the edge nothing moves.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(cell(1, 'description')).toHaveValue('二行目');
  await expect(grid).toContainText('Enter: 次の欄へ');
  // Outside the grid Alt+↓ still opens a reference list (the combobox pattern); only grid cells hand it to the row.
  const partner = form(page).locator('input[name=partnerId]');
  await partner.focus();
  await partner.press('Escape');
  await expect(partner).toHaveAttribute('aria-expanded', 'false');
  await partner.press('Alt+ArrowDown');
  await expect(partner).toHaveAttribute('aria-expanded', 'true');
});

test('form-ergonomics AC-7/AC-2: at 390px Save and Submit sit in the bottom bar and labelled sections become tabs', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const { invoice } = await draftInvoice(request, headers, `スマホ ${suffix()}`);
  await signInQuality(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  await expect(form(page)).toHaveAttribute('data-layout', 'tabs');
  const tabs = form(page).getByRole('tablist', { name: '入力項目の区分', exact: true });
  await expect(tabs.getByRole('tab')).toHaveText(['請求', '金額', '入金', '備考・仕訳']);
  await tabs.getByRole('tab', { name: '金額', exact: true }).click();
  await expect(form(page).getByRole('tabpanel', { name: '金額', exact: true })).toContainText('税込合計');
  // The bar is pinned to the bottom of the screen while the top of the form is in view.
  await page.getByTestId('record-title').scrollIntoViewIfNeeded();
  const bar = page.getByTestId('form-toolbar');
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  if (barBox) {
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(844 + 1);
    expect(barBox.y + barBox.height).toBeGreaterThan(844 - 40);
  }
  await expect(bar.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: '確定', exact: true })).toBeVisible();
  // One Submit button on the screen: the header's moves into the bar.
  await expect(page.getByRole('button', { name: '確定', exact: true })).toHaveCount(1);
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('form-390-bottom-bar.png') });
  // The bar's Submit opens the same confirmation; focus comes back to it.
  await bar.getByRole('button', { name: '確定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確定', exact: true });
  await dialog.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(bar.getByRole('button', { name: '確定', exact: true })).toBeFocused();
  // An input scrolled into view is not hidden under the bar (the scroll area keeps the bar's height free).
  await page.getByTestId('record-title').scrollIntoViewIfNeeded();
  const description = page
    .getByTestId('lines-sales_invoice_line')
    .locator('td[data-field="description"] input')
    .first();
  await description.evaluate((element) => element.scrollIntoView({ block: 'end' }));
  const inputBox = await description.boundingBox();
  const barNow = await bar.boundingBox();
  expect(inputBox && barNow && inputBox.y + inputBox.height <= barNow.y + 1).toBe(true);
  // Unsaved changes disable the bar's Submit like the header's.
  await tabs.getByRole('tab', { name: '備考・仕訳', exact: true }).click();
  await form(page).locator('textarea[name=note]').fill('スマホで編集');
  await expect(bar.getByRole('button', { name: '確定', exact: true })).toBeDisabled();
  // The bar with the unsaved-changes label still leaves a scrolled-in input visible (scroll-padding follows its height).
  await expect(bar.locator('.dirty-label')).toBeVisible();
  await page.getByTestId('record-title').scrollIntoViewIfNeeded();
  await description.evaluate((element) => element.scrollIntoView({ block: 'end' }));
  await expect
    .poll(async () => {
      const input = await description.boundingBox();
      const dirtyBar = await bar.boundingBox();
      return input !== null && dirtyBar !== null && input.y + input.height <= dirtyBar.y + 1;
    })
    .toBe(true);
  // Toasts sit above the bar: right after a save the bar's Submit takes the tap, not the 「保存しました」 toast.
  await bar.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form(page)).toHaveAttribute('data-dirty', 'false');
  const toasts = page.locator('.toast-viewport');
  await expect(toasts).toContainText('保存しました');
  // With the top of the form in view the bar is pinned to the bottom of the screen, where the toasts appear.
  await page.getByTestId('record-title').scrollIntoViewIfNeeded();
  const barSubmit = bar.getByRole('button', { name: '確定', exact: true });
  await expect(barSubmit).toBeEnabled();
  await expect
    .poll(async () => {
      const toastBox = await toasts.boundingBox();
      const barBox = await bar.boundingBox();
      return (
        toastBox !== null &&
        barBox !== null &&
        barBox.y + barBox.height > 844 - 40 &&
        toastBox.y + toastBox.height <= barBox.y + 1
      );
    })
    .toBe(true);
  const hit = await barSubmit.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return at !== null && element.contains(at);
  });
  expect(hit).toBe(true);
  await form(page).locator('textarea[name=note]').fill('スマホで再編集');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(bar.getByRole('button', { name: '確定', exact: true })).toBeHidden();
  await expect(page.locator('.doc-action-submit')).toBeVisible();
});

test('form-ergonomics AC-3/AC-2: at 390px a summary link opens the tab of the invalid field', async ({ page }) => {
  await signInQuality(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e/partner/new');
  await expect(form(page)).toHaveAttribute('data-layout', 'tabs');
  const tabs = form(page).getByRole('tablist', { name: '入力項目の区分', exact: true });
  await tabs.getByRole('tab', { name: '振込口座', exact: true }).click();
  await expect(form(page).locator('input[name=bankName]')).toBeVisible();
  await form(page).locator('input[name=bankName]').fill('D3 銀行');
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  // The first invalid field (名称) is in another tab: the tab opens, shows its error count, and the field has focus.
  await expect(summary(page)).toBeVisible();
  await expect(tabs.getByRole('tab', { name: /基本/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: /基本/ })).toContainText('1');
  await expect(form(page).locator('input[name=name]')).toBeFocused();
  // Values typed in another tab are kept.
  await tabs.getByRole('tab', { name: '振込口座', exact: true }).click();
  await expect(form(page).locator('input[name=bankName]')).toHaveValue('D3 銀行');
  await summary(page).getByRole('link', { name: /名称/ }).click();
  await expect(form(page).locator('input[name=name]')).toBeFocused();
  await assertNoOverflow(page);
});

test('form-ergonomics AC-8: unsaved input survives a reload and is offered back; saving clears it; a newer version is not offered', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, `D3 退避 ${suffix()}`);
  // beforeunload on reload and the leave confirmation: accept, and remember what the in-app confirmation said.
  let message = '';
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'confirm') message = dialog.message();
    dialog.accept().catch(() => {});
  });
  await signInQuality(page);
  await page.goto(`/e/partner/${partner.id}`);
  const name = form(page).locator('input[name=name]');
  await name.fill(`${String(partner.name)} 編集中`);
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  const stored = await page.evaluate((key) => sessionStorage.getItem(key), (await draftKeys(page))[0] ?? '');
  expect(stored).toContain('編集中');
  expect(stored).not.toContain(String(partner.code)); // only what changed
  await page.reload();
  const offer = page.getByTestId('draft-offer');
  await expect(offer).toContainText('前回の未保存の入力が残っています');
  await expect(name).toHaveValue(String(partner.name));
  // Undecided offers stay: the draft is still stored (opening the screen never removes it) and comes back again.
  await page.waitForTimeout(800);
  expect(await draftKeys(page)).toHaveLength(1);
  await page.reload();
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: '復元する', exact: true }).click();
  await expect(name).toHaveValue(`${String(partner.name)} 編集中`);
  await expect(form(page)).toHaveAttribute('data-dirty', 'true');
  await page.keyboard.press('Control+s');
  await expect(form(page)).toHaveAttribute('data-dirty', 'false');
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
  await page.reload();
  await expect(form(page)).toBeVisible();
  await expect(page.getByTestId('draft-offer')).toHaveCount(0);

  // A draft made on an older version is dropped with a notice, not offered.
  await name.fill('古い版での入力');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  const current = await api<Row>(request, headers, `/api/partner/${partner.id}`);
  await api(
    request,
    headers,
    `/api/partner/${partner.id}`,
    { patch: { notes: '別の人が更新' }, expectedVersion: current.version },
    'PATCH',
  );
  await page.reload();
  await expect(page.getByTestId('draft-stale')).toContainText('前回の未保存の入力は復元しません');
  await expect(page.getByTestId('draft-offer')).toHaveCount(0);
  await expect.poll(() => draftKeys(page)).toHaveLength(0);

  // A new record: leaving keeps the input (the confirmation says so) and coming back offers it.
  await page.goto('/e/partner/new');
  await form(page).locator('input[name=name]').fill('D3 新規の下書き');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await page.getByRole('link', { name: '← 取引先' }).click();
  await expect(page).toHaveURL(/\/e\/partner(\?.*)?$/);
  expect(message).toContain('この画面に戻ると復元できます');
  await page.goto('/e/partner/new');
  await page.getByTestId('draft-offer').getByRole('button', { name: '破棄する', exact: true }).click();
  await expect(page.getByTestId('draft-offer')).toHaveCount(0);
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
  await expect(form(page).locator('input[name=name]')).toHaveValue('');
});

test('form-ergonomics AC-8: a refetch while the input is unsaved keeps the draft on the version the input was made on', async ({
  page,
  context,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, `D3 版 ${suffix()}`);
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
  await signInQuality(page);
  await page.goto(`/e/partner/${partner.id}`);
  await expect(form(page)).toHaveAttribute('data-mode', 'update');
  const opened = await api<Row>(request, headers, `/api/partner/${partner.id}`);
  const storedVersion = () =>
    page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('daifuku.form-draft.v1.'));
      return key ? (JSON.parse(sessionStorage.getItem(key) ?? '{}') as { baseVersion?: unknown }).baseVersion : null;
    });
  // Past the record query's staleTime, so a reconnect refetches it.
  await page.waitForTimeout(6000);
  const name = form(page).locator('input[name=name]');
  await name.fill(`${String(partner.name)} 編集中`);
  await expect.poll(storedVersion).toBe(opened.version);
  // Someone else saves; the record refetches (network reconnect) while the input is unsaved.
  await api(
    request,
    headers,
    `/api/partner/${partner.id}`,
    { patch: { notes: '別の人が更新' }, expectedVersion: opened.version },
    'PATCH',
  );
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await context.setOffline(false);
  await expect(page.getByTestId('conflict')).toBeVisible();
  // More typing and leaving the page still store the version the input was made on.
  await name.press('End');
  await page.keyboard.type('!');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await storedVersion()).toBe(opened.version);
  await page.reload();
  await expect(page.getByTestId('draft-stale')).toBeVisible();
  await expect(page.getByTestId('draft-offer')).toHaveCount(0);
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
});

test('form-ergonomics AC-8: a record read denied (404) or an entity gone from the meta keeps no draft', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, `D3 拒否 ${suffix()}`);
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
  await signInQuality(page);
  await page.goto(`/e/partner/${partner.id}`);
  await form(page)
    .locator('input[name=name]')
    .fill(`${String(partner.name)} 編集中`);
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  // The record is gone for this user: the reload stores the input on the way out, and the 404 removes it.
  await page.route(`**/api/partner/${partner.id}`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(failedRead(404)) : route.fallback(),
  );
  await page.reload();
  await expect(page.getByTestId('record-form')).toHaveCount(0);
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
  await page.unroute(`**/api/partner/${partner.id}`);
  // The entity itself leaves the user's meta: every draft of it in this boundary goes (the record read never runs).
  await page.goto('/e/partner/new');
  await form(page).locator('input[name=name]').fill('D3 権限がなくなる新規');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await page.route('**/meta', async (route) => {
    const response = await route.fetch();
    const meta = (await response.json()) as { entities: { name: string }[] };
    await route.fulfill({
      response,
      json: { ...meta, entities: meta.entities.filter((entity) => entity.name !== 'partner') },
    });
  });
  await page.reload();
  await expect(page.getByTestId('record-form')).toHaveCount(0);
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
});

test('form-ergonomics AC-8: sign-out clears the drafts; after an expired session only the same user gets them back', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, `D3 ログアウト ${suffix()}`);
  const other = await qualityEmployee(request);
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
  const name = form(page).locator('input[name=name]');
  const expire = async () => {
    await page.evaluate(() => sessionStorage.setItem('daifuku.token', 'expired-synthetic-token'));
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  };
  await signInQuality(page);
  // Explicit sign-out from the sidebar with unsaved input: the leave confirmation, then no draft is left.
  await page.goto(`/e/partner/${partner.id}`);
  await name.fill(`${String(partner.name)} 編集中`);
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForTimeout(800);
  expect(await draftKeys(page)).toHaveLength(0);
  // An expired session keeps the draft for the same user: signing in again offers it.
  await signInQuality(page);
  await page.goto(`/e/partner/${partner.id}`);
  await name.fill(`${String(partner.name)} 期限切れの前`);
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await expire();
  expect(await draftKeys(page)).toHaveLength(1);
  await signInQuality(page);
  expect(await draftKeys(page)).toHaveLength(1);
  await page.goto(`/e/partner/${partner.id}`);
  await expect(page.getByTestId('draft-offer')).toBeVisible();
  // Someone else signing in on the same tab after an expiry: the previous user's drafts go.
  await page.getByTestId('draft-offer').getByRole('button', { name: '復元する', exact: true }).click();
  await expect(name).toHaveValue(`${String(partner.name)} 期限切れの前`);
  await expire();
  expect(await draftKeys(page)).toHaveLength(1);
  await signInQuality(page, other.email, PASSWORD);
  expect(await draftKeys(page)).toHaveLength(0);
});

test('form-ergonomics AC-9: previous / next cross the page edge with the same criteria', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { headers } = await qualitySession(request);
  const key = `D3頁${suffix()}`;
  for (let i = 1; i <= 52; i++) await qualityPartner(request, headers, `${key} ${String(i).padStart(3, '0')}`);
  await signInQuality(page);
  await page.goto(`/e/partner?q=${encodeURIComponent(key)}&sort=name:asc`);
  await expect(page.getByTestId('total')).toContainText('52');
  await page
    .getByRole('row')
    .filter({ hasText: `${key} 050` })
    .click();
  const title = page.getByTestId('record-title');
  const nav = page.getByTestId('record-nav');
  await expect(title).toHaveText(`${key} 050`);
  await expect(nav.getByTestId('record-position')).toHaveText('50 / 52 件');
  // Next from the last row of page 1 reads page 2 of the same criteria.
  await nav.getByTestId('record-next').click();
  await expect(title).toHaveText(`${key} 051`);
  await expect(nav.getByTestId('record-position')).toHaveText('51 / 52 件');
  // Back to the list opens the page the record is on.
  await expect(page.getByRole('link', { name: '← 取引先' })).toHaveAttribute('href', /[?&]page=2(&|$)/);
  await nav.getByTestId('record-next').click();
  await expect(title).toHaveText(`${key} 052`);
  await expect(nav.getByTestId('record-next')).toBeDisabled();
  // Previous from the first row of page 2 reads page 1 again (page 1 has no page key, like the list's URL).
  await nav.getByTestId('record-prev').click();
  await expect(title).toHaveText(`${key} 051`);
  await nav.getByTestId('record-prev').click();
  await expect(title).toHaveText(`${key} 050`);
  await expect(nav.getByTestId('record-position')).toHaveText('50 / 52 件');
  await expect(page.getByRole('link', { name: '← 取引先' })).not.toHaveAttribute('href', /[?&]page=/);
  await page.getByRole('link', { name: '← 取引先' }).click();
  await expect(page).toHaveURL(new RegExp(`/e/partner\\?.*q=${encodeURIComponent(key)}`));
  await expect(page.getByRole('row').filter({ hasText: `${key} 050` })).toBeVisible();
});

test('form-ergonomics AC-9: previous / next follow the list the record was opened from', async ({ page, request }) => {
  const { headers } = await qualitySession(request);
  const key = `D3前後${suffix()}`;
  for (const letter of ['A', 'B', 'C']) await qualityPartner(request, headers, `${key} ${letter}`);
  await signInQuality(page);
  await page.goto(`/e/partner?q=${encodeURIComponent(key)}&sort=name:asc`);
  await expect(page.getByTestId('total')).toContainText('3');
  await page
    .getByRole('row')
    .filter({ hasText: `${key} A` })
    .click();
  await expect(page.getByTestId('record-title')).toHaveText(`${key} A`);
  const nav = page.getByTestId('record-nav');
  await expect(nav.getByTestId('record-position')).toHaveText('1 / 3 件');
  await expect(nav.getByTestId('record-prev')).toBeDisabled();
  await nav.getByTestId('record-next').click();
  await expect(page.getByTestId('record-title')).toHaveText(`${key} B`);
  await expect(nav.getByTestId('record-position')).toHaveText('2 / 3 件');
  await nav.getByTestId('record-next').click();
  await expect(page.getByTestId('record-title')).toHaveText(`${key} C`);
  await expect(nav.getByTestId('record-next')).toBeDisabled();
  // Unsaved changes go through the existing discard confirmation; dismissing it stays on the record.
  await form(page).locator('input[name=name]').fill(`${key} C 編集中`);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await nav.getByTestId('record-prev').click();
  await expect(page.getByTestId('record-title')).toHaveText(`${key} C`);
  await expect(form(page).locator('input[name=name]')).toHaveValue(`${key} C 編集中`);
  page.once('dialog', (dialog) => void dialog.accept());
  await nav.getByTestId('record-prev').click();
  await expect(page.getByTestId('record-title')).toHaveText(`${key} B`);
  // Back to the list keeps its search and sort.
  await page.getByRole('link', { name: '← 取引先' }).click();
  await expect(page).toHaveURL(new RegExp(`/e/partner\\?.*q=${encodeURIComponent(key)}`));
  await expect(page.getByTestId('total')).toContainText('3');
  // A record opened without the list (a direct link) shows no position.
  const direct = await qualityPartner(request, headers, `${key} 直接`);
  await page.goto(`/e/partner/${direct.id}`);
  await expect(page.getByTestId('record-title')).toHaveText(`${key} 直接`);
  await expect(page.getByTestId('record-nav')).toHaveCount(0);
});

/** Serious / critical WCAG 2.1 A/AA findings of the current page (the a11y spec's rule, without its exception file). */
async function axeFailures(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  return results.violations
    .filter((violation) => FAILING_IMPACTS.includes(violation.impact ?? ''))
    .flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`));
}

test('form-ergonomics AC-2/AC-3/AC-4: axe finds no serious problem in the sections, the tabs and the error summary', async ({
  page,
}) => {
  await signInQuality(page);
  // 1280px: labelled fieldsets, required marks, helper text, and the summary after a failed save (links on the
  // danger background).
  await page.goto('/e/partner/new');
  await expect(form(page).getByRole('group', { name: '振込口座', exact: true })).toBeVisible();
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(summary(page)).toBeVisible();
  expect(await axeFailures(page)).toEqual([]);
  // 390px: the tabs with an error count and the bottom bar.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(form(page)).toHaveAttribute('data-layout', 'tabs');
  await expect(form(page).getByRole('tab', { name: /基本/ })).toContainText('1');
  expect(await axeFailures(page)).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
});
