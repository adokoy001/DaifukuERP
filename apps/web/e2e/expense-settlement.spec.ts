// expense-settlement AC-20..AC-23 through the real UI (docs/specs/expense-settlement.md, verification step 5). API setup
// only creates the site, the people and the employee's partner; the expenses are recorded and submitted by the employee
// on /me, approved by the site manager on /workforce, drafted by the accountant (accounting + workforce_payroll) on
// /finance/expenses, completed and submitted on the generic settlement screen, cancelled and amended there.
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { BUSINESS_DATE } from './environment.ts';
import { openScreen } from './navigation-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  {
    documentExists: (path) => existsSync(new URL(path, repoRoot)),
  },
).exceptions;

async function fixture(request: APIRequestContext) {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const site = await api(request, headers, '/api/workforce_site', { code: 'EX-' + suffix, name: '精算拠点 ' + suffix });
  const member = async (name: string, roles: string[], scope: 'sites' | 'all') => {
    const email = `exp-${roles[0]}-${suffix}@example.com`;
    const user = await api(request, headers, '/admin/users', { name: `${name} ${suffix}`, email, password: PASSWORD });
    await api(
      request,
      headers,
      `/admin/users/${user.id}/companies/${companyId}`,
      { expectedVersion: 0, roles, accessScope: scope, siteIds: scope === 'sites' ? [site.id] : [], storeIds: [] },
      'PUT',
    );
    return { ...user, email, name: `${name} ${suffix}` };
  };
  const employee = await member('精算本人', ['workforce_employee'], 'sites');
  const manager = await member('精算拠点長', ['workforce_manager'], 'sites');
  const accountant = await member('経理担当', ['accounting', 'workforce_payroll'], 'all');
  const registered = await api(request, headers, '/actions/workforce.register_employee', {
    userId: employee.id,
    siteId: site.id,
    code: 'EX-' + suffix,
    name: employee.name,
    hiredOn: '2026-01-01',
  });
  const partner = await api(request, headers, '/api/partner', {
    code: 'EXP' + suffix,
    name: `従業員 ${suffix}`,
    isSupplier: true,
  });
  return { headers, companyId, suffix, site, employee, manager, accountant, registered, partner };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** API headers of a fixture member (the employee and the site manager record and approve through their own sessions). */
async function headersOf(request: APIRequestContext, email: string, companyId: string) {
  const session = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  return { authorization: `Bearer ${session.token}`, 'x-company-id': companyId };
}

/** One expense recorded and submitted by the employee and approved by the site manager, all through the API. */
async function approvedExpense(
  request: APIRequestContext,
  f: Fixture,
  description: string,
  amount: string,
  paymentMethod: 'personal' | 'corporate_card' = 'personal',
) {
  const own = await headersOf(request, f.employee.email, f.companyId);
  const manager = await headersOf(request, f.manager.email, f.companyId);
  const saved = await api(request, own, '/actions/workforce.save_expense', {
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
    expenseDate: BUSINESS_DATE,
    category: '交通費',
    description,
    amount,
    evidence: '駅の領収書',
    paymentMethod,
  });
  const submitted = await api(request, own, '/actions/workforce.submit_expense', {
    expenseId: saved.id,
    expectedVersion: saved.version,
  });
  await api(request, manager, '/actions/workforce.review_expense', {
    expenseId: saved.id,
    expectedVersion: submitted.version,
    decision: 'approve',
    reason: '領収書と業務目的を確認',
  });
  return saved.id;
}

const record = (page: Page, text: string): Locator =>
  page.locator('article.workforce-record').filter({ hasText: text });
async function workforceAction(page: Page, name: string, click: () => Promise<void>) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/actions/workforce.' + name) && r.request().method() === 'POST',
  );
  await click();
  const response = await pending;
  expect(response.ok(), name + ': ' + (await response.text())).toBe(true);
}
async function employeeTab(page: Page, label: string) {
  await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: label, exact: true }).click();
}
async function recordExpense(page: Page, purpose: string, amount: string, method: string) {
  await page.getByRole('button', { name: '経費を記録', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('利用日', { exact: true }).fill(BUSINESS_DATE);
  await dialog.getByLabel('経費の区分', { exact: true }).fill('交通費');
  await dialog.getByLabel('精算する金額（円）', { exact: true }).fill(amount);
  await dialog.getByLabel('支払方法', { exact: true }).selectOption({ label: method });
  await dialog.getByLabel('利用目的・内容', { exact: true }).fill(purpose);
  await dialog.getByLabel('証憑の内容・保管場所', { exact: true }).fill('駅の領収書。写真を添付。');
  await workforceAction(page, 'save_expense', () =>
    dialog.getByRole('button', { name: '下書きを保存', exact: true }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await workforceAction(page, 'submit_expense', () =>
    record(page, purpose).getByRole('button', { name: '経費を提出', exact: true }).click(),
  );
  await expect(record(page, purpose)).toContainText(method);
}
async function pickRef(cell: Locator, search: string, name: string) {
  await cell.getByRole('combobox').fill(search);
  const option = cell.getByRole('option').filter({ hasText: name }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(cell.getByRole('combobox')).toHaveValue(name);
}
async function confirmDoc(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
}

test('expense-settlement AC-20 AC-21 AC-22: record, approve, draft, submit with entry and payment, cancel and amend', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const f = await fixture(request);
  const personal = 'E2E 立替 ' + f.suffix;
  const card = 'E2E カード ' + f.suffix;

  // AC-22: the employee records one personal and one corporate-card expense on /me (390px) and submits them.
  await page.setViewportSize({ width: 390, height: 844 });
  await signInQuality(page, f.employee.email, PASSWORD);
  await expect(page).toHaveURL(/\/me$/);
  await employeeTab(page, '経費');
  await recordExpense(page, personal, '1100', '立替');
  await recordExpense(page, card, '2200', '法人カード');
  await assertNoOverflow(page);

  // The site manager approves both on /workforce.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInQuality(page, f.manager.email, PASSWORD);
  await page.goto('/workforce?tab=expenses');
  for (const purpose of [personal, card]) {
    await record(page, purpose).getByRole('button', { name: '承認する', exact: true }).click();
    await page.getByRole('dialog').getByLabel('確認した内容・理由').fill('領収書と業務目的を確認');
    await workforceAction(page, 'review_expense', () =>
      page.getByRole('dialog').getByRole('button', { name: '経費を承認', exact: true }).click(),
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  // AC-22: the accountant sees the approved rows on /workforce with a way to the settlement screen.
  await signInQuality(page, f.accountant.email, PASSWORD);
  await page.goto('/workforce?tab=expenses');
  await record(page, personal).getByTestId('expense-to-settlement').click();
  await expect(page).toHaveURL(/\/finance\/expenses$/);

  // AC-20: grouped by employee x payment method x site; "create" drafts the group and opens the settlement.
  const groups = page.getByTestId('expense-group').filter({ hasText: f.employee.name });
  await expect(groups).toHaveCount(2);
  const reimbursement = groups.filter({ hasText: '立替' });
  await expect(reimbursement).toContainText('1 件');
  await expect(reimbursement).toContainText('¥1,100');
  await reimbursement.getByTestId('expense-create').click();
  await expect(page).toHaveURL(/\/e\/expense_settlement\/[0-9a-f-]{36}$/);
  const settlementId = page.url().slice(page.url().lastIndexOf('/') + 1);

  // AC-21: the generic screen: labelled sections, the line grid with copied (read-only) fields, then submit.
  const form = page.getByTestId('record-form');
  for (const section of ['基本', '支払', '金額', '転記', '備考'])
    await expect(form.getByRole('group', { name: section, exact: true })).toBeVisible();
  const grid = page.getByTestId('lines-expense_settlement_line');
  const line = grid.getByTestId('line-row').first();
  // AC-23: the tax category choices are named, not raw codes
  const taxCategory = line.locator('td[data-field="taxCategory"] select');
  await expect(taxCategory.locator('option', { hasText: '課税（標準）' })).toHaveCount(1);
  await expect(taxCategory.locator('option', { hasText: 'standard' })).toHaveCount(0);
  // copied from the expense, server-owned: shown read-only
  await expect(line.locator('td[data-field="description"]').getByRole('textbox')).toHaveValue(personal);
  await expect(line.locator('td[data-field="description"]').getByRole('textbox')).toBeDisabled();
  await expect(line.locator('td[data-field="taxAmount"]').getByRole('textbox')).toBeDisabled();
  await pickRef(form.locator('div[data-field="partnerId"]'), f.partner.name as string, f.partner.name as string);
  await line.locator('td[data-field="payeeName"] input').fill('JR東日本');
  await line.locator('td[data-field="invoiceKind"] select').selectOption('qualified');
  await line.locator('td[data-field="invoiceRegistrationNo"] input').fill('T1234567890123');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('保存しました').first()).toBeVisible();
  await confirmDoc(page, '確定');
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');
  await expect(grid).toHaveAttribute('data-readonly', 'true');
  const related = page.getByTestId('related-panel');
  await expect(related.getByTestId('related-group-journal_entry')).toBeVisible();
  await expect(related.getByTestId('related-group-payment')).toBeVisible();
  await expect(page.getByTestId('attachments-panel')).toBeVisible();
  const submitted = await api<Row & { number: string; paymentId: string; journalEntryId: string }>(
    request,
    f.headers,
    `/api/expense_settlement/${settlementId}`,
  );
  expect(submitted.number).toMatch(/^EXP-/);
  const payment = await api<Row & { amount: string; counterAccountId: string }>(
    request,
    f.headers,
    `/api/payment/${submitted.paymentId}`,
  );
  expect(payment.amount).toBe('1100');

  // AC-22: the employee sees the expense settled with the settlement number.
  await signInQuality(page, f.employee.email, PASSWORD);
  await employeeTab(page, '経費');
  await expect(record(page, personal)).toContainText('精算済み');
  await expect(record(page, personal).getByTestId('expense-settled')).toContainText(submitted.number);

  // AC-21: cancel (entry reversed, payment cancelled) and amend (a new draft with the lines copied).
  await signInQuality(page, f.accountant.email, PASSWORD);
  await page.goto(`/e/expense_settlement/${settlementId}`);
  await confirmDoc(page, '取消');
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '2');
  expect((await api<Row>(request, f.headers, `/api/payment/${submitted.paymentId}`)).docstatus).toBe(2);
  await confirmDoc(page, '訂正');
  await expect(page).not.toHaveURL(new RegExp(settlementId));
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '0');
  await expect(page.getByTestId('lines-expense_settlement_line').getByTestId('line-row')).toHaveCount(1);

  // AC-21: an advance recorded through the API shows its payout payment in the related records.
  const advance = await api(request, f.headers, '/api/expense_advance', {
    employeeId: f.registered.id,
    partnerId: f.partner.id,
    date: BUSINESS_DATE,
    amount: '5000',
    purpose: 'E2E 仮払',
  });
  await api(request, f.headers, `/api/expense_advance/${advance.id}/submit`, {});
  await page.goto(`/e/expense_advance/${advance.id}`);
  await expect(page.getByTestId('related-panel').getByTestId('related-group-payment')).toBeVisible();

  // D24 from the dedicated screen: an unused advance is cleared by an advance settlement without lines (full refund).
  await page.goto('/finance/expenses');
  await page
    .getByTestId('expense-advances')
    .locator('li')
    .filter({ hasText: f.employee.name })
    .getByTestId('expense-clear-advance')
    .click();
  await expect(page).toHaveURL(/\/e\/expense_settlement\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('lines-expense_settlement_line').getByTestId('line-row')).toHaveCount(0);
  await confirmDoc(page, '確定');
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');
  await expect(page.getByTestId('related-panel').getByTestId('related-group-payment')).toBeVisible();
  expect((await api<Row & { status: string }>(request, f.headers, `/api/expense_advance/${advance.id}`)).status).toBe(
    'settled',
  );
});

test('expense-settlement AC-20 AC-23: roles, English, 390px without horizontal scroll and axe', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  // AC-20: accounting without workforce_payroll is told which roles are needed.
  const { headers, companyId } = await qualitySession(request);
  const email = `exp-acct-only-${f.suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', { name: `経理のみ ${f.suffix}`, email, password: PASSWORD });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['accounting'], accessScope: 'all', siteIds: [], storeIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await page.goto('/finance/expenses');
  await expect(page.getByTestId('expense-forbidden')).toContainText('workforce_payroll');

  // AC-23 checks a populated screen: this test records its own waiting group (personal) and drafted-only group
  // (corporate card, already in a draft), so it does not depend on what other tests left behind.
  await approvedExpense(request, f, 'E2E 390 ' + f.suffix, '1100');
  const drafted = await approvedExpense(request, f, 'E2E 下書き ' + f.suffix, '550', 'corporate_card');
  const accountant = await headersOf(request, f.accountant.email, f.companyId);
  const draft = await api<{ id: string }>(request, accountant, '/actions/expense.draft_settlement', {
    employeeId: f.registered.id,
    kind: 'corporate_card',
    expenseIds: [drafted],
  });
  await signInQuality(page, f.accountant.email, PASSWORD);
  await openScreen(page, '/finance/expenses');
  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.goto('/finance/expenses');
    await expect(page.getByTestId('expense-settlement-page')).toBeVisible();
    const group = page.getByTestId('expense-group').filter({ hasText: f.employee.name });
    await expect(group).toBeVisible();
    await expect(group.getByTestId('expense-create')).toBeVisible();
    await expect(page.getByTestId('expense-drafted').locator('li').filter({ hasText: f.employee.name })).toBeVisible();
    await page.waitForLoadState('networkidle');
    if (run.locale === 'en') {
      await expect(page.getByRole('heading', { name: 'Expense settlement', level: 1 })).toBeVisible();
      await expect(group).toContainText('Paid personally');
    } else {
      await expect(page.getByRole('heading', { name: '経費精算', level: 1 })).toBeVisible();
      await expect(group).toContainText('立替');
      await assertNoOverflow(page);
      await page.screenshot({ path: test.info().outputPath('expenses-mobile.png'), fullPage: true });
    }
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'expenses', locale: run.locale, width: run.width };
    const judgement = judge(results.violations, exceptions, a11yRun, results.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
  }
  // AC-23 on the generic settlement screen in English: the tax categories are named in English too.
  await page.goto(`/e/expense_settlement/${draft.id}`);
  const taxCategory = page
    .getByTestId('lines-expense_settlement_line')
    .getByTestId('line-row')
    .first()
    .locator('td[data-field="taxCategory"] select');
  await expect(taxCategory.locator('option', { hasText: 'Taxable (standard)' })).toHaveCount(1);
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
});

test('expense-settlement AC-15 AC-20: an accountant with own approved expenses cannot draft them here', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  // The accountant is also an employee of the site with an approved expense of their own.
  await api(request, f.headers, '/actions/workforce.register_employee', {
    userId: f.accountant.id,
    siteId: f.site.id,
    code: 'EXA-' + f.suffix,
    name: f.accountant.name,
    hiredOn: '2026-01-01',
  });
  const selfHeaders = await headersOf(request, f.accountant.email, f.companyId);
  const manager = await headersOf(request, f.manager.email, f.companyId);
  const saved = await api(request, selfHeaders, '/actions/workforce.save_expense', {
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
    expenseDate: BUSINESS_DATE,
    category: '交通費',
    description: 'E2E 自分 ' + f.suffix,
    amount: '700',
    evidence: '駅の領収書',
  });
  const submitted = await api(request, selfHeaders, '/actions/workforce.submit_expense', {
    expenseId: saved.id,
    expectedVersion: saved.version,
  });
  await api(request, manager, '/actions/workforce.review_expense', {
    expenseId: saved.id,
    expectedVersion: submitted.version,
    decision: 'approve',
    reason: '領収書と業務目的を確認',
  });
  await approvedExpense(request, f, 'E2E 他人 ' + f.suffix, '1100');
  await signInQuality(page, f.accountant.email, PASSWORD);
  await page.goto('/finance/expenses');
  const mine = page.getByTestId('expense-group').filter({ hasText: f.accountant.name });
  await expect(mine).toHaveAttribute('data-self', 'true');
  await expect(mine.getByTestId('expense-blocked')).toContainText('自分の経費は別の担当者が精算します');
  await expect(mine.getByTestId('expense-create')).toHaveCount(0);
  const theirs = page.getByTestId('expense-group').filter({ hasText: f.employee.name });
  await expect(theirs.getByTestId('expense-create')).toBeVisible();
});
