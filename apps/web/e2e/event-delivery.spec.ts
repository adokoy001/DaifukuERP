// event-delivery (docs/specs/event-delivery.md AC-18, AC-25..AC-27): in a new company, the fixture script drives one
// event through the real kernel delivery path to a receiver that always fails, so /admin/event-deliveries shows a
// genuine dead webhook delivery; resending moves it to the waiting tab. The browser-test API has no encryption key and
// no worker, so issuing is disabled with its reason and the worker notice shows. 390px, English, axe; a user without
// admin and a store-scoped admin are refused. /inbox shows the mail switch disabled with each reason, and with stubbed
// /me/notifications it toggles with a toast and reports a 409 with toast.error.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { API, api, PASSWORD, type Headers } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

interface DeliveryCompany {
  id: string;
  code: string;
  name: string;
  headers: Headers;
  deadId: string;
  scopedAdminEmail: string;
}

let shared: Promise<DeliveryCompany> | null = null;

/** One synthetic company per worker with a genuine dead delivery (fixture script) and a store-scoped admin. */
function deliveryCompany(request: APIRequestContext): Promise<DeliveryCompany> {
  shared ??= (async () => {
    const login = await api<{ token: string; user: { id: string; tenantId: string } }>(request, {}, '/auth/login', {
      email: process.env.E2E_EMAIL ?? 'admin@example.com',
      password: process.env.E2E_PASSWORD ?? 'password',
    });
    const headers = { authorization: `Bearer ${login.token}` };
    const runId = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const company = await api<{ id: string; code: string; name: string }>(request, headers, '/admin/companies', {
      code: `ED-${runId.slice(0, 6).toUpperCase()}`,
      name: `イベント配送会社 ${runId.slice(0, 6)}`,
    });
    const text = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url)),
        fileURLToPath(new URL('../../api/test/event-delivery-e2e-fixture.ts', import.meta.url)),
        login.user.tenantId,
        login.user.id,
        company.id,
        runId,
        PASSWORD,
      ],
      { env: process.env, encoding: 'utf8' },
    );
    const fixture = JSON.parse(text) as { deadId: string; scopedAdminEmail: string };
    return { ...company, ...fixture, headers: { ...headers, 'x-company-id': company.id } };
  })();
  return shared;
}

async function switchTo(page: Page, company: { code: string; name: string }) {
  await page.goto('/admin/companies');
  await page
    .getByTestId(`company-row-${company.code}`)
    .getByRole('button', { name: `${company.name} に切り替える` })
    .click();
  await expect(page.locator('.company-name')).toContainText(company.name);
}

