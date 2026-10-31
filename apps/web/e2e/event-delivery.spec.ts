// event-delivery (docs/specs/event-delivery.md AC-18, AC-25..AC-27): in a new company, the fixture script drives one
// event through the real kernel delivery path to a receiver that always fails, so /admin/event-deliveries shows a
// genuine dead webhook delivery; resending moves it to the waiting tab. The browser-test API has no encryption key and
// no worker, so issuing is disabled with its reason and the worker notice shows. 390px, English, axe; a user without
// admin and a store-scoped admin are refused. With a stubbed GET /admin/webhooks (a server that has the key): the issue
// and reissue confirmations with the destination URL, the one-time secret Dialog (copy, nothing left in the DOM,
// storage or URL after closing, focus back on the trigger), a 409 when the URL changed meanwhile, the short secret
// state Badge at 390px in English, and the notice for a stored setting that no longer matches. /inbox shows the mail
// switch disabled with each reason, with stubbed /me/notifications it toggles with a toast and reports a 409 with
// toast.error, and a failed read shows a retry.
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
  await expect(endpoint.getByTestId('endpoint-secret-state')).toHaveText('発行済み');
  await expect(endpoint.getByTestId('endpoint-secret-detail')).toContainText('発行しました');
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

// ---------------------------------------------------------------------------------------------------------------
// Stubbed GET /admin/webhooks: the browser-test API has no encryption key, so the secret flow is driven with page.route.

type SecretState = 'none' | 'active' | 'reissue_required';
const ISSUED_AT = '2026-10-30T01:00:00.000Z';
const stubEndpoint = (id: string, state: SecretState, patch: Record<string, unknown> = {}) => ({
  id,
  label: `受信先 ${id}`,
  url: `https://hooks.example.com/daifuku/${id}`,
  topics: ['sales_invoice.submitted'],
  enabled: true,
  secret: state === 'none' ? { state } : { state, issuedAt: ISSUED_AT, issuedByName: 'Admin' },
  ...patch,
});
const stubView = (endpoints: unknown[], patch: Record<string, unknown> = {}) => ({
  endpoints,
  inboxEmail: false,
  settingValid: true,
  secretsAvailable: true,
  mailConfigured: false,
  worker: { enabledHere: true },
  ...patch,
});

async function stubWebhooks(page: Page, view: () => unknown): Promise<{ gets: () => number }> {
  let gets = 0;
  await page.route(
    (url) => url.pathname === '/admin/webhooks',
    (route) => {
      gets++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) });
    },
  );
  return { gets: () => gets };
}

test('event-delivery AC-25 (b)(c): issue and reissue confirm the URL; the secret is shown once and leaves nothing behind', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const webhooks = await stubWebhooks(page, () =>
    stubView([stubEndpoint('fresh', 'none'), stubEndpoint('erp', 'active')]),
  );
  const secret = `whsec_${'Q'.repeat(43)}`;
  const posted: { path: string; body: unknown }[] = [];
  let refuse = false;
  await page.route(
    (url) => /^\/admin\/webhooks\/[^/]+\/secret$/.test(url.pathname),
    (route) => {
      const body = route.request().postDataJSON() as { url: string };
      posted.push({ path: new URL(route.request().url()).pathname, body });
      if (refuse)
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INVALID_STATE',
              message: 'the destination URL of this endpoint changed after it was shown',
              hint: 'Reload the screen, check the destination URL, then issue the signing secret again.',
              details: { endpointId: 'erp', reason: 'url_changed' },
            },
          }),
        });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify({ endpointId: 'erp', url: body.url, secret, issuedAt: ISSUED_AT }),
      });
    },
  );
  await signInQuality(page);
  await page.goto('/admin/event-deliveries');
  await expect(page.getByTestId('endpoint-erp')).toBeVisible();

  // First issue: the confirmation names the destination and the "no earlier events" rule; going back sends nothing.
  const fresh = page.getByTestId('issue-fresh');
  await fresh.click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading', { name: '「受信先 fresh」の署名鍵を発行しますか？' })).toBeVisible();
  await expect(confirm).toContainText('発行より前に起きたイベントは送りません');
  await expect(confirm.getByTestId('secret-confirm-url')).toHaveText('https://hooks.example.com/daifuku/fresh');
  await confirm.getByRole('button', { name: '戻る' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(fresh).toBeFocused();
  expect(posted).toEqual([]);

  // Reissue: the warning about the old secret, the URL sent back as the one confirmed, the secret shown once.
  const trigger = page.getByTestId('issue-erp');
  await trigger.click();
  await expect(confirm.getByRole('heading', { name: '「受信先 erp」の署名鍵を再発行しますか？' })).toBeVisible();
  await expect(confirm).toContainText('これまでの鍵では署名を検証できなくなります');
  await expect(confirm.getByTestId('secret-confirm-url')).toHaveText('https://hooks.example.com/daifuku/erp');
  await confirm.getByTestId('secret-confirm').click();
  const shown = page.getByRole('dialog', { name: '「受信先 erp」の署名鍵' });
  await expect(shown).toBeVisible();
  expect(posted).toEqual([
    { path: '/admin/webhooks/erp/secret', body: { url: 'https://hooks.example.com/daifuku/erp' } },
  ]);
  await expect(shown).toHaveAccessibleDescription(/閉じると再表示できません/);
  await expect(shown.getByTestId('secret-value')).toHaveValue(secret);
  await expect(shown.getByTestId('secret-url')).toHaveText('https://hooks.example.com/daifuku/erp');
  await shown.getByTestId('secret-copy').click();
  await expect(shown.getByTestId('secret-copy-status')).toHaveText(/コピーしました。|Ctrl\+C/);
  await shown.getByTestId('secret-close').click();
  await expect(shown).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.content()).not.toContain(secret);
  expect(page.url()).not.toContain(secret);
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  expect(stored).not.toContain(secret);
  expect(stored).not.toContain('whsec_');

  // The URL changed after the screen loaded: 409, an error toast, no secret, and the endpoints are fetched again.
  refuse = true;
  const before = webhooks.gets();
  await trigger.click();
  await confirm.getByTestId('secret-confirm').click();
  await expect(page.getByText('the destination URL of this endpoint changed after it was shown').first()).toBeVisible();
  await expect(page.getByTestId('secret-value')).toHaveCount(0);
  await expect.poll(() => webhooks.gets()).toBeGreaterThan(before);
  await expect(trigger).toBeFocused();
});

