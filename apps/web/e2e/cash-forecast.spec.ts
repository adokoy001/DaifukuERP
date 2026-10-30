// Cash forecast in the browser (docs/specs/cash-forecast.md AC-20..AC-27, AC-11, AC-14, AC-16, AC-17, AC-29, AC-30):
// screen search, default period, summary and warning, chart, daily table and schedule with links and badges, changing
// conditions (URL replaced, stale notice, drafts, overdue), validation before sending, CSV for admin, guidance from a
// substituted response, the failure view, a user without access, English, 390px and axe. Data: a fresh synthetic
// company (commerceFixture) with invoices created through the API.
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { commerceFixture } from './commerce-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { api, PASSWORD, type Headers, type Row } from './operations-helpers.ts';
import { assertNoOverflow, failedRead, qualitySession, signInQuality } from './quality-helpers.ts';

test.setTimeout(240_000);

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

const FORECAST = '**/actions/banking.cash_forecast';
const SCHEDULE = '**/actions/banking.cash_schedule';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = BUSINESS_DATE;
const SALES_DUE = addDays(TODAY, 5);
const DRAFT_DUE = addDays(TODAY, 7);
const BILL_DUE = addDays(TODAY, 10);

async function invoice(
  request: APIRequestContext,
  headers: Headers,
  side: 'sales' | 'purchase',
  partnerId: string,
  expenseAccount: string,
  amount: string,
  dates: { date: string; dueDate: string },
  submit = true,
): Promise<Row> {
  const entity = side === 'sales' ? 'sales_invoice' : 'purchase_invoice';
  const created = await api(request, headers, `/api/${entity}`, {
    partnerId,
    ...dates,
    lines: {
      [`${entity}_line`]: [
        {
          ...(side === 'purchase' ? { accountId: expenseAccount } : {}),
          description: '資金繰り画面の検証',
          unitPrice: amount,
          taxCategory: 'exempt',
        },
      ],
    },
  });
  if (!submit) return created;
  return api(request, headers, `/actions/${entity}.submit`, { id: created.id, expectedVersion: created.version });
}

/** A company with ledger 1,000 (fixture), a receipt due in 5 days, a bill due in 10 days, an overdue receivable and a draft. */
async function cashFixture(request: APIRequestContext) {
  const f = await commerceFixture(request);
  const partner = await api(request, f.headers, '/api/partner', {
    name: '資金繰り取引先 ' + f.runId,
    isCustomer: true,
    isSupplier: true,
  });
  const expense = f.accounts['5000'] ?? '';
  const sales = await invoice(request, f.headers, 'sales', partner.id, expense, '300000', {
    date: TODAY,
    dueDate: SALES_DUE,
  });
  const bill = await invoice(request, f.headers, 'purchase', partner.id, expense, '450000', {
    date: TODAY,
    dueDate: BILL_DUE,
  });
  const overdue = await invoice(request, f.headers, 'sales', partner.id, expense, '50000', {
    date: addDays(TODAY, -20),
    dueDate: addDays(TODAY, -3),
  });
  await invoice(request, f.headers, 'sales', partner.id, expense, '80000', { date: TODAY, dueDate: DRAFT_DUE }, false);
  return { ...f, partner, sales, bill, overdue };
}

const summary = (page: Page, id: string) => page.getByTestId(`cash-${id}`);

