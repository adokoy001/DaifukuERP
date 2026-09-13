// Real API snapshots and a real browser Worker. Only the explicitly named revocation/report-table cases inject responses.
// Run against the standard isolated E2E fixture; no private files, production credentials or deployment data are required.
import { expect, test, type Page } from '@playwright/test';
import type { AnalyticsSnapshot } from '../src/api/analytics.ts';
import { BUSINESS_DATE } from './environment.ts';
import { api, login, type Headers, type Row } from './operations-helpers.ts';

const previous = new Date(`${BUSINESS_DATE.slice(0, 7)}-01T00:00:00Z`);
previous.setUTCMonth(previous.getUTCMonth() - 1);
const FROM = previous.toISOString().slice(0, 10);
const CURRENT = `${BUSINESS_DATE.slice(0, 7)}-01`;
let partnerName = '';

test.beforeAll(async ({ request }) => {
  const session = await api<{ token: string; user: { defaultCompanyId: string } }>(request, {}, '/auth/login', {
    email: process.env.E2E_EMAIL ?? 'admin@example.com',
    password: process.env.E2E_PASSWORD ?? 'password',
    ...(process.env.E2E_TENANT_ID ? { tenantId: process.env.E2E_TENANT_ID } : {}),
  });
  const headers: Headers = { authorization: `Bearer ${session.token}`, 'x-company-id': session.user.defaultCompanyId };
  const years = await api<{ items: Row[] }>(request, headers, '/api/fiscal_year?limit=500');
  for (const year of new Set([FROM.slice(0, 4), BUSINESS_DATE.slice(0, 4)]))
    if (!years.items.some((row) => row.startDate === `${year}-01-01`))
      await api(request, headers, '/actions/accounting.open_fiscal_year', { startDate: `${year}-01-01` });
  const run = crypto.randomUUID().slice(0, 8);
  for (let partnerIndex = 0; partnerIndex < 2; partnerIndex++) {
    const name = `分析E2E ${run} ${partnerIndex === 0 ? '東店' : '西店'}`;
    if (partnerIndex === 0) partnerName = name;
    const partner = await api(request, headers, '/api/partner', {
      code: `AN-${run}-${partnerIndex}`,
      name,
      isCustomer: true,
    });
    for (const [index, date] of [FROM, CURRENT].entries()) {
      const invoice = await api(request, headers, '/api/sales_invoice', {
        partnerId: partner.id,
        date,
        priceIncludesTax: false,
        lines: {
          sales_invoice_line: [
            {
              description: '分析用の合成サービス',
              quantity: '1',
              unitPrice: String(100 + partnerIndex * 400 + index * 200),
              taxCategory: 'exempt',
            },
          ],
        },
      });
      await api(request, headers, '/actions/sales_invoice.submit', {
        id: invoice.id,
        expectedVersion: invoice.version,
      });
    }
  }
});

async function snapshotAfter(page: Page, action: () => Promise<unknown>): Promise<AnalyticsSnapshot> {
  const pending = page.waitForResponse(
    (response) => response.url().endsWith('/analytics/snapshot') && response.request().method() === 'POST',
  );
  await action();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  const value = (await response.json()) as AnalyticsSnapshot;
  expect(value.meta.complete).toBe(true);
  expect(value.rows).toHaveLength(value.meta.rowCount);
  await expect(page.getByTestId('pivot-result')).toBeVisible();
  return value;
}
async function openAnalytics(page: Page) {
  await login(page);
  return snapshotAfter(page, () => page.goto('/analytics'));
}
async function ownPeriod(page: Page) {
  await page.getByLabel('開始日', { exact: true }).fill(FROM);
  await page.getByLabel('終了日', { exact: true }).fill(BUSINESS_DATE);
  return snapshotAfter(page, () =>
    page.getByRole('button', { name: '条件を適用・最新データで集計', exact: true }).click(),
  );
}
const grandAmount = (page: Page) => page.getByTestId('pivot-grand-total').locator('td').last();

