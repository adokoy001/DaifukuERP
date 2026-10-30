// e2e-a11y (docs/specs/e2e-a11y.md): axe over the 8 main screens x ja/en x 1280/390px.
// Serious/critical WCAG 2.1 A/AA violations fail unless a11y-exceptions.json registers them with a reason; an exception
// that applies to a run but matches nothing fails that run too (no stale exceptions). Moderate/minor are only printed.
// The rules live in a11y-policy.ts (unit-tested by apps/web/src/a11y-policy.test.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { api } from './operations-helpers.ts';
import {
  WCAG_TAGS,
  a11yRuns,
  a11yTitle,
  formatJudgement,
  judge,
  parseExceptions,
  type A11yRun,
} from './a11y-policy.ts';

const parsed = parseExceptions(JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')));

interface Session {
  token: string;
  user: unknown;
}
let session: Session | undefined;

/** The storage the login screen writes (`setSession`), so the 28 signed-in runs do not repeat the login form. */
async function signedIn(page: Page, request: APIRequestContext) {
  session ??= await api<Session>(request, {}, '/auth/login', {
    email: process.env.E2E_EMAIL ?? 'admin@example.com',
    password: process.env.E2E_PASSWORD ?? 'password',
  });
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('daifuku.token')) {
      sessionStorage.setItem('daifuku.token', value.token);
      sessionStorage.setItem('daifuku.user', JSON.stringify(value.user));
    }
  }, session);
}

/** The screen shows its own content: a heading, no read failure, and nothing loading (skeletons, pending reads). */
async function settled(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.getByTestId('meta-error')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByTestId('loading-view')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

async function check(page: Page, run: A11yRun) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  writeFileSync(test.info().outputPath('axe.json'), JSON.stringify({ run, violations: results.violations }, null, 2));
  const judgement = judge(results.violations, parsed.exceptions, run);
  const report = formatJudgement(run, judgement);
  await test.info().attach('axe-report.txt', { body: report, contentType: 'text/plain' });
  if (judgement.advisory.length || judgement.waived.length) console.log(report);
  expect(judgement.failures.length + judgement.stale.length, report).toBe(0);
}

test('a11y AC-3: the exception file is well-formed (reason, follow-up, known screen and condition)', () => {
  expect(parsed.errors).toEqual([]);
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
