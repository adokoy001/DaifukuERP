// e2e-a11y (docs/specs/e2e-a11y.md): axe over the 8 main screens x ja/en x 1280/390px.
// Serious/critical WCAG 2.1 A/AA violations fail unless a11y-exceptions.json registers them with a reason; an exception
// that applies to a run but matches nothing fails that run too (no stale exceptions). Moderate/minor and axe's
// needs-review (`incomplete`) nodes are only printed and kept in axe.json.
// The rules live in a11y-policy.ts (unit-tested by apps/web/src/a11y-policy.test.ts).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';
import { api, type Row } from './operations-helpers.ts';
import {
  WCAG_TAGS,
  a11yRuns,
  a11yTitle,
  expiredDeadlines,
  formatJudgement,
  judge,
  parseExceptions,
  type A11yRun,
} from './a11y-policy.ts';

const repoRoot = new URL('../../../', import.meta.url);
const parsed = parseExceptions(JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')), {
  documentExists: (path) => existsSync(new URL(path, repoRoot)),
});

interface Session {
  token: string;
  user: { defaultCompanyId?: string | null };
}
let session: Session | undefined;

/** The storage the login screen writes (`setSession`), so the 28 signed-in runs do not repeat the login form. */
async function signedIn(page: Page, request: APIRequestContext): Promise<Session> {
  const current = (session ??= await api<Session>(request, {}, '/auth/login', {
    email: process.env.E2E_EMAIL ?? 'admin@example.com',
    password: process.env.E2E_PASSWORD ?? 'password',
  }));
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('daifuku.token')) {
      sessionStorage.setItem('daifuku.token', value.token);
      sessionStorage.setItem('daifuku.user', JSON.stringify(value.user));
    }
  }, current);
  return current;
}

/**
 * The screen shows its own content: a heading, no read failure, and nothing loading (skeletons, pending reads).
 * networkidle fires once per navigation, so it is awaited first and the absence checks then see the settled DOM.
 */
async function settled(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('meta-error')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByTestId('loading-view')).toHaveCount(0);
}

async function check(page: Page, run: A11yRun) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const saved = { run, violations: results.violations, incomplete: results.incomplete };
  writeFileSync(test.info().outputPath('axe.json'), JSON.stringify(saved, null, 2));
  const judgement = judge(results.violations, parsed.exceptions, run, results.incomplete);
  const report = formatJudgement(run, judgement);
  await test.info().attach('axe-report.txt', { body: report, contentType: 'text/plain' });
  if (judgement.advisory.length || judgement.waived.length) console.log(report);
  expect(judgement.failures.length + judgement.stale.length, report).toBe(0);
}

test('a11y AC-3: the exception file is well-formed (reason, follow-up, known screen and condition)', () => {
  expect(parsed.errors).toEqual([]);
  // A passed deadline is a warning, not a failure: the result of a commit must not change with the calendar.
  const today = new Date().toISOString().slice(0, 10);
  for (const item of expiredDeadlines(parsed.exceptions, today)) {
    const description = `a11y exception past its deadline ${item.followUp}: ${item.rule} ${item.screen} ${item.target}`;
    test.info().annotations.push({ type: 'warning', description });
    console.warn(description);
  }
});