test('実データとWorkerで初期表示し、対象・初期状態と日付条件の変更を反映する', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const snapshot = await openAnalytics(page);
  expect(snapshot.dataset).toBe('sales_invoice');
  expect(snapshot.meta.state).toBe('submitted');
  await expect(page.getByRole('combobox', { name: '期間', exact: true })).toHaveValue('12-months');
  await expect(page.getByLabel('開始日', { exact: true })).toHaveValue(/^\d{4}-\d{2}-01$/);
  await expect.poll(() => workers.some((url) => url.includes('pivot-worker'))).toBe(true);
  const changed = await snapshotAfter(page, () =>
    page.getByRole('combobox', { name: '集計対象', exact: true }).selectOption('workforce_expense'),
  );
  expect(changed.dataset).toBe('workforce_expense');
  expect(changed.meta.state).toBe('approved');
  await expect(page.getByRole('combobox', { name: '行 1', exact: true })).toHaveValue('siteId');
  await expect(page.getByRole('combobox', { name: '列 1', exact: true })).toHaveValue('expenseDate');
  await page.getByLabel('開始日', { exact: true }).fill('9999-12-31');
  await expect(page.getByRole('button', { name: '条件を適用・最新データで集計', exact: true })).toBeDisabled();
  await expect(page.getByTestId('pivot-result')).toHaveCount(0);
  await expect(page.getByText('取得条件が変わりました。', { exact: false })).toBeVisible();
  await ownPeriod(page);
  await expect(page.getByRole('button', { name: '条件を適用・最新データで集計', exact: true })).toBeEnabled();
});

test('行列の階層・軸反転・平均指標・グラフを操作しても実レコードの総計が整合する', async ({ page }, testInfo) => {
  await openAnalytics(page);
  await ownPeriod(page);
  const total = await grandAmount(page).textContent();
  await page.getByRole('button', { name: '階層を展開', exact: true }).click();
  await expect(page.getByTestId('pivot-result').locator('tbody tr')).toHaveCount(
    FROM.slice(0, 4) === BUSINESS_DATE.slice(0, 4) ? 3 : 4,
  );
  await expect(grandAmount(page)).toHaveText(total ?? '');
  await page.getByRole('button', { name: '行と列を入れ替え', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '列 2', exact: true })).toHaveValue('date');
  await expect(grandAmount(page)).toHaveText(total ?? '');
  await page.getByRole('button', { name: '階層を展開', exact: true }).click();
  await expect(page.getByTestId('pivot-result').locator('thead tr').first().locator('th')).toHaveCount(
    FROM.slice(0, 4) === BUSINESS_DATE.slice(0, 4) ? 5 : 6,
  );
  await expect(grandAmount(page)).toHaveText(total ?? '');
  await page.getByRole('button', { name: '行と列を入れ替え', exact: true }).click();
  await page.getByRole('combobox', { name: '行 1', exact: true }).selectOption('partnerId');
  await page.getByRole('button', { name: '＋ 指標を追加', exact: true }).click();
  await page.getByRole('combobox', { name: '集計方法 2', exact: true }).selectOption('avg');
  const partnerRow = page.getByTestId('pivot-result').locator('tbody tr').filter({ hasText: partnerName });
  await expect(partnerRow).toHaveCount(1);
  await expect(partnerRow.locator('td')).toHaveText(['400', '200']);
  await page.getByRole('combobox', { name: 'グラフ', exact: true }).selectOption('bar');
  await expect(page.locator('.analytics-chart svg rect').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.analytics-hero').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-desktop-top.png'), fullPage: true });
  await page.locator('.analytics-output-header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-desktop-overview.png') });
  await page.locator('.analytics-chart').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-desktop-chart.png') });
  await page.locator('.analytics-table-scroll thead').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-desktop-table.png') });
  await page.getByRole('combobox', { name: 'グラフ', exact: true }).selectOption('line');
  await expect(page.locator('.analytics-chart svg circle').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'グラフ', exact: true }).selectOption('none');
  await expect(page.locator('.analytics-chart')).toHaveCount(0);
  await expect(partnerRow.locator('td')).toHaveText(['400', '200']);
});

