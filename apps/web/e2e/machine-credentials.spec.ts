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

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});
const failure = (code: string, message: string, extra: Record<string, unknown> = {}) => ({
  error: { code, message, hint: 'Synthetic hint', ...extra },
});

// The regular fixture has no account verification, so the step-up and the issue are answered by page.route: this
// covers the failure paths that a real server cannot be made to produce on demand (AC-28, AC-29).
test('machine-credentials AC-28 AC-29: unreadable verification status, wrong code, closing while issuing and a lost response', async ({
  page,
}) => {
  test.setTimeout(90_000);
  let securityFails = true;
  await page.route('**/auth/security', (route) =>
    route.fulfill(
      securityFails
        ? json(503, failure('INTERNAL', 'Synthetic failure'))
        : json(200, { mfaEnabled: true, recoveryCodesRemaining: 8, identities: [], configured: true }),
    ),
  );
  const stepUps: string[] = [];
  await page.route('**/auth/step-up', (route) => {
    stepUps.push(route.request().postData() ?? '');
    return route.fulfill(
      stepUps.length === 1
        ? json(
            400,
            failure('VALIDATION', 'invalid code', { details: { issues: [{ path: 'code', message: 'invalid code' }] } }),
          )
        : json(200, { stepUpToken: `${stepUps.length}`.repeat(43), expiresIn: 300 }),
    );
  });
  const posts: string[] = [];
  let release: (() => void) | undefined;
  await page.route('**/admin/tokens', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts.push(route.request().postData() ?? '');
    if (posts.length === 1) {
      // held until the test has closed the dialog, then answered: nobody is left to show the outcome
      await new Promise<void>((done) => (release = done));
      return route.fulfill(json(503, failure('INTERNAL', 'Synthetic late failure')));
    }
    if (posts.length === 2) return route.abort('failed');
    return route.fulfill(json(409, failure('CONFLICT', 'The tenant already has 100 active API keys')));
  });

  await signInQuality(page);
  await page.goto('/admin/tokens');
  // The verification status could not be read: say so, offer a retry and keep the issue button explained.
  const issue = page.getByTestId('token-issue');
  const securityError = page.getByTestId('tokens-security-error');
  await expect(securityError).toContainText('本人確認の設定状況を読み込めなかった');
  await expect(issue).toHaveAttribute('aria-disabled', 'true');
  const describedBy = await issue.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveAttribute('data-testid', 'tokens-security-error');
  securityFails = false;
  await page.getByTestId('tokens-security-retry').click();
  await expect(securityError).toHaveCount(0);
  await expect(issue).not.toHaveAttribute('aria-disabled', 'true');

  const dialog = page.getByRole('dialog');
  const password = dialog.getByLabel('現在のパスワード（本人確認）');
  const code = dialog.getByLabel('認証コード・回復コード');
  const fill = async (name: string) => {
    await dialog.getByLabel('名前（用途がわかる名前）').fill(name);
    await dialog.getByLabel('閲覧者', { exact: true }).check();
    await password.fill(PASSWORD);
    await code.fill('123456');
  };
  // A wrong authenticator code is shown on the code field, and focus goes there.
  await issue.click();
  await fill('wrong code');
  await page.getByTestId('token-issue-submit').click();
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText('パスワードまたは認証コードが正しくありません。')).toBeVisible();
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');

  // Esc while the issue request is still being sent: the list warns that a key may exist without its secret.
  await code.fill('654321');
  await page.getByTestId('token-issue-submit').click();
  await expect(page.getByTestId('token-issue-submit')).toHaveText('発行中…');
  await expect.poll(() => posts.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('tokens-issue-interrupted')).toContainText('発行されたか確認できません');
  await expect(issue).toBeFocused();
  release?.();

  // A lost response: the outcome is unknown, and a retry asks for the password again instead of replaying the
  // step-up token (a spent token would answer 401 and end the session).
  await issue.click();
  await expect(page.getByTestId('tokens-issue-interrupted')).toHaveCount(0);
  await fill('lost response');
  await page.getByTestId('token-issue-submit').click();
  await expect(page.getByTestId('token-issue-error')).toContainText('発行されたか確認できません');
  expect(posts).toHaveLength(2);
  await page.getByTestId('token-issue-submit').click();
  await expect(password).toBeFocused();
  await expect(dialog.getByText('本人確認のため現在のパスワードを入力してください。')).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(stepUps).toHaveLength(3);

  // The 100-key limit is explained in the screen's language, with the server's text as the detail.
  await password.fill(PASSWORD);
  await code.fill('111111');
  await page.getByTestId('token-issue-submit').click();
  const error = page.getByTestId('token-issue-error');
  await expect(error).toContainText('有効な API キーが上限（100 件）に達しています');
  await expect(error).toContainText('CONFLICT · HTTP 409 · The tenant already has 100 active API keys');
  expect(stepUps).toHaveLength(4);
  expect(posts).toHaveLength(3);
  // every posted request carried a fresh step-up token
  expect(new Set(posts.map((body) => (JSON.parse(body) as { stepUpToken: string }).stepUpToken)).size).toBe(3);
  await expect(page).toHaveURL(/\/admin\/tokens/);
  await page.keyboard.press('Escape');
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
