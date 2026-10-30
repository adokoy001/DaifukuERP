// machine-credentials (docs/specs/machine-credentials.md AC-8, AC-18, AC-27..AC-30, AC-32, AC-33) with account
// verification configured. Runs only in the identity suite (playwright.identity.config.ts, `pnpm test:identity:e2e`)
// against identity-e2e-server.ts, whose fixture adds the two tenant administrators used here; it never touches the
// bootstrap administrator that enterprise-identity.spec.ts changes.
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';

const API = 'http://127.0.0.1:3109';
const PASSWORD = 'identity-keys-password';
const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.locator('#password')).not.toBeVisible();
}

async function apiSession(request: APIRequestContext, email: string) {
  const login = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(200);
  return { authorization: `Bearer ${((await login.json()) as { token: string }).token}` };
}

async function issueByApi(request: APIRequestContext, email: string, name: string) {
  const headers = await apiSession(request, email);
  const step = await request.post(`${API}/auth/step-up`, { headers, data: { currentPassword: PASSWORD } });
  expect(step.status()).toBe(200);
  const companies = await request.get(`${API}/admin/tokens`, { headers });
  const companyId = ((await companies.json()) as { companies: { id: string }[] }).companies[0]?.id;
  const issued = await request.post(`${API}/admin/tokens`, {
    headers,
    data: {
      name,
      purpose: 'integration',
      companyId,
      roles: ['viewer'],
      expiresInDays: 30,
      stepUpToken: ((await step.json()) as { stepUpToken: string }).stepUpToken,
    },
  });
  expect(issued.status(), await issued.text()).toBe(200);
  return (await issued.json()) as { token: string; credential: { id: string } };
}