test('分析設定のみを保存・呼出し・別名保存・削除し、相対期間を保持する', async ({ page }) => {
  await openAnalytics(page);
  await page.getByRole('combobox', { name: '期間', exact: true }).selectOption('previous-month');
  await snapshotAfter(page, () =>
    page.getByRole('button', { name: '条件を適用・最新データで集計', exact: true }).click(),
  );
  const writes: string[] = [];
  page.on('request', (request) => {
    if (
      ['PUT', 'PATCH', 'DELETE'].includes(request.method()) ||
      (request.method() === 'POST' && !request.url().endsWith('/analytics/snapshot'))
    )
      writes.push(request.url());
  });
  await page.getByLabel('分析の名前', { exact: true }).fill('E2E 先月の比較');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('分析設定を保存しました。', { exact: true })).toBeVisible();
  const savedId = await page.getByRole('combobox', { name: '保存した分析', exact: true }).inputValue();
  const raw = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith('daifuku.analytics.v1.'))
      .map(([, value]) => JSON.parse(value) as { version: number; items: { settings: Record<string, unknown> }[] }),
  );
  expect(raw).toHaveLength(1);
  expect(raw[0]?.items).toHaveLength(1);
  expect(raw[0]?.items[0]?.settings.period).toBe('previous-month');
  expect(Object.keys(raw[0]?.items[0]?.settings ?? {}).sort()).toEqual(
    [
      'dataset',
      'period',
      'from',
      'to',
      'state',
      'pivot',
      'chart',
      'chartMeasure',
      'subtotals',
      'expandedRows',
      'expandedColumns',
    ].sort(),
  );
  await snapshotAfter(page, () => page.reload());
  await snapshotAfter(page, () =>
    page.getByRole('combobox', { name: '保存した分析', exact: true }).selectOption(savedId),
  );
  await expect(page.getByRole('combobox', { name: '期間', exact: true })).toHaveValue('previous-month');
  await page.getByLabel('分析の名前', { exact: true }).fill('E2E 先月の比較 コピー');
  await page.getByRole('button', { name: '別名で保存', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '保存した分析', exact: true }).locator('option')).toHaveCount(3);
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await snapshotAfter(page, () =>
    page.getByRole('combobox', { name: '保存した分析', exact: true }).selectOption(savedId),
  );
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '保存した分析', exact: true }).locator('option')).toHaveCount(1);
  expect(writes).toEqual([]);
});

test('同じ利用者の2タブで新規設定を保持し、古い設定の上書き・削除を防いで別名保存できる', async ({ page, context }) => {
  test.setTimeout(90_000);
  const second = await context.newPage();
  try {
    // Session credentials are tab-local; sign in independently while sharing the browser's scoped localStorage.
    await openAnalytics(page);
    await openAnalytics(second);
    await page.getByLabel('分析の名前', { exact: true }).fill('E2E タブAの分析');
    await second.getByLabel('分析の名前', { exact: true }).fill('E2E タブBの分析');
    await Promise.all([
      page.getByRole('button', { name: '保存', exact: true }).click(),
      second.getByRole('button', { name: '保存', exact: true }).click(),
    ]);
    for (const tab of [page, second]) {
      await expect(tab.getByText('分析設定を保存しました。', { exact: true })).toBeVisible();
      await expect(tab.getByRole('combobox', { name: '保存した分析', exact: true }).locator('option')).toHaveCount(3);
    }
    const idA = await page.getByRole('combobox', { name: '保存した分析', exact: true }).inputValue();
    await snapshotAfter(page, () =>
      page.getByRole('combobox', { name: '保存した分析', exact: true }).selectOption(idA),
    );
    await snapshotAfter(second, () =>
      second.getByRole('combobox', { name: '保存した分析', exact: true }).selectOption(idA),
    );
    await page.getByLabel('分析の名前', { exact: true }).fill('E2E タブAの最新分析');
    await page.getByRole('button', { name: '上書き保存', exact: true }).click();
    await expect(page.getByText('分析設定を保存しました。', { exact: true })).toBeVisible();
    // The other tab receives the new list without silently replacing the analysis currently being edited.
    await expect(
      second.getByRole('combobox', { name: '保存した分析', exact: true }).locator(`option[value="${idA}"]`),
    ).toHaveText('E2E タブAの最新分析');
    await expect(second.getByLabel('分析の名前', { exact: true })).toHaveValue('E2E タブAの分析');
    await second.getByLabel('分析の名前', { exact: true }).fill('E2E タブBの競合コピー');
    await second.getByRole('button', { name: '上書き保存', exact: true }).click();
    await expect(
      second.getByRole('alert').filter({ hasText: 'この分析は別のタブで変更または削除されています。' }),
    ).toBeVisible();
    await second.getByRole('button', { name: '削除', exact: true }).click();
    await expect(second.getByRole('button', { name: '削除', exact: true })).toBeEnabled();
    await expect(
      second.getByRole('alert').filter({ hasText: 'この分析は別のタブで変更または削除されています。' }),
    ).toBeVisible();
    const savedNames = () =>
      page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith('daifuku.analytics.v1.'))
          .flatMap(([, value]) => (JSON.parse(value) as { items: { name: string }[] }).items.map((item) => item.name))
          .sort(),
      );
    await expect.poll(savedNames).toEqual(['E2E タブAの最新分析', 'E2E タブBの分析'].sort());
    await second.getByRole('button', { name: '別名で保存', exact: true }).click();
    await expect(second.getByText('分析設定を保存しました。', { exact: true })).toBeVisible();
    await expect.poll(savedNames).toEqual(['E2E タブAの最新分析', 'E2E タブBの分析', 'E2E タブBの競合コピー'].sort());
    await expect(page.getByRole('combobox', { name: '保存した分析', exact: true }).locator('option')).toHaveCount(4);
  } finally {
    await second.close();
  }
});