for (const run of a11yRuns()) {
  test(a11yTitle(run), async ({ page, request }) => {
    await page.setViewportSize({ width: run.width, height: run.width === 390 ? 844 : 800 });
    await page.addInitScript((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    if (run.auth) await signedIn(page, request);
    await page.goto(run.path);
    await expect.poll(() => new URL(page.url()).pathname).toBe(run.path);
    await expect(page.locator('html')).toHaveAttribute('lang', run.locale);
    await settled(page);
    await check(page, run);
  });
}

// AC-4 / docs/conventions/ui.md: the line grid's scrolling frame gets tabIndex/role=region only while nothing inside it
// can take focus. The 32 runs above see the empty new invoice; this covers rows being added, a read-only grid of
// disabled inputs, and a read-only grid whose cells hold record links (a submitted payment), where axe must agree.
test('a11y AC-4: the line grid frame is a Tab stop only while nothing inside it can take focus', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('daifuku.locale', 'ja'));
  const { token, user } = await signedIn(page, request);
  const headers = {
    authorization: `Bearer ${token}`,
    ...(user.defaultCompanyId ? { 'x-company-id': user.defaultCompanyId } : {}),
  };
  const partners = await api<{ items: Row[] }>(request, headers, '/api/partner?limit=50');
  const partner = partners.items.find((row) => row.code === 'C-0001') ?? partners.items[0];
  expect(partner, 'a seeded partner (prepare the E2E fixture from CONTRIBUTING.md)').toBeDefined();
  const line = {
    description: `a11y line grid ${Date.now()}`,
    quantity: '1',
    unitPrice: '1000',
    taxCategory: 'standard',
  };
  const draft = await api(request, headers, '/api/sales_invoice', {
    date: BUSINESS_DATE,
    partnerId: partner?.id,
    lines: { sales_invoice_line: [line] },
  });
  const invoice = await api(request, headers, `/api/sales_invoice/${draft.id}/submit`, {});
  const accounts = await api<{ items: Row[] }>(request, headers, '/api/account?limit=500');
  const bank = accounts.items.find((row) => row.code === '1100');
  const receipt = await api(request, headers, '/api/payment', {
    direction: 'receive',
    partnerId: partner?.id,
    date: BUSINESS_DATE,
    amount: String(invoice.balance),
    ...(bank ? { accountId: bank.id } : {}),
    lines: {
      payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: invoice.id, amount: String(invoice.balance) }],
    },
  });
  const payment = await api(request, headers, `/api/payment/${receipt.id}/submit`, {
    expectedVersion: receipt.version,
  });

  const frameOf = (name: string) => page.locator(`[data-testid="lines-${name}"] > .overflow-x-auto`);
  const scrollFocus = async (name: string) =>
    (
      await new AxeBuilder({ page })
        .include(`[data-testid="lines-${name}"]`)
        .withRules(['scrollable-region-focusable'])
        .analyze()
    ).violations;

  // A new invoice has no rows: the frame is the Tab stop. Adding a row puts inputs inside, so the frame stops being one.
  await page.goto('/e/sales_invoice/new');
  const invoiceFrame = frameOf('sales_invoice_line');
  await expect(invoiceFrame).toHaveAttribute('tabindex', '0');
  await expect(invoiceFrame).toHaveAttribute('role', 'region');
  await page.getByTestId('lines-sales_invoice_line').getByRole('button', { name: '行を追加' }).click();
  await expect(page.getByTestId('lines-sales_invoice_line').getByTestId('line-row')).toHaveCount(1);
  await expect(invoiceFrame).not.toHaveAttribute('tabindex');
  await expect(invoiceFrame).not.toHaveAttribute('role');
  expect(await scrollFocus('sales_invoice_line')).toEqual([]);

  // A submitted invoice: its cells are disabled inputs only, so the frame is the Tab stop again.
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  await expect(page.getByTestId('lines-sales_invoice_line')).toHaveAttribute('data-readonly', 'true');
  await expect(page.getByTestId('lines-sales_invoice_line').getByTestId('line-row')).toHaveCount(1);
  await expect(invoiceFrame).toHaveAttribute('tabindex', '0');
  await expect(invoiceFrame).toHaveAttribute('role', 'region');
  expect(await scrollFocus('sales_invoice_line')).toEqual([]);

  // A submitted payment: read-only, but each allocation links to its invoice, so the links are the Tab stops.
  await page.goto(`/e/payment/${payment.id}`);
  const allocation = page.getByTestId('lines-payment_allocation');
  await expect(allocation).toHaveAttribute('data-readonly', 'true');
  await expect(allocation.getByTestId('target-link')).toHaveText(String(invoice.number));
  await expect(frameOf('payment_allocation')).not.toHaveAttribute('tabindex');
  await expect(frameOf('payment_allocation')).not.toHaveAttribute('role');
  expect(await scrollFocus('payment_allocation')).toEqual([]);
});