test.describe.serial('API keys with account verification', () => {
  test('machine-credentials AC-27..AC-30 AC-8: issue with a step-up, show the secret once, use it, revoke it', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'keys-admin@example.com');
    await page.goto('/admin/tokens');
    await expect(page.getByRole('heading', { name: 'API キー', level: 1 })).toBeVisible();
    await expect(page.getByTestId('tokens-unconfigured')).toHaveCount(0);
    const issueButton = page.getByTestId('token-issue');
    await expect(issueButton).not.toHaveAttribute('aria-disabled', 'true');
    await issueButton.click();
    const dialog = page.getByRole('dialog');
    // AC-28: missing name and roles are shown on their fields before anything is sent.
    await page.getByTestId('token-issue-submit').click();
    await expect(dialog.getByText('名前を入力してください。')).toBeVisible();
    await expect(dialog.getByText('ロールを 1 つ以上選んでください。')).toBeVisible();
    const name = dialog.getByLabel('名前（用途がわかる名前）');
    await expect(name).toBeFocused();
    // AC-32: the issue form with its field errors has no serious axe issue.
    const formAxe = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const formRun: A11yRun = { screen: 'tokens-issue', locale: 'ja', width: 1280 };
    const formJudgement = judge(formAxe.violations, exceptions, formRun, formAxe.incomplete);
    expect(formJudgement.failures, formatJudgement(formRun, formJudgement)).toEqual([]);
    await name.fill('EC 連携 e2e');
    await dialog.getByLabel('会社管理者', { exact: true }).check();
    await expect(page.getByTestId('token-admin-warning')).toContainText('会社のすべての業務を操作できる鍵');
    await dialog.getByLabel('会社管理者', { exact: true }).uncheck();
    await expect(page.getByTestId('token-admin-warning')).toHaveCount(0);
    await dialog.getByLabel('閲覧者', { exact: true }).check();
    await dialog.getByLabel('現在のパスワード（本人確認）').fill(PASSWORD);
    const posted = page.waitForResponse((r) => r.url().endsWith('/admin/tokens') && r.request().method() === 'POST');
    await page.getByTestId('token-issue-submit').click();
    expect((await posted).status()).toBe(200);

    // AC-28: the secret is shown once, with the warning, the usage and focus on the panel heading.
    const panel = page.getByTestId('token-secret');
    await expect(panel.getByRole('heading', { name: 'API キーを発行しました' })).toBeFocused();
    const secret = await page.getByTestId('token-secret-value').inputValue();
    expect(secret).toMatch(/^dfk_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByTestId('token-secret-warning')).toContainText('二度と表示できません');
    await expect(panel).toContainText('Authorization: Bearer <API key>');
    await page.getByTestId('token-copy').click();
    await expect(page.getByTestId('token-copy-status')).toHaveText(/コピーしました|Ctrl\+C/);
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'tokens-secret', locale: 'ja', width: 390 };
    const judgement = judge(axe.violations, exceptions, a11yRun, axe.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 900 });

    // AC-29: closing drops the secret everywhere; focus returns to "Issue API key".
    await page.getByTestId('token-secret-close').click();
    await expect(dialog).toHaveCount(0);
    await expect(issueButton).toBeFocused();
    expect(await page.content()).not.toContain(secret);
    const stored = await page.evaluate(
      () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
    );
    expect(stored).not.toContain(secret.slice(4));
    expect(page.url()).not.toContain(secret.slice(4, 12));
    const listed = page.waitForResponse((r) => r.url().endsWith('/admin/tokens') && r.request().method() === 'GET');
    await page.reload();
    expect(await (await listed).text()).not.toContain(secret.slice(4, 16));
    const row = page.locator('[data-testid^="token-row-"]').filter({ hasText: 'EC 連携 e2e' });
    await expect(row).toContainText('未使用');
    await expect(row.getByTestId('token-status')).toHaveText('有効');
    expect(await page.content()).not.toContain(secret);

    // The key works on the REST API (AC-7) and records its use (AC-15).
    const ok = await request.get(`${API}/api/partner`, { headers: { authorization: `Bearer ${secret}` } });
    expect(ok.status()).toBe(200);
    await page.reload();
    await expect(row).not.toContainText('未使用');

    // AC-30: Esc cancels and returns focus to "Revoke"; revoking updates the row, announces and focuses "History".
    const revoke = row.getByTestId('token-revoke');
    await revoke.click();
    await expect(dialog).toContainText('「EC 連携 e2e」を失効');
    await expect(dialog).toContainText('次の要求から拒否（401）');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(revoke).toBeFocused();
    await revoke.click();
    await dialog.getByLabel('理由（任意、200 文字まで）').fill('e2e の終了');
    await page.getByTestId('token-revoke-confirm').click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByTestId('token-status')).toHaveText('失効');
    await expect(row.getByRole('button', { name: 'EC 連携 e2e の履歴' })).toBeFocused();
    await expect(page.getByTestId('tokens-announcement')).toContainText('失効しました');
    await expect(row.getByTestId('token-revoke')).toHaveCount(0);

    // AC-8: the same key is refused with 401 from the next request; the history shows issue, revoke and the refusal.
    const refused = await request.get(`${API}/api/partner`, { headers: { authorization: `Bearer ${secret}` } });
    expect(refused.status()).toBe(401);
    await row.getByRole('button', { name: 'EC 連携 e2e の履歴' }).click();
    const history = page.getByTestId('token-history');
    await expect(history.getByTestId('token-history-issue')).toContainText('Keys Admin');
    await expect(history.getByTestId('token-history-revoke')).toContainText('e2e の終了');
    await expect(history.getByTestId('token-history-use_denied')).toContainText('失効済みの鍵');
    await page.keyboard.press('Escape');
  });

  test('machine-credentials AC-18 AC-33: removing tenant administration warns with the key count and revokes it', async ({
    page,
    request,
  }) => {
    const { token } = await issueByApi(request, 'keys-issuer@example.com', 'Issuer の鍵');
    expect((await request.get(`${API}/api/partner`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(
      200,
    );
    await signIn(page, 'keys-admin@example.com');
    await page.goto('/admin/users');
    await page.getByRole('searchbox', { name: '利用者を検索' }).fill('keys-issuer@example.com');
    await page.locator('.access-user').filter({ hasText: 'keys-issuer@example.com' }).click();
    const profile = page.getByRole('form', { name: '利用者情報' });
    await profile.getByLabel('テナント管理者').uncheck();
    await profile.getByRole('button', { name: '利用者情報を保存', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('この利用者が発行した有効な API キー 1 件も失効します。');
    const saved = page.waitForResponse((r) => r.url().includes('/admin/users/') && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: '利用者情報を更新', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { revokedMachineCredentials: number }).revokedMachineCredentials).toBe(1);
    expect((await request.get(`${API}/api/partner`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(
      401,
    );
    await page.goto('/admin/tokens');
    const row = page.locator('[data-testid^="token-row-"]').filter({ hasText: 'Issuer の鍵' });
    await expect(row.getByTestId('token-status')).toHaveText('失効');
    await row.getByRole('button', { name: 'Issuer の鍵 の履歴' }).click();
    await expect(page.getByTestId('token-history-revoke')).toContainText('発行者のテナント管理者解除');
  });
});
