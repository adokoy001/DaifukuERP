// list-workbench (docs/specs/list-workbench.md): filters in the URL, the close-guide link contract, columns and saved
// views, page totals, CSV export through the fresh export authorization, and bulk submit with per-row results.
// Synthetic journal entries in the fixture's default company, isolated per test by a unique description (`?q=`).
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BUSINESS_DATE, nextDate } from './environment.ts';
import { API, api, PASSWORD, type Headers, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

interface Journal {
  headers: Headers;
  companyId: string;
  runId: string;
  draft: (
    label: string,
    opts?: { date?: string; debit?: string; credit?: string; description?: string },
  ) => Promise<Row>;
  submitted: (label: string, amount?: string) => Promise<Row>;
}

async function journal(request: APIRequestContext): Promise<Journal> {
  const { headers, companyId } = await qualitySession(request);
  const runId = 'LW' + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const accounts = await api<{ items: Row[] }>(request, headers, '/api/account?limit=500');
  const cash = accounts.items.find((a) => a.code === '1000');
  const capital = accounts.items.find((a) => a.code === '3000');
  if (!cash || !capital) throw new Error('the fixture company needs accounts 1000 and 3000');
  const draft: Journal['draft'] = (label, opts = {}) =>
    api(request, headers, '/api/journal_entry', {
      date: opts.date ?? BUSINESS_DATE,
      description: opts.description ?? `一覧検証 ${runId} ${label}`,
      lines: {
        journal_line: [
          { accountId: cash.id, debit: opts.debit ?? '1000' },
          { accountId: capital.id, credit: opts.credit ?? opts.debit ?? '1000' },
        ],
      },
    });
  const submitted: Journal['submitted'] = async (label, amount = '1000') => {
    const row = await draft(label, { debit: amount });
    return api(request, headers, `/api/journal_entry/${row.id}/submit`, { expectedVersion: row.version });
  };
  return { headers, companyId, runId, draft, submitted };
}

const rows = (page: Page) => page.getByTestId('row');
const chips = (page: Page) => page.getByTestId('filter-chips');
const headerTexts = (page: Page) =>
  page
    .locator('.ui-table thead th')
    .evaluateAll((ths) => ths.map((th) => (th.textContent ?? '').replace(/[↕↑↓]/g, '').trim()));

async function openList(page: Page, query: string) {
  await page.goto('/e/journal_entry' + query);
  await expect(page.getByRole('heading', { name: '仕訳', level: 1 })).toBeVisible();
}

test('list-workbench AC-1/AC-2/AC-3/AC-12: filters live in the URL, survive reload and back, and read the close-guide link', async ({
  page,
  request,
}) => {
  const j = await journal(request);
  await j.draft('A');
  await j.draft('B');
  await j.draft('C', { date: nextDate(BUSINESS_DATE) });
  await j.submitted('D');
  await signInQuality(page);
  await openList(page, `?q=${j.runId}`);
  await expect(rows(page)).toHaveCount(4);

  // AC-1/AC-2: state + business date from the meta-driven panel, applied as `?f=` and sent as REST `where`.
  await page.getByTestId('filters-toggle').click();
  const panel = page.locator('.list-filter-panel');
  await expect(panel.locator('[data-filter="docstatus"]')).toBeVisible();
  await expect(panel.locator('[data-filter="date"]')).toBeVisible();
  await panel.locator('[data-filter="docstatus"]').getByLabel('下書き', { exact: true }).check();
  await panel.locator('[data-filter="date"]').getByLabel('開始', { exact: true }).fill(BUSINESS_DATE);
  await panel.locator('[data-filter="date"]').getByLabel('終了', { exact: true }).fill(BUSINESS_DATE);
  const filtered = page.waitForRequest((r) => r.url().includes('/api/journal_entry?') && r.url().includes('where='));
  await panel.getByRole('button', { name: '絞り込む', exact: true }).click();
  const where = JSON.parse(new URL((await filtered).url()).searchParams.get('where') ?? '{}') as unknown;
  expect(where).toEqual({ docstatus: { $in: [0] }, date: { $gte: BUSINESS_DATE, $lte: BUSINESS_DATE } });
  await expect(page).toHaveURL(/[?&]f=/);
  await expect(rows(page)).toHaveCount(2);
  await expect(chips(page)).toContainText('状態: 下書き');
  await expect(chips(page)).toContainText(`日付: ${BUSINESS_DATE} – ${BUSINESS_DATE}`);
  await expect(page.getByTestId('filters-toggle')).toHaveText('絞り込み（2）');

  // AC-2: reload and the back button restore the same criteria.
  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  await expect(chips(page)).toContainText('状態: 下書き');
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]f=/);
  await expect(rows(page)).toHaveCount(4);
  await expect(chips(page)).toHaveCount(0);

  // AC-3: the close guide's `?status=draft&from=&to=` link.
  await openList(page, `?q=${j.runId}&status=draft&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`);
  await expect(rows(page)).toHaveCount(2);
  await expect(chips(page)).toContainText('状態: 下書き');
  // Removing one chip rewrites the link parameters into `f`.
  await chips(page)
    .getByRole('button', { name: /^絞り込みを外す: 状態/ })
    .click();
  await expect(page).not.toHaveURL(/[?&]status=/);
  await expect(page).toHaveURL(/[?&]f=/);
  await expect(rows(page)).toHaveCount(3);

  // AC-2: an invalid condition in a shared URL is ignored, not an error.
  await openList(page, `?q=${j.runId}&f=${encodeURIComponent('{"docstatus":[9],"date":{"from":"2026-02-30"}}')}`);
  await expect(rows(page)).toHaveCount(4);
  await expect(chips(page)).toHaveCount(0);

  // Nothing matches: the empty state names the filters and clears them (focus stays useful).
  await openList(page, `?q=${j.runId}&f=${encodeURIComponent('{"docstatus":[2]}')}`);
  const empty = page.getByTestId('empty-state');
  await expect(empty).toContainText('検索条件に一致する記録はありません');
  await expect(empty).toContainText('絞り込み 1 件');
  await empty.getByRole('button', { name: '絞り込みをクリア', exact: true }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByRole('searchbox', { name: '検索' })).toBeFocused();

  // AC-12: at 390px the filters start folded and still work; the page does not scroll sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await openList(page, `?q=${j.runId}`);
  await expect(page.locator('.list-filter-panel')).toHaveCount(0);
  await expect(page.getByTestId('filters-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('filters-toggle').click();
  await expect(page.getByTestId('filters-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.list-filter-panel [data-filter="docstatus"]').getByLabel('確定', { exact: true }).check();
  await page.locator('.list-filter-panel').getByRole('button', { name: '絞り込む', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('list-filters-390.png'), fullPage: true });
});

test('list-workbench AC-4/AC-5/AC-6: columns and saved views persist per user and company; page totals use decimals', async ({
  page,
  request,
}) => {
  const j = await journal(request);
  await j.submitted('合計1', '1000');
  await j.submitted('合計2', '2500');
  await signInQuality(page);
  await openList(page, `?q=${j.runId}`);
  await expect(rows(page)).toHaveCount(2);

  // AC-6: totals of the money columns on this page, labelled as page totals.
  const totals = page.getByTestId('page-totals');
  await expect(totals).toContainText('このページの合計（表示中の 2 件）');
  await expect(totals.locator('[data-total="totalDebit"]')).toContainText('3,500');
  await expect(totals.locator('[data-total="totalCredit"]')).toContainText('3,500');

  // AC-4: choose and order columns; stored in this browser; "reset" returns to views.list.
  const defaults = await headerTexts(page);
  expect(defaults).toEqual(['', '番号', '状態', '日付', '摘要', '借方合計', '貸方合計', '起票元エンティティ']);
  await page.getByRole('button', { name: '列', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '表示する列' });
  await dialog.getByLabel('起票元エンティティ', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: '上へ: 摘要', exact: true }).click();
  await dialog.getByRole('button', { name: '適用', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const chosen = ['', '番号', '状態', '摘要', '日付', '借方合計', '貸方合計'];
  await expect.poll(() => headerTexts(page)).toEqual(chosen);
  await page.reload();
  await expect.poll(() => headerTexts(page)).toEqual(chosen);

  // AC-5: save the current criteria and columns under a name, reopen them from a plain list, delete them.
  await page.getByTestId('filters-toggle').click();
  await page.locator('.list-filter-panel [data-filter="docstatus"]').getByLabel('確定', { exact: true }).check();
  await page.locator('.list-filter-panel').getByRole('button', { name: '絞り込む', exact: true }).click();
  await expect(page).toHaveURL(/[?&]f=/);
  await page.getByRole('button', { name: '保存ビュー', exact: true }).click();
  const views = page.getByRole('dialog', { name: '保存ビュー' });
  const viewName = `確定済み ${j.runId}`;
  await views.getByLabel('ビューの名前', { exact: true }).fill(viewName);
  await views.getByRole('button', { name: '現在の条件を保存', exact: true }).click();
  await expect(views.locator(`[data-view="${viewName}"]`)).toBeVisible();
  await views.getByRole('button', { name: '閉じる', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '保存ビュー（1）', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '列', exact: true }).click();
  await page
    .getByRole('dialog', { name: '表示する列' })
    .getByRole('button', { name: '既定に戻す', exact: true })
    .click();
  await expect.poll(() => headerTexts(page)).toEqual(defaults);

  await openList(page, '');
  await page.getByRole('button', { name: '保存ビュー（1）', exact: true }).click();
  await page
    .getByRole('dialog', { name: '保存ビュー' })
    .getByRole('button', { name: `呼び出す: ${viewName}`, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`[?&]q=${j.runId}`));
  await expect(page).toHaveURL(/[?&]f=/);
  await expect(rows(page)).toHaveCount(2);
  await expect(chips(page)).toContainText('状態: 確定');
  await expect.poll(() => headerTexts(page)).toEqual(chosen);
  await page.getByRole('button', { name: '保存ビュー（1）', exact: true }).click();
  await page
    .getByRole('dialog', { name: '保存ビュー' })
    .getByRole('button', { name: `削除: ${viewName}`, exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '保存ビュー' })).toContainText('保存したビューはまだありません。');
});

test('list-workbench AC-7/AC-8: CSV export re-reads the criteria with export permission; viewers get no export', async ({
  page,
  request,
}) => {
  const j = await journal(request);
  await j.submitted('通常');
  await j.draft('式', { description: `=1+1 ${j.runId}` });
  await signInQuality(page);
  await openList(page, `?q=${j.runId}`);
  await expect(rows(page)).toHaveCount(2);
  const exportRequest = page.waitForRequest((r) => r.url().endsWith('/actions/journal_entry.export_rows/export'));
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('list-export').click();
  const body = (await exportRequest).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({
    search: j.runId,
    columns: ['number', 'docstatus', 'date', 'description', 'totalDebit', 'totalCredit', 'sourceEntity'],
    locale: 'ja',
  });
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^journal_entry_\d{14}\.csv$/);
  const csv = readFileSync((await file.path()) ?? '', 'utf8');
  expect(csv.startsWith('\uFEFF番号,状態,日付,摘要,借方合計,貸方合計,起票元エンティティ\r\n')).toBe(true);
  expect(csv).toMatch(new RegExp(`\r\nJE-[^,]+,確定,${BUSINESS_DATE},一覧検証 ${j.runId} 通常,1000,1000,\r\n`));
  // A formula-like cell is neutralised for spreadsheets.
  expect(csv).toContain(`,下書き,${BUSINESS_DATE},'=1+1 ${j.runId},`);
  expect(csv).not.toMatch(/(^|,)=1\+1/m);
  await expect(page.getByText('2 件の CSV を作成しました')).toBeVisible();

  // AC-8: a viewer (read without export) sees no CSV export and the API refuses it.
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `list-viewer-${suffix}@example.com`;
  const user = await api(request, j.headers, '/admin/users', { name: '一覧閲覧 ' + suffix, email, password: PASSWORD });
  await api(
    request,
    j.headers,
    `/admin/users/${user.id}/companies/${j.companyId}`,
    { expectedVersion: 0, roles: ['viewer'], accessScope: 'all', siteIds: [], storeIds: [] },
    'PUT',
  );
  const viewer = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  const denied = await request.fetch(API + '/actions/journal_entry.export_rows/export', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + viewer.token, 'x-company-id': j.companyId },
    data: {},
  });
  expect(denied.status()).toBe(403);
  await page.context().clearCookies();
  await page.evaluate(() => globalThis.sessionStorage.clear());
  await signInQuality(page, email, PASSWORD);
  await openList(page, `?q=${j.runId}`);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId('list-export')).toHaveCount(0);
  // Read-only users get no bulk selection either.
  await expect(page.locator('.ui-row-check')).toHaveCount(0);
});