test('event-delivery AC-25: a dead delivery is explained and resent to the waiting tab; issuing is disabled without a key', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const company = await deliveryCompany(request);
  await signInQuality(page);
  await switchTo(page, company);
  await openScreen(page, '/admin/event-deliveries');
  await expect(page.getByRole('heading', { name: 'イベント配送', level: 1 })).toBeVisible();
  await expect(page.getByTestId('worker-disabled')).toContainText('EVENT_WORKER_ENABLED');
  const endpoint = page.getByTestId('endpoint-erp');
  await expect(endpoint).toHaveAttribute('data-secret', 'active');
  await expect(endpoint.getByTestId('endpoint-secret-state')).toContainText('署名鍵: 発行済み');
  const issue = endpoint.getByTestId('issue-erp');
  await expect(issue).toBeDisabled();
  await expect(issue).toHaveAccessibleDescription(/IDENTITY_ENCRYPTION_KEY/);
  await expect(page.getByTestId('endpoints-settings-link')).toHaveAttribute('href', '/settings?tab=integration');

  const failedTab = page.getByRole('tab', { name: /失敗/ });
  await expect(failedTab).toHaveAttribute('aria-selected', 'true');
  const row = page.locator(`[data-testid="delivery-row"][data-id="${company.deadId}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId('delivery-error')).toHaveText('受信側がエラーの状態コードを返しました（500）');
  await expect(row).toContainText('失敗');
  await expect(row).toContainText('e2e.dead_letter');
  await page.screenshot({ path: test.info().outputPath('deliveries-dead.png'), fullPage: true });

  await row.getByTestId('delivery-retry').click();
  await expect(page.getByRole('status').filter({ hasText: '再送を予約しました' }).first()).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('deliveries-dead')).toBeFocused();
  // Keyboard: the tab list moves with the arrow keys and keeps the choice in ?status=.
  await failedTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /送信待ち/ })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('pending');
  const waiting = page.locator(`[data-testid="delivery-row"][data-id="${company.deadId}"]`);
  await expect(waiting).toHaveAttribute('data-status', 'pending');
  await expect(waiting).toContainText('送信待ち');
  await page.reload();
  await expect(page.getByRole('tab', { name: /送信待ち/ })).toHaveAttribute('aria-selected', 'true');
  await expect(waiting).toBeVisible();
});

test('event-delivery AC-27: 390px without horizontal page scroll, English, and axe finds no serious issue', async ({
  page,
  request,
}) => {
  const company = await deliveryCompany(request);
  await signInQuality(page);
  await switchTo(page, company);
  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto('/admin/event-deliveries?status=pending');
    await expect(page.getByTestId('endpoint-erp')).toBeVisible();
    await expect(page.getByTestId('deliveries-table')).toBeVisible();
    await page.waitForLoadState('networkidle');
    if (run.locale === 'en') {
      await expect(page.getByRole('heading', { name: 'Event deliveries', level: 1 })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Waiting/ })).toHaveAttribute('aria-selected', 'true');
    } else {
      await assertNoOverflow(page);
      await page.screenshot({ path: test.info().outputPath('deliveries-mobile.png'), fullPage: true });
    }
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'event-deliveries', locale: run.locale, width: run.width };
    const judgement = judge(results.violations, exceptions, a11yRun, results.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
  }
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
});

test('event-delivery AC-27: a user without admin gets no entry and a refusal; a store-scoped admin is refused', async ({
  page,
  request,
}) => {
  const company = await deliveryCompany(request);
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `deliveries-sales-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `営業 ${suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['sales'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await findScreen(page, '/admin/event-deliveries');
  await expect(page.locator('main a[data-screen-href="/admin/event-deliveries"]')).toHaveCount(0);
  await page.goto('/admin/event-deliveries');
  await expect(page.getByTestId('deliveries-forbidden')).toBeVisible();

  // The store-scoped admin has the role, so the entry is listed, but the API refuses and the screen explains.
  await page.evaluate(() => localStorage.clear());
  await signInQuality(page, company.scopedAdminEmail, PASSWORD);
  await findScreen(page, '/admin/event-deliveries');
  await expect(page.locator('main a[data-screen-href="/admin/event-deliveries"]')).toHaveCount(1);
  await page.goto('/admin/event-deliveries');
  await expect(page.getByTestId('deliveries-forbidden')).toBeVisible();
  const login = await api<{ token: string }>(request, {}, '/auth/login', {
    email: company.scopedAdminEmail,
    password: PASSWORD,
  });
  const refused = await request.fetch(`${API}/admin/event-deliveries`, {
    headers: { authorization: `Bearer ${login.token}`, 'x-company-id': company.id },
  });
  expect(refused.status()).toBe(403);
});

test('event-delivery AC-26: the inbox mail switch shows why it is unavailable and toggles when it is available', async ({
  page,
  request,
}) => {
  const company = await deliveryCompany(request);
  await signInQuality(page);
  await page.goto('/inbox');
  const toggle = page.getByTestId('inbox-notification-toggle');
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAccessibleDescription(/会社でメール通知が有効になっていません/);
  // The delivery company enabled inbox mail, but this server has no mail transport.
  await switchTo(page, company);
  await page.goto('/inbox');
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAccessibleDescription(/メール送信が設定されていません/);
  const direct = await request.fetch(`${API}/me/notifications`, {
    method: 'PUT',
    headers: { ...company.headers, 'content-type': 'application/json' },
    data: { inboxEmail: true },
  });
  expect(direct.status()).toBe(409);

  // Stubbed: a server that can send mail. On, then off, each with a toast; a 409 from the server is a toast.error.
  let state = { inboxEmail: false, available: true };
  let refuse = false;
  await page.route('**/me/notifications', async (route) => {
    if (route.request().method() === 'PUT') {
      if (refuse)
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INVALID_STATE',
              message: 'inbox mail is not enabled for this company',
              hint: 'Ask an administrator to turn on inbox mail in the integration settings (integration.webhooks.inboxEmail).',
              details: { reason: 'company_disabled' },
            },
          }),
        });
      state = { ...state, inboxEmail: (route.request().postDataJSON() as { inboxEmail: boolean }).inboxEmail };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });
  await page.goto('/inbox');
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  // A controlled checkbox: it changes when the server answers, so click and wait instead of check().
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: '件数が増えたらメールで知らせます' }).first()).toBeVisible();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: 'メール通知を止めました' }).first()).toBeVisible();
  refuse = true;
  await toggle.click();
  await expect(page.getByText('inbox mail is not enabled for this company').first()).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await page.unroute('**/me/notifications');
});
