// Month-end close guide in the browser (docs/specs/close-guide.md AC-8..AC-13): period picker and default, blocking
// draft disables the close, report links carry the period, close through the kit dialog, closed state with reopen,
// the re-check right before closing, and the 390px layout. Data: a fresh synthetic company (commerceFixture).
import { expect, test, type Page } from '@playwright/test';
import { commerceFixture } from './commerce-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';
import { openScreen } from './navigation-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, signInQuality } from './quality-helpers.ts';

test.setTimeout(180_000);

type Period = Row & { code: string; startDate: string; endDate: string; isClosed: boolean };
const option = (p: Period) => `${p.code}（${p.startDate}〜${p.endDate}${p.isClosed ? '・締め済み' : ''}）`;
const item = (page: Page, id: string) => page.getByTestId(`close-item-${id}`);

test('AC-8..AC-13 close guide: a draft blocks the close; after submitting it the period closes and can be reopened', async ({
  page,
  request,
}) => {
  const f = await commerceFixture(request);
  const h = f.headers;
  const periods = (await api<{ items: Period[] }>(request, h, '/api/fiscal_period?orderBy=startDate:asc&limit=500'))
    .items;
  const target = periods.find((p) => p.code === f.period.month);
  const expectedDefault = periods.find((p) => !p.isClosed && p.endDate < BUSINESS_DATE);
  if (!target || !expectedDefault) throw new Error('fixture periods missing');
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
  // AC-12: reachable from the finance workspace search as a dedicated screen.
  await openScreen(page, '/finance/close');
  await expect(page.getByRole('heading', { level: 1, name: '月次締め', exact: true })).toBeVisible();
  const picker = page.getByLabel('会計期間', { exact: true });
  // AC-8: default is the oldest open period that ended before today.
  await expect(picker).toHaveValue(expectedDefault.id);
  await expect(page.getByTestId('close-status').getByRole('heading', { level: 2 })).toHaveText(expectedDefault.code);

  await picker.selectOption({ label: option(target) });
  await expect.poll(() => new URL(page.url()).searchParams.get('periodId')).toBe(target.id);
  await expect(page.getByTestId('close-status').getByRole('heading', { level: 2 })).toHaveText(target.code);

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
  await expect(page.getByTestId('close-status').getByRole('heading', { level: 2 })).toHaveText(target.code);

  // Submit the draft elsewhere, then re-check: nothing blocks any more.
  const current = await api(request, h, '/api/journal_entry/' + draft.id);
  await api(request, h, '/actions/journal_entry.submit', { id: draft.id, expectedVersion: current.version });
  await page.getByRole('button', { name: '再点検', exact: true }).click();
  await expect(page.getByTestId('close-state')).toHaveText('締められます');
  await expect(page.getByTestId('close-blocking-none')).toBeVisible();
  await expect(closeButton).toBeEnabled();

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
  await expect(page.getByTestId('close-status').getByRole('heading', { level: 2 })).toBeFocused();
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
