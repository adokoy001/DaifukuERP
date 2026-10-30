// Recurring journals in the browser (docs/specs/recurring-journals.md AC-3, AC-23..AC-25): register a template with two
// lines in the generic form (entity lines, ADR-0031), see its read-only next run date, generate the due occurrence as a
// draft from /finance/recurring through the kit dialog (at 390px), keyboard focus on the result, open the draft from the
// result, see "nothing due" afterwards; 390px without horizontal overflow and axe for the populated schedule, the open
// dialog, the result, the saved form with its line grid and the English empty state. A viewer does not find the screen
// in the screen search and opening the URL directly gets the no-permission explanation.
// Data: a fresh synthetic company per test (commerceFixture), so generated drafts never change other specs' counts; its
// previous month is an open fiscal period that contains the due occurrence.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { judge, WCAG_TAGS, type A11yLocale, type A11yWidth } from './a11y-policy.ts';
import { commerceFixture } from './commerce-helpers.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { api, PASSWORD } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

test.setTimeout(180_000);

async function choose(cell: Locator, name: string) {
  const input = cell.getByRole('combobox');
  await input.fill(name);
  await cell.getByRole('option').filter({ hasText: name }).first().click();
  await expect(input).toHaveValue(name);
}
async function amount(cell: Locator, value: string) {
  const input = cell.locator('input');
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.pressSequentially(value);
  await input.press('Tab');
  await expect(input).toHaveAttribute('data-raw', value);
}
async function axe(page: Page, locale: A11yLocale, width: A11yWidth, screen = 'recurring') {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const judgement = judge(results.violations, [], { screen, locale, width }, results.incomplete);
  expect(
    judgement.failures.map((f) => `${f.rule} ${f.target}`),
    `axe ${screen} ${locale} ${width}`,
  ).toEqual([]);
}