test('AC-20..AC-24 cash forecast: default period, summary, warning, chart, daily table and schedule; conditions replace the URL', async ({
  page,
  request,
}) => {
  const f = await cashFixture(request);
  await signInQuality(page, f.email, PASSWORD);
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/actions/banking.cash_forecast')) calls.push(r.postData() ?? '');
  });
  // AC-26: a dedicated finance screen in the screen search.
  await openScreen(page, '/finance/cash-forecast');
  await expect(page.getByRole('heading', { level: 1, name: '資金繰り表', exact: true })).toBeVisible();
  // AC-20: today .. today + 89 by default, run once.
  await expect(page.getByLabel('開始日', { exact: true })).toHaveValue(TODAY);
  await expect(page.getByLabel('終了日', { exact: true })).toHaveValue(addDays(TODAY, 89));
  await expect(page.getByTestId('cash-result')).toBeVisible();
  expect(calls.map((c) => JSON.parse(c))).toContainEqual({ from: TODAY, to: addDays(TODAY, 89) });
  await expect(summary(page, 'opening')).toHaveText('1,000');
  await expect(summary(page, 'inflow')).toHaveText('300,000');
  await expect(summary(page, 'outflow')).toHaveText('450,000');
  await expect(summary(page, 'closing')).toHaveText('-149,000');
  await expect(summary(page, 'min')).toContainText(BILL_DUE);
  // AC-22: warning (not a live region).
  const warning = page.getByTestId('cash-warning');
  await expect(warning).toHaveText(`残高がマイナスになる日があります（最初の日 ${BILL_DUE}、最低残高 -¥149,000）`);
  await expect(warning).not.toHaveAttribute('role', /.+/);
  // AC-25: overdue guidance.
  await expect(page.getByTestId('cash-notice-overdue')).toContainText('期日を過ぎた予定が 1 件（入金 ¥50,000');
  // AC-21: chart with a summary label.
  await expect(
    page.getByRole('img', { name: /期首残高 ¥1,000、期末残高 -¥149,000、最低残高 -¥149,000/ }),
  ).toBeVisible();
  // AC-23: the daily table hides quiet days by default.
  const daily = page.getByRole('tabpanel', { name: '日別の表' });
  await expect(daily.getByTestId('report-row')).toHaveCount(2);
  await expect(daily.getByTestId('report-table').getByRole('columnheader')).toContainText([
    '日付',
    '記帳済み入金',
    '記帳済み出金',
    '入金予定（売上請求）',
  ]);
  await daily.getByLabel('動きのない日を隠す', { exact: true }).uncheck();
  await expect(daily.getByTestId('report-visible-count')).toContainText('受信 90 行');
  await expect(daily.getByTestId('report-totals')).toContainText('-149,000');
  // AC-24: schedule with labels, badges and document links.
  await page.getByRole('tab', { name: /入出金予定/ }).click();
  const rows = page.getByTestId('cash-schedule-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(SALES_DUE);
  await expect(rows.nth(0)).toContainText('売上請求');
  await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', `/e/sales_invoice/${f.sales.id}`);
  await expect(rows.nth(1)).toContainText('仕入請求');
  await expect(rows.nth(1)).toContainText('出金');
  await expect(rows.nth(2)).toContainText('期日超過');
  await expect(rows.nth(2)).toContainText('残高に含めない');

  // AC-20 / AC-11: change a condition — stale notice and disabled CSV, then Show replaces the URL.
  const historyLength = await page.evaluate(() => history.length);
  await page.getByLabel('下書きを表示', { exact: true }).check();
  await expect(page.getByTestId('cash-stale')).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV ダウンロード' }).first()).toBeDisabled();
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('drafts')).toBe('1');
  await expect(page.getByTestId('cash-stale')).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.getByRole('tab', { name: /入出金予定/ }).click();
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('cash-schedule-table')).toContainText('下書き');
  await expect(summary(page, 'closing')).toHaveText('-149,000');
  await page.getByRole('tab', { name: '日別の表' }).click();
  await expect(page.getByTestId('report-table').getByRole('columnheader', { name: /下書きを含む残高/ })).toBeVisible();
  await expect(page.getByTestId('cash-column-legend')).toContainText('下書き（残高に含めない）');
  // AC-10: overdue on today changes the balance and the guidance.
  await page.getByLabel('期日超過を今日に含める', { exact: true }).check();
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await expect(summary(page, 'closing')).toHaveText('-99,000');
  await expect(page.getByTestId('cash-notice-overdue')).toContainText('今日の日付に含めています');

  // AC-17 / AC-20: invalid ranges are refused before sending.
  const before = calls.length;
  await page.getByLabel('開始日', { exact: true }).fill(addDays(TODAY, 30));
  await page.getByLabel('終了日', { exact: true }).fill(addDays(TODAY, 1));
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await expect(page.getByTestId('cash-to-error')).toHaveText('終了日は開始日以後にしてください。');
  await expect(page.getByLabel('終了日', { exact: true })).toBeFocused();
  await page.getByLabel('終了日', { exact: true }).fill(addDays(TODAY, 800));
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await expect(page.getByTestId('cash-to-error')).toContainText('期間は366日以内');
  expect(calls.length).toBe(before);
  // AC-20: a quick range fills the dates; Show runs it.
  await page.getByRole('button', { name: '来月', exact: true }).click();
  await page.getByRole('button', { name: '表示', exact: true }).click();
  const nextMonth = addDays(`${TODAY.slice(0, 7)}-28`, 4).slice(0, 7);
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe(`${nextMonth}-01`);
  await expect(page.getByTestId('cash-result-title')).toContainText(`${nextMonth}-01〜`);
});