test('390px幅で操作でき、カタログ権限失効の障害注入で保持中の分析結果を消す', async ({ page }, testInfo) => {
  await page.clock.install();
  await openAnalytics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '階層を展開', exact: true }).click();
  await expect(page.getByTestId('pivot-result')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.analytics-hero').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-mobile-top.png'), fullPage: true });
  await page.locator('.analytics-source-grid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-mobile-filters.png') });
  await page.locator('.analytics-output-header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-mobile-overview.png') });
  await page.locator('.analytics-chart').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-mobile-chart.png') });
  await page.locator('.analytics-table-scroll thead').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('analytics-mobile-table.png') });
  // Explicit fault injection: simulate server catalog permission revocation while a successful snapshot is on screen.
  await page.route('**/analytics/catalog', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PERMISSION_DENIED',
          message: 'E2E simulated catalog revocation',
          hint: 'Access revoked for this test.',
        },
      }),
    }),
  );
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('alert').filter({ hasText: 'E2E simulated catalog revocation' })).toBeVisible();
  await expect(page.getByTestId('pivot-result')).toHaveCount(0);
});

test('実際の試算表と期間初期値を確認し、合成レスポンスで帳票の検索・並替え・ページングを検証する', async ({ page }) => {
  await login(page);
  await page.goto('/r/accounting.trial_balance');
  const form = page.getByTestId('report-form');
  await expect(form.getByLabel('開始日', { exact: true })).toHaveValue(/^\d{4}-\d{2}-01$/);
  await form.getByRole('button', { name: '今月', exact: true }).click();
  const live = page.waitForResponse(
    (response) =>
      response.url().endsWith('/actions/accounting.trial_balance') && response.request().method() === 'POST',
  );
  await form.getByRole('button', { name: '実行', exact: true }).click();
  const liveResponse = await live;
  expect(liveResponse.ok(), await liveResponse.text()).toBe(true);
  await expect(page.getByTestId('report-result')).toBeVisible();
  await expect(page.getByTestId('report-title')).toContainText('試算表');
  // Explicit synthetic response isolates browsing UX from the number of accounts in a fresh fixture.
  await page.route('**/actions/accounting.trial_balance', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        title: { ja: '合成帳票・ページング検証', en: 'Synthetic report paging fixture' },
        columns: [
          { key: 'name', label: { ja: '名称', en: 'Name' }, kind: 'text' },
          { key: 'amount', label: { ja: '金額', en: 'Amount' }, kind: 'decimal' },
        ],
        rows: Array.from({ length: 120 }, (_, i) => ({
          name: `合成行${String(i + 1).padStart(3, '0')}`,
          amount: String(i + 1),
        })),
        totals: { amount: '7260' },
      }),
    }),
  );
  await form.getByRole('button', { name: '実行', exact: true }).click();
  await expect(page.getByTestId('report-title')).toHaveText('合成帳票・ページング検証');
  await expect(page.getByTestId('report-row')).toHaveCount(50);
  await page
    .getByRole('navigation', { name: '帳票結果のページ移動' })
    .getByRole('button', { name: '次へ', exact: true })
    .click();
  await expect(page.getByTestId('report-row').first()).toContainText('合成行051');
  await expect(page.locator('[data-total="amount"]')).toHaveText('7,260');
  await page.getByRole('combobox', { name: '1ページの行数', exact: true }).selectOption('25');
  await expect(page.getByTestId('report-row')).toHaveCount(25);
  await page.getByLabel('結果内を検索', { exact: true }).fill('合成行099');
  await expect(page.getByTestId('report-row')).toHaveCount(1);
  await expect(page.getByTestId('report-row')).toContainText('合成行099');
  await expect(page.locator('[data-total="amount"]')).toHaveText('7,260');
  await page.getByLabel('結果内を検索', { exact: true }).fill('');
  await page.getByRole('button', { name: /^金額/ }).click();
  await page.getByRole('button', { name: /^金額/ }).click();
  await expect(page.getByTestId('report-row').first()).toContainText('合成行120');
  await expect(page.locator('[data-total="amount"]')).toHaveText('7,260');
});
