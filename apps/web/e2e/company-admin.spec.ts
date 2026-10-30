// company-admin (docs/specs/company-admin.md AC-7..AC-11): a tenant administrator creates a second company on
// /admin/companies, switches to it, fills the company profile (first card of the company tab), and the printed invoice
// carries it; a user who is not a tenant administrator gets no entry and a refusal; 390px and axe on the new screen.
// Each run creates a company with a fresh code (companies cannot be deleted) in the isolated E2E database.
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { judge, formatJudgement, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { BUSINESS_DATE } from './environment.ts';
import { findScreen, openScreen } from './navigation-helpers.ts';
import { API, api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

test('company-admin AC-9/AC-8/AC-7: create a second company, switch to it, fill the profile and print an invoice', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const code = `E2E-${suffix}`;
  const name = `E2E第二会社 ${suffix}`;
  await signInQuality(page);
  await openScreen(page, '/admin/companies');
  await expect(page.getByRole('heading', { name: '会社の管理', level: 1 })).toBeVisible();

  await page.getByTestId('company-add').click();
  const form = page.getByTestId('company-create-form');
  // AC-3: the form checks the code before sending.
  await form.getByLabel('会社コード', { exact: true }).fill('bad code!');
  await form.getByLabel('会社名', { exact: true }).fill(name);
  await page.getByTestId('company-create-submit').click();
  await expect(form.getByText('英大文字・数字・_・- で 1〜20 文字にしてください')).toBeVisible();
  await expect(form.getByLabel('会社コード', { exact: true })).toBeFocused();
  await form.getByLabel('会社コード', { exact: true }).fill(code.toLowerCase());
  const created = page.waitForResponse((r) => r.url().endsWith('/admin/companies') && r.request().method() === 'POST');
  await page.getByTestId('company-create-submit').click();
  const response = await created;
  expect(response.status()).toBe(200);
  const company = (await response.json()) as { id: string; code: string; seededModules: string[] };
  expect(company.code).toBe(code); // upper-cased before sending
  expect(company.seededModules).toEqual(expect.arrayContaining(['accounting', 'tax', 'l10n_jp']));
  await expect(page.getByTestId('company-created')).toContainText(`${name} を作成しました`);
  await expect(page.getByTestId(`company-row-${code}`)).toContainText('管理者として所属');
  await page.screenshot({ path: test.info().outputPath('company-created-desktop.png'), fullPage: true });

  // AC-9: the company picker already offers the new company.
  const { headers } = await qualitySession(request);
  const picker = await api<{ items: { id: string }[] }>(request, headers, '/auth/companies');
  expect(picker.items.map((c) => c.id)).toContain(company.id);

  // Switch: a fresh page in the new company, on the company tab of the settings console (AC-8).
  await page.getByTestId('company-switch-setup').click();
  await expect(page).toHaveURL(/\/settings\?tab=company$/);
  await expect(page.locator('.company-name')).toContainText(name);
  const tabs = page.getByRole('tablist', { name: '設定の分類' }).getByRole('tab');
  await expect(tabs.first()).toHaveText('会社');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', { name: '会社' });
  const cards = panel.locator('form[data-testid^="setting-"]');
  await expect(cards.first()).toHaveAttribute('data-testid', 'setting-company.profile');
  const profile = page.getByTestId('setting-company.profile');
  await expect(profile).toContainText('未設定');
  await profile.getByLabel('正式名称', { exact: true }).fill(`株式会社E2E第二 ${suffix}`);
  await profile.getByLabel('登録番号（適格請求書）', { exact: true }).fill('T9999999999999');
  await profile.getByLabel('住所', { exact: true }).fill('東京都千代田区丸の内9-9');
  await profile.getByLabel('消費税の課税区分', { exact: true }).selectOption({ label: '課税事業者' });
  await profile.getByLabel('決算月', { exact: true }).fill('3');
  await profile.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('設定を保存しました')).toBeVisible();
  await expect(profile).toContainText('会社の値');

  // AC-7: sales.issuer is unset in the new company, so the printed invoice carries the profile.
  const inNew = { ...headers, 'x-company-id': company.id };
  const partners = await api<{ items: Row[] }>(request, inNew, '/api/partner?limit=50');
  const partner = partners.items.find((p) => p.code === 'C-0001');
  expect(partner, 'the partner seed ran for the new company').toBeDefined();
  const draft = await api(request, inNew, '/api/sales_invoice', {
    date: BUSINESS_DATE,
    partnerId: partner?.id,
    lines: {
      sales_invoice_line: [{ description: `発行者確認 ${suffix}`, unitPrice: '1000', taxCategory: 'standard' }],
    },
  });
  const invoice = await api(request, inNew, `/api/sales_invoice/${draft.id}/submit`, {});
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  const popup = page.waitForEvent('popup');
  await page.getByTestId('print-button').click();
  const printed = await popup;
  await expect(printed.locator('body')).toContainText(`株式会社E2E第二 ${suffix}`);
  await expect(printed.locator('body')).toContainText('T9999999999999');
  await expect(printed.locator('body')).toContainText('東京都千代田区丸の内9-9');
  await printed.close();
});

test('company-admin AC-4/AC-11: rename in the dialog; 390px without horizontal scroll; axe finds no serious issue', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const company = await api<{ id: string; code: string }>(request, headers, '/admin/companies', {
    code: `E2E-R${suffix}`,
    name: `改名前 ${suffix}`,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signInQuality(page);
  await page.goto('/admin/companies');
  const row = page.getByTestId(`company-row-${company.code}`);
  await expect(row).toContainText(`改名前 ${suffix}`);
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('companies-mobile.png'), fullPage: true });
  await row.getByRole('button', { name: `改名前 ${suffix} を編集` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('会社コードと通貨は作成後に変更できません');
  await dialog.getByLabel('会社名', { exact: true }).fill(`改名後 ${suffix}`);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(`改名後 ${suffix}`);
  await expect(page.getByText('会社を更新しました')).toBeVisible();

  // The same axe policy as apps/web/e2e/a11y.spec.ts (serious/critical WCAG A/AA fail unless excepted), ja at 390px
  // and en at 1280px, with the create form open.
  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.reload();
    await expect(page.getByTestId('companies-page')).toBeVisible();
    await page.getByTestId('company-add').click();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'companies', locale: run.locale, width: run.width };
    const judgement = judge(results.violations, exceptions, a11yRun, results.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
  }
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
});

test('company-admin AC-2/AC-10: a company admin who is not a tenant administrator gets no entry and is refused', async ({
  page,
  request,
}) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `company-admin-plain-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `会社管理者 ${suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['admin'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await findScreen(page, '/admin/companies');
  await expect(page.locator('main a[data-screen-href="/admin/companies"]')).toHaveCount(0);
  await page.goto('/admin/companies');
  await expect(page.getByTestId('companies-forbidden')).toContainText('テナント管理者だけ');
  await expect(page.getByTestId('company-add')).toHaveCount(0);
  const login = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  const refused = await request.fetch(`${API}/admin/companies`, {
    method: 'POST',
    headers: { authorization: `Bearer ${login.token}`, 'x-company-id': companyId },
    data: { code: `NOPE-${suffix.toUpperCase()}`.slice(0, 20), name: 'x' },
  });
  expect(refused.status()).toBe(403);
});
