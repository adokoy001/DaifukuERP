// setup-health (docs/specs/setup-health.md AC-9, AC-10): in a fresh company (B2, so the shared fixture companies keep
// their tax rates) the standard tax rate is ended yesterday; /admin/health lists that `fail` first, its link opens the
// tax rate list, the rate is fixed in the record form, and "Check again" turns the item ok. 390px, axe, and a user
// without admin or settings gets no entry and a refusal.
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { BUSINESS_DATE } from './environment.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { API, api, PASSWORD, type Headers, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

function yesterday(): string {
  const day = new Date(`${BUSINESS_DATE}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** A new company of the tenant (company-admin), so ending its tax rate leaves the shared fixture companies alone. */
async function healthCompany(
  request: APIRequestContext,
): Promise<{ id: string; code: string; name: string; headers: Headers }> {
  const { headers } = await qualitySession(request);
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const company = await api<{ id: string; code: string; name: string }>(request, headers, '/admin/companies', {
    code: `HC-${suffix}`,
    name: `導入チェック会社 ${suffix}`,
  });
  return { ...company, headers: { ...headers, 'x-company-id': company.id } };
}

async function switchTo(page: Page, company: { code: string; name: string }) {
  await page.goto('/admin/companies');
  await page
    .getByTestId(`company-row-${company.code}`)
    .getByRole('button', { name: `${company.name} に切り替える` })
    .click();
  await expect(page.locator('.company-name')).toContainText(company.name);
}

const healthItem = (page: Page, id: string) => page.getByTestId(`health-item-${id}`);

test('setup-health AC-9: a fail is listed first, its link fixes it, and "Check again" turns it ok', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const company = await healthCompany(request);
  const rates = await api<{ items: Row[] }>(request, company.headers, '/api/tax_rate?limit=50');
  const standard = rates.items.find((row) => row.code === 'STD10');
  expect(standard, 'the tax seed ran for the new company').toBeDefined();
  await api(request, company.headers, `/api/tax_rate/${standard?.id}`, { validTo: yesterday() }, 'PATCH');

  await signInQuality(page);
  await switchTo(page, company);
  await openScreen(page, '/admin/health');
  await expect(page.getByRole('heading', { name: '導入チェック', level: 1 })).toBeVisible();
  const items = page.getByTestId('health-items').locator('li');
  await expect(items.first()).toHaveAttribute('data-testid', 'health-item-tax.standard_rate');
  const tax = healthItem(page, 'tax.standard_rate');
  await expect(tax).toHaveAttribute('data-status', 'fail');
  await expect(tax.getByTestId('health-status')).toHaveText('要対応');
  await expect(tax).toContainText('有効な標準税率がありません');
  // Statuses are ordered fail, warn, ok down the list.
  const statuses = await items.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-status')));
  const rank = { fail: 0, warn: 1, ok: 2 } as Record<string, number>;
  expect(statuses.map((s) => rank[s ?? ''])).toEqual([...statuses.map((s) => rank[s ?? ''])].sort());
  // The company profile of a new company is empty: a warn with a link to the company tab.
  await expect(healthItem(page, 'company.profile')).toHaveAttribute('data-status', 'warn');
  await page.screenshot({ path: test.info().outputPath('health-fail-desktop.png'), fullPage: true });

  await tax.getByRole('link', { name: '直す（標準税率の有効期間）' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/e/tax_rate');
  await page.goto(`/e/tax_rate/${standard?.id}`);
  const form = page.getByTestId('record-form');
  await form.locator('div[data-field="validTo"] input').fill('');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(form.locator('div[data-field="validTo"] input')).toHaveValue('');
  const saved = await api<Row>(request, company.headers, `/api/tax_rate/${standard?.id}`);
  expect(saved.validTo).toBeNull();

  await page.goto('/admin/health');
  await expect(healthItem(page, 'tax.standard_rate')).toBeVisible();
  await page.getByTestId('health-recheck').click();
  await expect(healthItem(page, 'tax.standard_rate')).toHaveAttribute('data-status', 'ok');
  await expect(healthItem(page, 'tax.standard_rate').getByTestId('health-status')).toHaveText('OK');
  await expect(page.getByTestId('health-live')).not.toHaveText('');
});

test('setup-health AC-10: 390px without horizontal scroll, English, and axe finds no serious issue', async ({
  page,
}) => {
  await signInQuality(page);
  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto('/admin/health');
    await expect(page.getByTestId('health-items')).toBeVisible();
    await page.waitForLoadState('networkidle');
    if (run.locale === 'en') await expect(page.getByRole('heading', { name: 'Setup check', level: 1 })).toBeVisible();
    else {
      await assertNoOverflow(page);
      await page.screenshot({ path: test.info().outputPath('health-mobile.png'), fullPage: true });
    }
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'health', locale: run.locale, width: run.width };
    const judgement = judge(results.violations, exceptions, a11yRun, results.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
  }
});

test('setup-health AC-10: a user without admin or settings gets no entry and is refused', async ({ page, request }) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `health-sales-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `営業 ${suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['sales'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await findScreen(page, '/admin/health');
  await expect(page.locator('main a[data-screen-href="/admin/health"]')).toHaveCount(0);
  await page.goto('/admin/health');
  await expect(page.getByTestId('health-forbidden')).toBeVisible();
  const login = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  const refused = await request.fetch(`${API}/meta/health`, {
    headers: { authorization: `Bearer ${login.token}`, 'x-company-id': companyId },
  });
  expect(refused.status()).toBe(403);
});
