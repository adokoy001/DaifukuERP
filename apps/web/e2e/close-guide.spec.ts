// Month-end close guide in the browser (docs/specs/close-guide.md AC-8..AC-13): period picker and default, blocking
// draft disables the close, report links carry the period, close through the kit dialog, closed state with reopen,
// the re-check right before closing, and the 390px layout. Data: a fresh synthetic company (commerceFixture).
import { expect, test, type Page } from '@playwright/test';
import { commerceFixture } from './commerce-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';
import { openScreen } from './navigation-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, failedRead, qualitySession, signInQuality } from './quality-helpers.ts';

test.setTimeout(180_000);

type Period = Row & { code: string; startDate: string; endDate: string; isClosed: boolean };
const option = (p: Period) => `${p.code}（${p.startDate}〜${p.endDate}${p.isClosed ? '・締め済み' : ''}）`;
const item = (page: Page, id: string) => page.getByTestId(`close-item-${id}`);
const heading = (page: Page) => page.getByTestId('close-status').getByRole('heading', { level: 2 });
const periodInUrl = (page: Page) => new URL(page.url()).searchParams.get('periodId');
const READINESS = '**/actions/accounting.close_readiness';

test('AC-8..AC-13 close guide: a draft blocks the close; after submitting it the period closes and can be reopened', async ({
  page,
  request,
}) => {
  const f = await commerceFixture(request);
  const h = f.headers;
  const periods = (await api<{ items: Period[] }>(request, h, '/api/fiscal_period?orderBy=startDate:asc&limit=500'))
    .items;
  const targetIndex = periods.findIndex((p) => p.code === f.period.month);
  const target = periods[targetIndex];
  const expectedDefault = periods.find((p) => !p.isClosed && p.endDate < BUSINESS_DATE);
  if (!target || !expectedDefault) throw new Error('fixture periods missing');
  const previous = periods[targetIndex - 1];
  // Two steps through the picker (newest first): older when there are two older periods, else newer.
  const older = targetIndex >= 2;
  const oneAway = periods[older ? targetIndex - 1 : targetIndex + 1];
  const twoAway = periods[older ? targetIndex - 2 : targetIndex + 2];
  if (!oneAway || !twoAway) throw new Error('fixture needs five periods around the target');
  const draft = await api(request, h, '/api/journal_entry', {
    date: f.period.to,
    description: '締めガイド 下書き',
    lines: {
      journal_line: [
        { accountId: f.accounts['1000'], debit: '500' },
        { accountId: f.accounts['4000'], credit: '500' },
      ],
    },
  });

  await signInQuality(page, f.email, PASSWORD);
  const checks: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/actions/accounting.close_readiness')) checks.push(r.postData() ?? '');
  });
  // AC-12: reachable from the finance workspace search as a dedicated screen.
  await openScreen(page, '/finance/close');
  await expect(page.getByRole('heading', { level: 1, name: '月次締め', exact: true })).toBeVisible();
  const picker = page.getByLabel('会計期間', { exact: true });
  // AC-8: default is the oldest open period that ended before today; it is pinned in the URL from the one answer.
  await expect(picker).toHaveValue(expectedDefault.id);
  await expect(heading(page)).toHaveText(expectedDefault.code);
  await expect.poll(() => periodInUrl(page)).toBe(expectedDefault.id);
  await expect(page.getByTestId('close-state')).toBeVisible();
  // Only default requests (`{}`; the dev server's StrictMode remount aborts and repeats the first): the pinned
  // period reuses that answer instead of being counted again.
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.filter((body) => body !== '{}')).toEqual([]);

  await picker.selectOption({ label: option(target) });
  await expect.poll(() => periodInUrl(page)).toBe(target.id);
  await expect(heading(page)).toHaveText(target.code);

  // The picker moves from the period in the URL while the next check is still loading (arrow keys on a closed
  // select), and never shows a loading placeholder as its value.
  await page.route(READINESS, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue().catch(() => undefined);
  });
  await picker.focus();
  await page.keyboard.press(older ? 'ArrowDown' : 'ArrowUp');
  await expect.poll(() => periodInUrl(page)).toBe(oneAway.id);
  // The next check is still loading (its skeleton is up); the select keeps the period from the URL. Read once, not
  // with a retrying assertion, so the delayed answer cannot make it pass.
  await expect(page.locator('.ui-skeleton-card').first()).toBeVisible();
  expect(await picker.inputValue()).toBe(oneAway.id);
  expect(await picker.locator('option:checked').textContent()).toBe(option(oneAway));
  await page.keyboard.press(older ? 'ArrowDown' : 'ArrowUp');
  await expect(picker).toHaveValue(twoAway.id);
  await expect.poll(() => periodInUrl(page)).toBe(twoAway.id);
  await expect(heading(page)).toHaveText(twoAway.code);
  await page.unroute(READINESS);
  await picker.selectOption({ label: option(target) });
  await expect(heading(page)).toHaveText(target.code);

  // AC-9 / AC-10: the blocking draft is listed with its count, period and list link; the close button is disabled.
  const blocking = item(page, 'draft:journal_entry');
  await expect(page.getByTestId('close-blocking')).toContainText('仕訳の下書き');
  await expect(blocking.getByTestId('close-item-count')).toHaveText('1 件');
  await expect(blocking).toContainText(`${target.startDate}〜${target.endDate}の下書き`);
  await expect(blocking.getByRole('link', { name: '一覧を開く（仕訳の下書き）' })).toHaveAttribute(
    'href',
    '/e/journal_entry',
  );
  await expect(page.getByTestId('close-state')).toHaveText('締める前の作業があります');
  const closeButton = page.getByRole('button', { name: 'この期間を締める', exact: true });
  await expect(closeButton).toBeDisabled();
  await expect(page.getByTestId('close-blocked-reason')).toHaveText(
    '締める前に次を確定または削除してください: 仕訳の下書き 1 件',
  );
  await expect(closeButton).toHaveAccessibleDescription(/仕訳の下書き 1 件/);

  // Zero-count items (blocking types included) are folded in their own section, not under the non-blocking checks.
  await expect(page.getByTestId('close-clear')).toBeVisible();
  await expect(page.getByTestId('close-clear-list')).toContainText('売上請求書の下書き');
  await expect(
    page.getByRole('region', { name: '確認事項（締めは止めません）', exact: true }).getByTestId('close-clear'),
  ).toHaveCount(0);

  // AC-8: report links carry the period; the trial balance opens with it filled in.
  const trial = page.getByTestId('close-reports').getByRole('link', { name: '試算表', exact: true });
  await expect(trial).toHaveAttribute(
    'href',
    `/r/accounting.trial_balance?from=${target.startDate}&to=${target.endDate}`,
  );
  await expect(
    page.getByTestId('close-reports').getByRole('link', { name: '売掛金年齢表', exact: true }),
  ).toHaveAttribute('href', `/r/sales.ar_aging?asOf=${target.endDate}`);
  await trial.click();
  await expect(page.getByTestId('report-name')).toHaveText('試算表');
  await expect(page.getByLabel('開始日', { exact: true })).toHaveValue(target.startDate);
  await expect(page.getByLabel('終了日', { exact: true })).toHaveValue(target.endDate);
  await page.goBack();
  await expect(heading(page)).toHaveText(target.code);

  // Submit the draft elsewhere, then re-check: nothing blocks any more.
  const current = await api(request, h, '/api/journal_entry/' + draft.id);
  await api(request, h, '/actions/journal_entry.submit', { id: draft.id, expectedVersion: current.version });
  await page.getByRole('button', { name: '再点検', exact: true }).click();
  await expect(page.getByTestId('close-state')).toHaveText('締められます');
  await expect(page.getByTestId('close-blocking-none')).toBeVisible();
  await expect(closeButton).toBeEnabled();
  // The finished re-check is announced (polite live region outside the busy area).
  await expect(page.getByTestId('close-announcement')).toHaveText(`再点検しました: ${target.code} 締められます。`);

  // A failed re-check keeps the previous result but says so and blocks closing until a check succeeds.
  await page.route(READINESS, (route) => route.fulfill(failedRead(503)));
  await page.getByRole('button', { name: '再点検', exact: true }).click();
  const stale = page.getByTestId('close-stale');
  await expect(stale).toHaveRole('alert');
  await expect(stale).toContainText('最新の点検に失敗しました');
  await expect(closeButton).toBeDisabled();
  await page.unroute(READINESS);
  await stale.getByRole('button', { name: '点検をやり直す', exact: true }).click();
  await expect(stale).toHaveCount(0);
  await expect(closeButton).toBeEnabled();

  // AC-5 / AC-9: the previous period is a state with a link to that period on this screen; focus follows it.
  if (previous) {
    const prior = item(page, 'previous_period_open');
    await expect(prior).toContainText(`前の会計期間（${previous.code}）の締め`);
    await expect(prior.getByTestId('close-item-count')).toHaveText('未締め');
    await prior.getByRole('link', { name: `その期間を開く（前の会計期間（${previous.code}）の締め）` }).click();
    await expect.poll(() => periodInUrl(page)).toBe(previous.id);
    await expect(heading(page)).toHaveText(previous.code);
    await expect(heading(page)).toBeFocused();
    await page.goBack();
    await expect(heading(page)).toHaveText(target.code);
    await expect(closeButton).toBeEnabled();
  }

  // AC-10: a draft created after the screen loaded is caught by the check right before closing.
  const late = await api(request, h, '/api/journal_entry', { date: f.period.to, description: '締めガイド 後から' });
  await closeButton.click();
  const dialog = page.getByRole('dialog', { name: `${target.code} を締めますか` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '戻る', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: '締める', exact: true }).click();
  await expect(page.getByText('締められない状態に変わりました')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('close-state')).toHaveText('締める前の作業があります');
  // The opener is disabled now, so the screen puts focus on the period heading instead of leaving it on <body>.
  await expect(heading(page)).toBeFocused();
  expect((await api<Period>(request, h, '/api/fiscal_period/' + target.id)).isClosed).toBe(false);
  const lateRow = await api(request, h, '/api/journal_entry/' + late.id);
  await api(request, h, '/actions/journal_entry.delete', { id: late.id, expectedVersion: lateRow.version });
  await page.getByRole('button', { name: '再点検', exact: true }).click();
  await expect(closeButton).toBeEnabled();

  // AC-10: confirm in the kit dialog; the existing accounting.close_period runs and the check is repeated.
  const closing = page.waitForResponse(
    (r) => r.url().endsWith('/actions/accounting.close_period') && r.request().method() === 'POST',
  );
  await closeButton.click();
  await dialog.getByRole('button', { name: '締める', exact: true }).click();
  expect((await closing).ok()).toBe(true);
  await expect(page.getByText(`${target.code} を締めました`)).toBeVisible();
  await expect(page.getByTestId('close-state')).toHaveText('締め済み');
  await expect(heading(page)).toBeFocused();
  expect((await api<Period>(request, h, '/api/fiscal_period/' + target.id)).isClosed).toBe(true);

  // AC-11: closed periods explain correction dates and offer reopening with a confirmation.
  await expect(page.getByTestId('close-closed-notice')).toContainText('訂正日');
  await expect(picker.locator('option:checked')).toHaveText(option({ ...target, isClosed: true }));
  await page.getByRole('button', { name: 'この期間を再開', exact: true }).click();
  const reopen = page.getByRole('dialog', { name: `${target.code} を再開しますか` });
  await reopen.getByRole('button', { name: '再開する', exact: true }).click();
  await expect(page.getByText(`${target.code} を再開しました`)).toBeVisible();
  await expect(page.getByTestId('close-state')).toHaveText('締められます');
  expect((await api<Period>(request, h, '/api/fiscal_period/' + target.id)).isClosed).toBe(false);
  await page.screenshot({ path: test.info().outputPath('close-guide-desktop.png'), fullPage: true });

  // AC-13: usable at 390px: no horizontal overflow, the picker and the close dialog fit.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('close-state')).toHaveText('締められます');
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('close-guide-390-page.png'), fullPage: true });
  await closeButton.click();
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('close-guide-390.png'), fullPage: true });
  await dialog.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(closeButton).toBeFocused();

  // AC-13: the same screen in English.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Month-end close', exact: true })).toBeVisible();
  await expect(page.getByTestId('close-state')).toHaveText('Ready to close');
  await expect(page.getByRole('button', { name: 'Close this period', exact: true })).toBeEnabled();
  await expect(
    page.getByTestId('close-reports').getByRole('link', { name: 'Trial balance', exact: true }),
  ).toBeVisible();
});

