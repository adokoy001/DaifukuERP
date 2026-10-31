// Fixed assets in the browser (docs/specs/fixed-assets.md AC-32..AC-34, AC-35): register an asset through the generic
// form (labelled groups), preview on /finance/depreciation with the run blocked while the rules are unverified,
// record the confirmation in the settings, check the populated screen at 390px with axe (table, rules viewer open,
// confirm dialog), run (focus lands on the period heading), run again (nothing due), retire the asset; a viewer sees
// no run button; English, 390px and axe on an empty preview. Data: a fresh synthetic company (commerceFixture).
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { commerceFixture } from './commerce-helpers.ts';
import { openScreen } from './navigation-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

test.setTimeout(240_000);

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

const ACCOUNTS = [
  { code: '1910', name: '未収入金', type: 'asset' },
  { code: '1925', name: '工具器具備品', type: 'asset' },
  { code: '1929', name: '減価償却累計額', type: 'asset' },
  { code: '6700', name: '減価償却費', type: 'expense', taxCategoryDefault: 'out_of_scope' },
  { code: '8100', name: '固定資産売却益', type: 'revenue' },
  { code: '8200', name: '固定資産売却損', type: 'expense' },
  { code: '8300', name: '固定資産除却損', type: 'expense' },
];

async function axe(page: Page, run: A11yRun) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const judgement = judge(results.violations, exceptions, run, results.incomplete);
  expect(judgement.failures, formatJudgement(run, judgement)).toEqual([]);
}