test('event-delivery AC-25 (b) AC-27: the secret state Badge stays a short word inside the card at 390px; an invalid setting is explained', async ({
  page,
}) => {
  const longName = '経理部 システム連携担当 山田 太郎（外部委託先の窓口を兼務）';
  let view = stubView([
    stubEndpoint('moved', 'reissue_required', { label: 'Accounting connector for the head office ledger' }),
    stubEndpoint('erp', 'active', { secret: { state: 'active', issuedAt: ISSUED_AT, issuedByName: longName } }),
    stubEndpoint('fresh', 'none'),
  ]);
  await stubWebhooks(page, () => view);
  await signInQuality(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of ['en', 'ja'] as const) {
    await page.evaluate((value) => localStorage.setItem('daifuku.locale', value), locale);
    await page.goto('/admin/event-deliveries');
    await expect(page.getByTestId('endpoint-moved')).toBeVisible();
    await assertNoOverflow(page);
    for (const id of ['moved', 'erp', 'fresh']) {
      const card = page.getByTestId(`endpoint-${id}`);
      const box = await card.evaluate((element) => {
        const badge = element.querySelector('[data-testid="endpoint-secret-state"]') as HTMLElement;
        const detail = element.querySelector('[data-testid="endpoint-secret-detail"]') as HTMLElement;
        const cardBox = element.getBoundingClientRect();
        return {
          innerWidth,
          card: cardBox.right,
          badge: badge.getBoundingClientRect().right,
          detail: detail.getBoundingClientRect().right,
          detailScroll: detail.scrollWidth <= detail.clientWidth,
        };
      });
      expect(box.badge, `${locale} ${id} badge`).toBeLessThanOrEqual(Math.min(box.innerWidth, box.card) + 0.5);
      expect(box.detail, `${locale} ${id} detail`).toBeLessThanOrEqual(Math.min(box.innerWidth, box.card) + 0.5);
      expect(box.detailScroll, `${locale} ${id} detail wraps`).toBe(true);
    }
    if (locale === 'en') {
      await expect(page.getByTestId('endpoint-moved').getByTestId('endpoint-secret-state')).toHaveText(
        'Reissue required',
      );
      await expect(page.getByTestId('endpoint-moved').getByTestId('endpoint-secret-detail')).toContainText(
        'sending is paused until an administrator reissues',
      );
      await page.screenshot({ path: test.info().outputPath('endpoints-390-en.png'), fullPage: true });
    } else {
      await expect(page.getByTestId('endpoint-moved').getByTestId('endpoint-secret-state')).toHaveText('再発行が必要');
      await expect(page.getByTestId('endpoint-erp').getByTestId('endpoint-secret-detail')).toContainText(longName);
    }
  }

  // A stored value that no longer matches its schema routes nowhere: say so instead of "no destinations yet".
  view = stubView([], { settingValid: false });
  await page.goto('/admin/event-deliveries');
  await expect(page.getByTestId('endpoints-invalid')).toContainText('どの送信先にも送信していません');
  await expect(page.getByTestId('endpoints-invalid')).toContainText('「連携」タブ');
  await expect(page.getByTestId('endpoints-empty')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
});

test('event-delivery AC-26: a failed read of the inbox mail setting is reported with a retry', async ({ page }) => {
  let fail = true;
  await page.route('**/me/notifications', (route) =>
    fail
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL', message: 'synthetic failure', hint: 'Retry later.' } }),
        })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ inboxEmail: false, available: true }),
        }),
  );
  await signInQuality(page);
  await page.goto('/inbox');
  const error = page.getByTestId('inbox-notification-error');
  await expect(error).toContainText('メール通知の設定を読み込めませんでした');
  fail = false;
  await error.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByTestId('inbox-notification-toggle')).toBeEnabled();
  await expect(error).toHaveCount(0);
  await page.unroute('**/me/notifications');
});
