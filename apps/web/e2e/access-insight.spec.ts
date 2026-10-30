// access-insight (docs/specs/access-insight.md AC-6, AC-7, AC-19..AC-21): the permission matrix renders the grants the
// API derives (partner x sales), filters and the role view survive a reload, the payment row explains the sales row
// rule; the audit search narrows to one user's partner changes (made through the API with that user's own token), opens
// the record, finds the CSV export, explains a date error, pages with Next / Previous / First, and keeps its conditions
// on reload and Back. Both screens work in English and at 390px without page scroll, pass axe, and are hidden from and
// explained to users without the admin role. The scope switch is only for tenant administrators.
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { API, api, PASSWORD, type Headers, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

interface Matrix {
  roles: { name: string }[];
  entities: {
    name: string;
    grants: Record<string, string[]>;
    rowRules: { roles: string[]; summary: { ja: string } }[];
  }[];
}

async function axe(page: Page, screen: string, locale: 'ja' | 'en', width: number) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const run: A11yRun = { screen, locale, width };
  const judgement = judge(results.violations, exceptions, run, results.incomplete);
  expect(judgement.failures, formatJudgement(run, judgement)).toEqual([]);
}

/** A user of the current company with the given roles; returns the API headers of that user's own session. */
async function companyUser(request: APIRequestContext, roles: string[], prefix: string) {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${suffix}@example.com`;
  const name = `監査 ${prefix} ${suffix}`;
  const user = await api(request, headers, '/admin/users', { name, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles, accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  const login = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  const own: Headers = { authorization: `Bearer ${login.token}`, 'x-company-id': companyId };
  return { id: user.id, email, name, headers: own, admin: headers, companyId };
}

test('access-insight AC-6/AC-7: the matrix shows the derived grants, filters survive a reload, and the payment rule is explained', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const { headers } = await qualitySession(request);
  const matrix = await api<Matrix>(request, headers, '/admin/permissions');
  const partner = matrix.entities.find((e) => e.name === 'partner');
  expect(partner?.grants.sales?.length).toBeGreaterThan(0);

  await signInQuality(page);
  await openScreen(page, '/admin/permissions');
  await expect(page.getByRole('heading', { name: '権限マトリクス', level: 1 })).toBeVisible();
  const cell = page.getByTestId('cell-partner-sales');
  await expect(cell).toHaveAttribute('data-ops', (partner?.grants.sales ?? []).join(' '));
  await expect(page.getByTestId('matrix-legend')).toContainText('閲 = 閲覧');
  await page.screenshot({ path: test.info().outputPath('permissions-desktop.png') });

  // Module and role filters live in the URL: reload shows the same role view (entity x operation).
  await page.getByTestId('matrix-module').selectOption('payment');
  await page.getByTestId('matrix-role').selectOption('sales');
  await expect.poll(() => new URL(page.url()).searchParams.get('role')).toBe('sales');
  await page.reload();
  await expect(page.getByTestId('matrix-role')).toHaveValue('sales');
  await expect(page.getByTestId('matrix-module')).toHaveValue('payment');
  await expect(page.getByTestId('matrix-row-partner')).toHaveCount(0);
  await expect(page.getByTestId('cell-payment-read')).toHaveAttribute('data-allowed', 'true');
  await expect(page.getByTestId('cell-payment-cancel')).toHaveAttribute('data-allowed', 'false');
  await page.getByTestId('matrix-details-payment').click();
  const notes = page.getByTestId('permission-notes-payment');
  await expect(notes.getByTestId('row-rule-summary')).toHaveText('区分 = 入金');
  await expect(notes).toContainText('条件付き');

  // The actions tab: entry permission and who can run each action.
  await page.getByRole('tab', { name: 'アクション' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('actions');
  await expect(page.getByTestId('actions-table')).toBeVisible();
  await page.getByTestId('matrix-module').selectOption('');
  await expect(page.getByTestId('actions-table').locator('tbody tr').first()).toBeVisible();

  for (const run of [
    { locale: 'en', width: 1280 },
    { locale: 'ja', width: 390 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto('/admin/permissions');
    await expect(page.getByTestId('matrix-table')).toBeVisible();
    if (run.locale === 'en') {
      await expect(page.getByRole('heading', { name: 'Permission matrix', level: 1 })).toBeVisible();
      await expect(page.getByTestId('kernel-capabilities')).toContainText('Company settings');
    } else {
      // AC-7: one role by default on a narrow screen, the table scrolls inside itself.
      await expect(page.getByTestId('matrix-role')).not.toHaveValue('');
      await expect(page.getByTestId('cell-partner-read')).toBeVisible();
      await assertNoOverflow(page);
      await page.screenshot({ path: test.info().outputPath('permissions-mobile.png'), fullPage: true });
    }
    await page.waitForLoadState('networkidle');
    await axe(page, 'permissions', run.locale, run.width);
  }
});

test('access-insight AC-19/AC-20: filter by user, open the record, find the CSV export, page, and keep conditions', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const sales = await companyUser(request, ['sales'], 'sales');
  // The sales user creates a partner and updates it 55 times with their own token; the admin exports partners.
  let partner = await api<Row>(request, sales.headers, '/api/partner', {
    code: 'AU' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    name: `監査の取引先 ${sales.name}`,
    isCustomer: true,
  });
  for (let i = 1; i <= 55; i += 1)
    partner = await api<Row>(
      request,
      sales.headers,
      `/api/partner/${partner.id}`,
      { patch: { name: `監査の取引先 ${i}` }, expectedVersion: partner.version },
      'PATCH',
    );
  await api(request, sales.admin, '/actions/partner.export_rows', {
    columns: ['code', 'name'],
    search: '監査の取引先',
  });

  await signInQuality(page);
  await openScreen(page, '/admin/audit');
  await expect(page.getByRole('heading', { name: '監査ログの検索', level: 1 })).toBeVisible();
  await expect(page.getByTestId('audit-scope')).toBeVisible();
  await page.getByTestId('audit-user').selectOption({ label: sales.name });
  await page.getByTestId('audit-submit').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('user')).toBe(sales.id);
  const rows = page.getByTestId('audit-row');
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId('audit-actor').filter({ hasNotText: sales.name })).toHaveCount(0);
  await expect(page.getByTestId('audit-live')).toContainText('1 ページ目: 50 件を表示。続きがあります。');
  await page.screenshot({ path: test.info().outputPath('audit-desktop.png') });

  // Next / Previous / First through the 56 rows of this user.
  await page.getByTestId('audit-next').click();
  await expect(rows).toHaveCount(6);
  await expect(page.getByTestId('audit-page-number')).toHaveText('2 ページ目');
  await expect(page.getByTestId('audit-next')).toHaveAttribute('aria-disabled', 'true');
  await expect(rows.last()).toHaveAttribute('data-op', 'create');
  await page.getByTestId('audit-prev').click();
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId('audit-page-number')).toHaveText('1 ページ目');
  await page.getByTestId('audit-next').click();
  await expect(rows).toHaveCount(6);
  await page.getByTestId('audit-first').click();
  await expect(rows).toHaveCount(50);

  // The record link opens the partner; Back restores the conditions.
  await rows.first().getByTestId('audit-record-link').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/e/partner/${partner.id}`);
  await page.goBack();
  await expect(page.getByTestId('audit-user')).toHaveValue(sales.id);
  await expect(rows).toHaveCount(50);

  // The CSV export of the administrator, found by operation.
  await page.getByTestId('audit-user').selectOption('');
  await page.getByTestId('audit-entity').selectOption('partner');
  await page.getByTestId('audit-op-filter').selectOption('export');
  await page.getByTestId('audit-submit').click();
  await expect(rows.first().getByTestId('audit-export-summary')).toContainText('列: code, name');
  await expect(rows.first().getByTestId('audit-op')).toHaveText('CSV 出力');
  await page.reload();
  await expect(page.getByTestId('audit-op-filter')).toHaveValue('export');
  await expect(rows.first().getByTestId('audit-export-summary')).toBeVisible();

  // A date error is explained at the field and takes the focus; nothing is searched.
  const before = page.url();
  await page.getByTestId('audit-from').fill('2026-12-31');
  await page.getByTestId('audit-to').fill('2026-01-01');
  await page.getByTestId('audit-submit').click();
  await expect(page.getByTestId('audit-error-to')).toHaveText('終了日を開始日以降にしてください。');
  await expect(page.getByTestId('audit-to')).toBeFocused();
  expect(page.url()).toBe(before);

  // An unreadable URL condition is ignored and said so.
  await page.goto('/admin/audit?from=2026-02-30&entity=partner');
  await expect(page.getByTestId('audit-ignored')).toContainText('開始日');
  await expect(page.getByTestId('audit-entity')).toHaveValue('partner');

  for (const run of [
    { locale: 'en', width: 1280 },
    { locale: 'ja', width: 390 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto(`/admin/audit?user=${sales.id}`);
    await expect(rows.first()).toBeVisible();
    if (run.locale === 'en') await expect(page.getByRole('heading', { name: 'Audit search', level: 1 })).toBeVisible();
    else {
      await assertNoOverflow(page);
      await page.screenshot({ path: test.info().outputPath('audit-mobile.png'), fullPage: true });
    }
    await page.waitForLoadState('networkidle');
    await axe(page, 'audit', run.locale, run.width);
  }
});