test('fixed-assets AC-32..AC-35: register, preview blocked while unverified, confirm, run once, retire', async ({
  page,
  request,
}) => {
  const f = await commerceFixture(request);
  const h = f.headers;
  for (const account of ACCOUNTS) await api(request, h, '/api/account', account);
  const serviceDate = `${f.period.month}-01`;

  await signInQuality(page, f.email, PASSWORD);
  // AC-33: a dedicated finance screen found through the screen search.
  await openScreen(page, '/finance/depreciation');
  await expect(page.getByRole('heading', { level: 1, name: '償却の実行', exact: true })).toBeVisible();
  // AC-32: the default period (the last one that ended before today) is pinned in the URL.
  await expect.poll(() => new URL(page.url()).searchParams.get('periodId')).not.toBeNull();
  await expect(page.getByTestId('depreciation-status').getByRole('heading', { level: 2 })).toHaveText(f.period.month);
  await expect(page.getByTestId('depreciation-nothing')).toBeVisible();
  await expect(page.getByTestId('depreciation-rules-unverified')).toBeVisible();

  // AC-33: the generic form with labelled groups registers the asset (accounts filled from the settings).
  await page.goto('/e/fixed_asset/new');
  for (const group of ['基本', '償却', '勘定科目', '所在と申告', '移行'])
    await expect(
      page
        .getByRole('group', { name: group, exact: true })
        .or(page.getByRole('heading', { name: group, exact: true }))
        .first(),
    ).toBeVisible();
  await page.getByRole('textbox', { name: '資産番号', exact: true }).fill('E2E-PC');
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('検証用パソコン');
  await page.getByRole('combobox', { name: '資産の種類', exact: true }).selectOption('tools_furniture');
  await page.getByRole('textbox', { name: '取得日', exact: true }).fill(serviceDate);
  await page.getByRole('textbox', { name: '事業供用日', exact: true }).fill(serviceDate);
  await page.getByRole('textbox', { name: '取得価額（税抜）', exact: true }).fill('600000');
  await page.getByRole('combobox', { name: '償却方法', exact: true }).selectOption('straight_line');
  await page.getByRole('textbox', { name: '耐用年数', exact: true }).fill('5');
  const account = page.locator('input[role=combobox][name=assetAccountId]');
  await account.fill('工具器具備品');
  await page
    .getByRole('option', { name: /工具器具備品/ })
    .first()
    .click();
  await page.getByRole('button', { name: '保存', exact: true }).first().click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/e\/fixed_asset\/[0-9a-f-]{36}$/);
  const assetId = new URL(page.url()).pathname.split('/').pop() as string;

  // AC-32 / AC-35: the preview shows the asset; the run stays disabled while the rules are unverified.
  await page.goto('/finance/depreciation');
  await expect(page.getByTestId('depreciation-line')).toHaveCount(1);
  await expect(page.getByTestId('depreciation-amount')).toHaveText('10,000');
  // AC-32: the 科目 column (expense / accumulated depreciation, filled from the settings).
  await expect(page.getByTestId('depreciation-accounts')).toHaveText('6700 / 1929');
  await expect(page.getByTestId('depreciation-run')).toBeDisabled();
  await expect(page.getByTestId('depreciation-blockers')).toContainText('照合');
  // AC-35: the viewer lists every legal parameter the postings use, with the method named and the dates they apply to.
  await page.getByTestId('depreciation-rules').locator('summary').click();
  const rulesView = page.getByTestId('depreciation-rules');
  await expect(rulesView.getByRole('heading', { name: /^定額法 — 耐用年数省令 別表第八/ })).toBeVisible();
  await expect(rulesView.getByRole('heading', { name: /^定率法（200%） — 耐用年数省令 別表第十/ })).toBeVisible();
  for (const name of ['備忘価額', '償却方法の制限', '耐用年数の例'])
    await expect(rulesView.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(rulesView.getByRole('link', { name: /laws\.e-gov\.go\.jp/ }).first()).toBeVisible();

  // AC-35: record the confirmation of the current rule set in the settings console.
  const rules = await api<Row & { id: string }>(request, h, '/actions/fixed_assets.depreciation_rules', {});
  await page.goto('/settings?tab=accounting');
  const card = page.getByTestId('setting-fixed_assets.rules_confirmation');
  await card.getByRole('textbox', { name: '規則集合の id', exact: true }).fill(rules.id);
  await card.getByRole('textbox', { name: '照合日（YYYY-MM-DD）', exact: true }).fill('2026-10-30');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/meta/settings/fixed_assets.rules_confirmation') && r.request().method() === 'PUT',
  );
  await card.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).ok()).toBe(true);

  // AC-34: the populated screen at 390px: no horizontal overflow, axe with the table, the rules viewer and the dialog.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/finance/depreciation');
  await expect(page.getByTestId('depreciation-rules-confirmed')).toBeVisible();
  await expect(page.getByTestId('depreciation-line')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await assertNoOverflow(page);
  await axe(page, { screen: 'depreciation', locale: 'ja', width: 390 });
  await page.getByTestId('depreciation-rules').locator('summary').click();
  await expect(page.getByTestId('depreciation-rules').getByRole('heading', { name: '備忘価額' })).toBeVisible();
  await assertNoOverflow(page);
  await axe(page, { screen: 'depreciation', locale: 'ja', width: 390 });

  // AC-32: run through the kit dialog; the result is announced, the preview is taken again and focus does not drop to
  // the page body although the run button is now disabled.
  await page.getByTestId('depreciation-run').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1 件、合計 10,000 円');
  await axe(page, { screen: 'depreciation', locale: 'ja', width: 390 });
  await dialog.getByTestId('depreciation-confirm').click();
  await expect(page.getByTestId('depreciation-announcement')).toContainText('償却を計上しました');
  await expect(page.getByTestId('depreciation-period-heading')).toBeFocused();
  await expect(page.getByTestId('depreciation-run')).toBeDisabled();
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(page.getByTestId('depreciation-nothing')).toBeVisible();
  await expect(page.getByTestId('depreciation-runs').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('depreciation-entry-link')).toBeVisible();
  // AC-13: a second run of the same period books nothing (server side, idempotent).
  const again = await api<{ created: boolean }>(request, h, '/actions/fixed_assets.run_depreciation', {
    periodId: new URL(page.url()).searchParams.get('periodId'),
  });
  expect(again.created).toBe(false);

  // AC-20: retire the asset through the generic document form and submit it.
  const disposal = await api<Row & { id: string; version: number }>(request, h, '/api/fixed_asset_disposal', {
    assetId,
    date: `${f.period.month}-28`,
    kind: 'retirement',
  });
  await page.goto(`/e/fixed_asset_disposal/${disposal.id}`);
  await expect(page.getByText('当年償却', { exact: false }).first()).toBeVisible();
  const submitted = await api<Row & { docstatus: number; journalEntryId: string }>(
    request,
    h,
    '/actions/fixed_asset_disposal.submit',
    { id: disposal.id, expectedVersion: disposal.version },
  );
  expect([submitted.docstatus, typeof submitted.journalEntryId]).toEqual([1, 'string']);
  const asset = await api<Row & { status: string }>(request, h, `/api/fixed_asset/${assetId}`);
  expect(asset.status).toBe('disposed');
});

test('fixed-assets AC-32 AC-34: a viewer sees no run button; English, 390px and axe on an empty preview', async ({
  page,
  request,
}) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `fa-viewer-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `閲覧 ${suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['viewer'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await page.goto('/finance/depreciation');
  await expect(page.getByRole('heading', { level: 1, name: '償却の実行', exact: true })).toBeVisible();
  await expect(page.getByTestId('depreciation-status')).toBeVisible();
  await expect(page.getByTestId('depreciation-run')).toHaveCount(0);

  await signInQuality(page);
  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto('/finance/depreciation');
    await expect(page.getByTestId('depreciation-status')).toBeVisible();
    await page.waitForLoadState('networkidle');
    if (run.locale === 'en')
      await expect(page.getByRole('heading', { name: 'Depreciation run', level: 1 })).toBeVisible();
    else {
      await assertNoOverflow(page);
      await page.screenshot({ path: test.info().outputPath('depreciation-mobile.png'), fullPage: true });
    }
    await axe(page, { screen: 'depreciation', locale: run.locale, width: run.width });
  }
});