test('AC-3 AC-23 AC-24 AC-25 recurring journals: register with lines, generate the due draft from the screen, then nothing is due', async ({
  page,
  request,
}) => {
  const f = await commerceFixture(request);
  const name = '事務所家賃 E2E ' + f.runId;
  await signInQuality(page, f.email, PASSWORD);

  // AC-24 / AC-3: the generic list and form of the module menu, with the line grid under the header.
  await openScreen(page, '/e/recurring_journal');
  await page.getByRole('link', { name: /新規/ }).first().click();
  const form = page.getByTestId('record-form');
  await expect(form).toHaveAttribute('data-mode', 'create');
  await form.locator('div[data-field="name"] input').fill(name);
  await form.locator('div[data-field="description"] input').fill('事務所家賃 未払計上');
  await form.locator('div[data-field="startDate"] input').fill(f.period.from);
  await form.locator('div[data-field="endDate"] input').fill(f.period.to);
  // server-owned run dates are not inputs of a new record
  await expect(form.locator('div[data-field="nextRunDate"] input')).toHaveCount(0);
  const grid = page.getByTestId('lines-recurring_journal_line');
  await grid.getByRole('button', { name: '行を追加' }).click();
  await grid.getByRole('button', { name: '行を追加' }).click();
  const rows = grid.getByTestId('line-row');
  await expect(rows).toHaveCount(2);
  await choose(rows.nth(0).locator('[data-field="accountId"]'), '費用');
  await amount(rows.nth(0).locator('[data-field="debit"]'), '120000');
  await choose(rows.nth(1).locator('[data-field="accountId"]'), '前払金');
  await amount(rows.nth(1).locator('[data-field="credit"]'), '120000');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/recurring_journal'),
  );
  await form.getByRole('button', { name: '保存', exact: true }).click();
  const saved = await created;
  expect(saved.ok(), await saved.text()).toBe(true);
  // one request carried the header and both lines
  expect(saved.request().postDataJSON()).toMatchObject({
    name,
    lines: { recurring_journal_line: [{ debit: '120000' }, { credit: '120000' }] },
  });
  await expect(page).toHaveURL(/\/e\/recurring_journal\/[0-9a-f-]{36}$/);
  const templatePath = new URL(page.url()).pathname;
  await expect(form.locator('div[data-field="nextRunDate"] input')).toHaveValue(f.period.to);
  await expect(form.locator('div[data-field="nextRunDate"] input')).toBeDisabled();
  await expect(grid.getByTestId('line-row')).toHaveCount(2);
  await expect(grid).not.toHaveAttribute('data-readonly', 'true');

  // AC-23: the dedicated screen from the screen search shows the due occurrence and generates it after the dialog.
  await openScreen(page, '/finance/recurring');
  await expect(page.getByRole('heading', { level: 1, name: '定期仕訳の生成', exact: true })).toBeVisible();
  const row = page.getByTestId('recurring-schedule-row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(f.period.to);
  await expect(row.getByTestId('recurring-schedule-status')).toHaveText('生成する');
  await expect(page.getByTestId('recurring-auto-submit')).toContainText('下書き');
  await axe(page, 'ja', 1280);
  // AC-25 at 390px: the populated schedule and the open confirm dialog fit without horizontal overflow and pass axe.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toBeVisible();
  await assertNoOverflow(page);
  await page.getByRole('button', { name: '下書きを生成', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '戻る', exact: true })).toBeFocused();
  await assertNoOverflow(page);
  await axe(page, 'ja', 390);
  const generated = page.waitForResponse((r) => r.url().endsWith('/actions/accounting.generate_recurring'));
  await dialog.getByTestId('recurring-confirm').click();
  const response = await generated;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  await expect(dialog).toHaveCount(0);
  const result = page.getByTestId('recurring-result').filter({ hasText: name });
  await expect(result.getByTestId('recurring-result-status')).toHaveText('生成しました');
  // the opener is disabled now (nothing due), so keyboard focus moves to the result heading instead of <body>
  await expect(page.getByRole('heading', { level: 2, name: '生成の結果', exact: true })).toBeFocused();
  await expect(
    page.getByTestId('recurring-result-links').getByRole('link', { name: '月次締めガイド' }),
  ).toHaveAttribute('href', '/finance/close');
  // the schedule is read again: nothing left to generate
  await expect(page.getByTestId('recurring-nothing-due')).toContainText('生成する定期仕訳はありません');
  await expect(page.getByRole('button', { name: '下書きを生成', exact: true })).toBeDisabled();
  // AC-25: the result card and the empty state at 390px
  await assertNoOverflow(page);
  await axe(page, 'ja', 390);
  await page.screenshot({ path: test.info().outputPath('recurring-390.png'), fullPage: true });
  // the manual's picture (docs/manual/img/06-recurring.png): desktop width, once the success toast has gone
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.ui-toast')).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: test.info().outputPath('recurring-desktop.png'), fullPage: true });

  // The result links to the draft entry it created.
  await result.getByTestId('recurring-entry-link').click();
  await expect(page).toHaveURL(/\/e\/journal_entry\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '0');
  await expect(page.getByTestId('record-form').locator('div[data-field="description"] input')).toHaveValue(
    '事務所家賃 未払計上',
  );

  // AC-25: the saved recurring journal's form with its two-line grid at 390px. The grid is wider than the screen and
  // scrolls inside its own frame (inputs inside, so the frame is not a Tab stop of its own); the page does not overflow.
  await page.goto(templatePath);
  await page.setViewportSize({ width: 390, height: 844 });
  const savedGrid = page.getByTestId('lines-recurring_journal_line');
  await expect(savedGrid.getByTestId('line-row')).toHaveCount(2);
  const frame = savedGrid.locator(':scope > .overflow-x-auto');
  await expect(frame).toBeVisible();
  await expect(frame).not.toHaveAttribute('tabindex');
  await assertNoOverflow(page);
  await axe(page, 'ja', 390, 'recurring-form');

  // AC-25: English at 390px (the empty state for a base date with nothing due).
  await page.goto('/finance/recurring');
  await expect(page.getByTestId('recurring-nothing-due')).toBeVisible();
  await page.getByTestId('recurring-as-of').fill(f.period.to);
  await expect(page.getByTestId('recurring-nothing-due')).toBeVisible();
  // the language switch sits in the desktop header; switch there, then check English at 390px again
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1, name: 'Generate recurring journals', exact: true })).toBeVisible();
  await expect(page.getByTestId('recurring-nothing-due')).toContainText('No recurring journals are due');
  await assertNoOverflow(page);
  await axe(page, 'en', 390);
});

test('AC-24 a viewer does not find /finance/recurring in the screen search; opening it directly explains why', async ({
  page,
  request,
}) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `recurring-viewer-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', {
    name: '定期仕訳閲覧 ' + suffix,
    email,
    password: PASSWORD,
  });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['viewer'], accessScope: 'all', siteIds: [], storeIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  // the viewer reads the templates (their list is found) but cannot run the generation (its screen is not listed)
  await findScreen(page, '定期仕訳');
  await expect(page.locator('main a[data-screen-href="/e/recurring_journal"]')).toHaveCount(1);
  await expect(page.locator('main a[data-screen-href="/finance/recurring"]')).toHaveCount(0);
  await page.goto('/finance/recurring');
  await expect(page.getByRole('heading', { level: 1, name: '定期仕訳を生成する権限がありません' })).toBeVisible();
  await expect(page.getByTestId('recurring-no-permission')).toContainText('経理または管理者の役割が必要です');
});