test('AC-16 AC-14 AC-25 AC-29 AC-30 cash forecast: admin CSV, guidance from a substituted response, failure view', async ({
  page,
  request,
}) => {
  const f = await cashFixture(request);
  await signInQuality(page, f.email, PASSWORD);
  await page.goto('/finance/cash-forecast');
  await expect(page.getByTestId('cash-result')).toBeVisible();
  // AC-16: admin can export; the CSV re-runs the action through the export path.
  const exported = page.waitForResponse((r) => r.url().endsWith('/actions/banking.cash_forecast/export'));
  const download = page.waitForEvent('download');
  await page.getByRole('tabpanel', { name: '日別の表' }).getByRole('button', { name: 'CSV ダウンロード' }).click();
  expect((await exported).ok()).toBe(true);
  expect((await download).suggestedFilename()).toMatch(/^banking_cash_forecast_\d{14}\.csv$/);

  // AC-14 / AC-25 / AC-29 / AC-30: a response without payroll and with notes shows the guidance.
  await page.route(FORECAST, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { meta: Record<string, unknown>; columns: { key: string }[] };
    body.meta.sources = (body.meta.sources as { source: string }[]).map((s) =>
      s.source === 'payroll' ? { source: 'payroll', included: false, reason: 'permission' } : s,
    );
    body.meta.notices = [];
    delete body.meta.unscheduledPayroll;
    body.columns = body.columns.filter((c) => c.key !== 'payroll');
    body.meta.unallocated = { receive: { count: 1, amount: '12000' }, pay: { count: 0, amount: '0' } };
    body.meta.uncountedPaymentAccounts = [
      { accountId: f.accounts['1900'], code: '1110', name: '当座預金', count: 2, receive: '0', pay: '7000' },
    ];
    body.meta.contractBacklog = { count: 3, subtotal: '90000' };
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.getByTestId('cash-notice-source-payroll')).toHaveText(
    '給与は閲覧・出力の権限がないため含めていません。',
  );
  await expect(page.getByTestId('cash-notice-unallocated')).toContainText('入金 1 件 ¥12,000');
  await expect(page.getByTestId('cash-notice-uncounted-accounts')).toContainText('1110 当座預金（2 件');
  await expect(page.getByTestId('cash-notice-uncounted-accounts').getByRole('link')).toHaveAttribute(
    'href',
    '/finance/banking',
  );
  await expect(page.getByTestId('cash-notice-contract-backlog')).toContainText('3 件（税抜 ¥90,000）');
  await page.unroute(FORECAST);

  // AC-20: a failed read shows the error with retry, never an empty result.
  await page.route(SCHEDULE, (route) => route.fulfill(failedRead()));
  await page.reload();
  await expect(page.getByTestId('meta-error')).toBeVisible();
  await expect(page.getByTestId('cash-empty')).toHaveCount(0);
  await page.unroute(SCHEDULE);
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByTestId('cash-result')).toBeVisible();
});

test('AC-26 cash forecast: a user without accounting gets no entry, and a direct URL explains without calling the action', async ({
  page,
  request,
}) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `cash-sales-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `営業 ${suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['sales'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await findScreen(page, '/finance/cash-forecast');
  await expect(page.locator('main a[data-screen-href="/finance/cash-forecast"]')).toHaveCount(0);
  let called = false;
  page.on('request', (r) => {
    if (r.url().includes('/actions/banking.cash_')) called = true;
  });
  await page.goto('/finance/cash-forecast');
  await expect(page.getByTestId('cash-no-access')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '資金繰り表を使う権限がありません' })).toBeVisible();
  expect(called).toBe(false);
});

test('AC-27 cash forecast: English, 390px without horizontal scroll, and axe finds no serious issue', async ({
  page,
  request,
}) => {
  const f = await cashFixture(request);
  await signInQuality(page, f.email, PASSWORD);
  for (const locale of ['ja', 'en'] as const)
    for (const width of [1280, 390] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => localStorage.setItem('daifuku.locale', value), locale);
      await page.goto('/finance/cash-forecast?drafts=1');
      await expect(page.getByTestId('cash-result')).toBeVisible();
      await expect(page.getByTestId('cash-chart')).toBeVisible();
      if (locale === 'en') {
        await expect(page.getByRole('heading', { name: 'Cash forecast', level: 1 })).toBeVisible();
        await expect(page.getByTestId('cash-warning')).toContainText('The balance goes below zero');
      }
      if (width === 390) {
        await assertNoOverflow(page);
        await page.getByRole('tab', { name: locale === 'ja' ? /入出金予定/ : /Schedule/ }).click();
        await assertNoOverflow(page);
        await page.screenshot({ path: test.info().outputPath(`cash-forecast-${locale}-390.png`), fullPage: true });
      }
      const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
      const run: A11yRun = { screen: 'cash-forecast', locale, width };
      const judgement = judge(results.violations, exceptions, run, results.incomplete);
      expect(judgement.failures, formatJudgement(run, judgement)).toEqual([]);
    }
});