test('list-workbench AC-10/AC-11: bulk submit reports each row, keeps successes and blocks a second run', async ({
  page,
  request,
}) => {
  const j = await journal(request);
  const a = await j.draft('一括A');
  const b = await j.draft('一括B');
  const c = await j.draft('一括C不一致', { debit: '1000', credit: '900' });
  const d = await j.submitted('一括D済');
  await signInQuality(page);
  await openList(page, `?q=${j.runId}&sort=createdAt:asc`);
  await expect(rows(page)).toHaveCount(4);

  await page.getByLabel('このページの行をすべて選択', { exact: true }).check();
  const bar = page.getByTestId('bulk-bar');
  await expect(bar.getByTestId('bulk-count')).toHaveText('4 件を選択中（1 回 100 件まで）');
  await expect(bar.getByTestId('bulk-ineligible')).toContainText('確定: 1 件は下書きでないため対象外');
  await expect(bar.getByRole('button', { name: '確定（3）', exact: true })).toBeEnabled();

  // Hold the first row's submit so the run is observably in progress.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  const sent: { id: string; body: unknown }[] = [];
  await page.route('**/api/journal_entry/*/submit', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    sent.push({ id, body: route.request().postDataJSON() });
    if (sent.length === 1) await held;
    await route.continue();
  });
  await bar.getByRole('button', { name: '確定（3）', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '3 件を確定' });
  await expect(confirm.getByTestId('bulk-targets')).toContainText(`一覧検証 ${j.runId} 一括A`);
  await expect(confirm.getByTestId('bulk-left-out')).toContainText('1 件は下書きでないため対象外');
  await confirm.getByRole('button', { name: '3 件を確定', exact: true }).click();
  const results = page.getByTestId('bulk-results');
  await expect(results.getByTestId('bulk-summary')).toContainText('実行中');
  // AC-11: while it runs, a new selection cannot start another run.
  await page.getByLabel(`選択: ${String(d.number)}`, { exact: true }).check();
  await expect(page.getByTestId('bulk-bar').getByRole('button', { name: /^取消/ })).toBeDisabled();
  release();
  await expect(results.getByTestId('bulk-summary')).toHaveText('成功 2 件・失敗 1 件');
  await expect(results.locator(`[data-id="${a.id}"]`)).toHaveAttribute('data-result', 'done');
  await expect(results.locator(`[data-id="${b.id}"]`)).toHaveAttribute('data-result', 'done');
  const failed = results.locator(`[data-id="${c.id}"]`);
  await expect(failed).toHaveAttribute('data-result', 'failed');
  await expect(failed.locator('.text-danger-text')).not.toBeEmpty();
  // AC-10: one call per row, in order, each with the version the list showed.
  expect(sent.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  expect(sent.map((s) => s.body)).toEqual([
    { expectedVersion: a.version },
    { expectedVersion: b.version },
    { expectedVersion: c.version },
  ]);
  // Successful rows stay submitted; the list was read again.
  for (const id of [a.id, b.id]) expect((await api(request, j.headers, `/api/journal_entry/${id}`)).docstatus).toBe(1);
  expect((await api(request, j.headers, `/api/journal_entry/${c.id}`)).docstatus).toBe(0);
  await expect(page.locator(`tr[data-id="${a.id}"] [data-testid="docstatus"]`)).toHaveText('確定');
  await expect(page.locator(`tr[data-id="${c.id}"] [data-testid="docstatus"]`)).toHaveText('下書き');
  await page.screenshot({ path: test.info().outputPath('list-bulk-results.png') });
  await page.unroute('**/api/journal_entry/*/submit');
});