test('access-insight AC-21: a sales user gets no entries and an explanation; a company admin has no scope switch', async ({
  page,
  request,
}) => {
  const sales = await companyUser(request, ['sales'], 'nav-sales');
  await signInQuality(page, sales.email, PASSWORD);
  for (const href of ['/admin/permissions', '/admin/audit']) {
    await findScreen(page, href);
    await expect(page.locator(`main a[data-screen-href="${href}"]`)).toHaveCount(0);
  }
  await page.goto('/admin/permissions');
  await expect(page.getByTestId('permissions-forbidden')).toBeVisible();
  await page.goto('/admin/audit');
  await expect(page.getByTestId('audit-forbidden')).toBeVisible();
  for (const path of ['/admin/permissions', '/admin/audit?from=2026-10-01&to=2026-10-02', '/admin/audit/options'])
    expect((await request.fetch(`${API}${path}`, { headers: sales.headers })).status(), path).toBe(403);

  const companyAdmin = await companyUser(request, ['admin'], 'company-admin');
  await signInQuality(page, companyAdmin.email, PASSWORD);
  await openScreen(page, '/admin/audit');
  await expect(page.getByTestId('audit-form')).toBeVisible();
  await expect(page.getByTestId('audit-scope')).toHaveCount(0);
  await openScreen(page, '/admin/permissions');
  await expect(page.getByTestId('matrix-table')).toBeVisible();
});
