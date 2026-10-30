// machine-credentials (docs/specs/machine-credentials.md AC-3a, AC-27, AC-28, AC-31, AC-32) in the regular browser
// fixture, whose API runs without account verification (no IDENTITY_ENCRYPTION_KEY): the screen lists keys, explains
// that issuing needs verification and keeps "Issue API key" disabled; non-administrators get neither the entry nor the
// screen; English, 390px and axe. Issuing, the one-time secret, using the key and revoking need a step-up, so they run
// in the identity suite (machine-credentials-identity.spec.ts, `pnpm test:identity:e2e`).
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { judge, formatJudgement, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { API, api, PASSWORD } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

test('machine-credentials AC-27/AC-28/AC-3a: the key list explains that issuing needs account verification', async ({
  page,
  request,
}) => {
  await signInQuality(page);
  await openScreen(page, '/admin/tokens');
  await expect(page.getByRole('heading', { name: 'API キー', level: 1 })).toBeVisible();
  await expect(page.getByTestId('tokens-unconfigured')).toContainText('IDENTITY_ENCRYPTION_KEY');
  const issue = page.getByTestId('token-issue');
  await expect(issue).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled (not disabled) keeps it focusable; a forced click still opens nothing.
  await issue.click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('tokens-empty')).toContainText('API キーはまだありません');
  // the help link of the screen trail opens the manual section (help.ts)
  await expect(page.locator('a[href*="08-admin.md#"]').first()).toBeVisible();

  // The API refuses issuing without a step-up: account verification is not configured in this fixture (401).
  const { headers, companyId } = await qualitySession(request);
  const listed = await api<{ items: unknown[]; roles: string[] }>(request, headers, '/admin/tokens');
  expect(listed.roles).toContain('sales');
  const step = await request.fetch(`${API}/auth/step-up`, {
    method: 'POST',
    headers,
    data: { currentPassword: PASSWORD },
  });
  expect(step.status()).toBe(401);
  const refused = await request.fetch(`${API}/admin/tokens`, {
    method: 'POST',
    headers,
    data: {
      name: 'x',
      purpose: 'integration',
      companyId,
      roles: ['viewer'],
      expiresInDays: 30,
      stepUpToken: 'x'.repeat(43),
    },
  });
  expect(refused.status()).toBe(401);
});

test('machine-credentials AC-31: a company admin who is not a tenant administrator gets no entry and is refused', async ({
  page,
  request,
}) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `tokens-plain-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `会社管理者 ${suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['admin'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await findScreen(page, '/admin/tokens');
  await expect(page.locator('main a[data-screen-href="/admin/tokens"]')).toHaveCount(0);
  let calledTokens = false;
  page.on('request', (r) => {
    if (r.url().startsWith(API) && r.url().includes('/admin/tokens')) calledTokens = true;
  });
  await page.goto('/admin/tokens');
  await expect(page.getByTestId('tokens-forbidden')).toContainText('API キーの管理はテナント管理者だけが行えます');
  await expect(page.getByTestId('token-issue')).toHaveCount(0);
  expect(calledTokens).toBe(false);
  const login = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  const refused = await request.fetch(`${API}/admin/tokens`, {
    headers: { authorization: `Bearer ${login.token}`, 'x-company-id': companyId },
  });
  expect(refused.status()).toBe(403);
});

test('machine-credentials AC-32: English, 390px without horizontal scroll and no serious axe issue', async ({
  page,
}) => {
  await signInQuality(page);
  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto('/admin/tokens');
    await expect(page.getByTestId('tokens-page')).toBeVisible();
    if (run.locale === 'en') {
      await expect(page.getByRole('heading', { name: 'API keys', level: 1 })).toBeVisible();
      await expect(page.getByTestId('tokens-empty')).toContainText('No API keys yet');
    }
    await assertNoOverflow(page);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'tokens', locale: run.locale, width: run.width };
    const judgement = judge(results.violations, exceptions, a11yRun, results.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
  }
  await page.screenshot({ path: test.info().outputPath('tokens-desktop-en.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
});