test('AC-8 AC-10 AC-11 closing the default period from the screen search stays on that period', async ({
  page,
  request,
}) => {
  const f = await commerceFixture(request);
  const periods = (
    await api<{ items: Period[] }>(request, f.headers, '/api/fiscal_period?orderBy=startDate:asc&limit=500')
  ).items;
  const expectedDefault = periods.find((p) => !p.isClosed && p.endDate < BUSINESS_DATE);
  if (!expectedDefault) throw new Error('fixture periods missing');
  await signInQuality(page, f.email, PASSWORD);
  await openScreen(page, '/finance/close');
  await expect(heading(page)).toHaveText(expectedDefault.code);
  await expect(page.getByTestId('close-state')).toHaveText('締められます');
  await page.getByRole('button', { name: 'この期間を締める', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${expectedDefault.code} を締めますか` });
  await dialog.getByRole('button', { name: '締める', exact: true }).click();
  await expect(page.getByText(`${expectedDefault.code} を締めました`)).toBeVisible();
  // The just-closed period stays on screen (it does not jump to the next default), with its guidance and reopen.
  await expect(page.getByTestId('close-state')).toHaveText('締め済み');
  await expect(heading(page)).toHaveText(expectedDefault.code);
  await expect(heading(page)).toBeFocused();
  await expect(page.getByTestId('close-closed-notice')).toContainText('訂正日');
  await expect(page.getByRole('button', { name: 'この期間を再開', exact: true })).toBeVisible();
  expect(periodInUrl(page)).toBe(expectedDefault.id);
  expect((await api<Period>(request, f.headers, '/api/fiscal_period/' + expectedDefault.id)).isClosed).toBe(true);
});

test('AC-12 a user without the close role who opens the URL gets an explanation', async ({ page, request }) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `close-sales-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', {
    name: '締め権限なし ' + suffix,
    email,
    password: PASSWORD,
  });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['sales'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await page.goto('/finance/close');
  await expect(
    page.getByRole('heading', { level: 1, name: '月次締めを使う権限がありません', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'ホームへ戻る', exact: true })).toHaveAttribute('href', '/');
});

test('AC-8 AC-13 a company without fiscal periods is told to open a fiscal year (synthetic responses)', async ({
  page,
}) => {
  // The list is empty and the check refuses with its reason, as accounting.close_readiness does for such a company
  // (apps/api/test/close-readiness.db.test.ts); real fixtures always have a fiscal year.
  await signInQuality(page);
  await page.route(
    (url) => url.pathname === '/api/fiscal_period',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) }),
  );
  await page.route(READINESS, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INVALID_STATE',
          message: 'no fiscal period exists yet',
          hint: 'Open a fiscal year with accounting.open_fiscal_year; its monthly periods appear here.',
          details: { reason: 'no_fiscal_period' },
        },
      }),
    }),
  );
  await page.goto('/finance/close');
  const empty = page.getByTestId('close-no-periods');
  await expect(empty.getByRole('heading', { level: 2, name: '会計年度がまだありません', exact: true })).toBeVisible();
  await expect(empty.getByRole('link', { name: '会計年度を開く', exact: true })).toHaveAttribute(
    'href',
    '/a/accounting.open_fiscal_year',
  );
  await expect(page.getByTestId('meta-error')).toHaveCount(0);
  await expect(page.getByLabel('会計期間', { exact: true })).toHaveCount(0);
});
