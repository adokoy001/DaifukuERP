// print-templates (docs/specs/print-templates.md AC-3, AC-4, AC-23〜AC-25): the record page offers the print buttons
// that /meta declares (quotation, receipt or payment notice by direction, statement on a customer, payslip on /me),
// each opens the document in a new tab, sales orders and drafts get no button, the statement asks for its closing
// date in a bilingual dialog (a day that is not a closing date is explained under the field), 390px without horizontal
// scroll (record page, dialog and the printed document), and axe with the dialog open. Data is created through the
// API in synthetic companies (financeFixture) and a fresh employee (qualityEmployee).
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { formatJudgement, judge, parseExceptions, WCAG_TAGS, type A11yRun } from './a11y-policy.ts';
import { BUSINESS_DATE } from './environment.ts';
import { financeFixture, financeInvoice, financeOrder, submitFinance } from './finance-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualityEmployee, signInQuality } from './quality-helpers.ts';

test.setTimeout(240_000);

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

const printButton = (page: Page, action: string) =>
  page.locator(`[data-testid="print-button"][data-print-action="${action}"]`);

/** Clicks a print button and returns the opened tab once its document has rendered. */
async function openPrint(page: Page, click: () => Promise<void>, heading: string): Promise<Page> {
  const popup = page.waitForEvent('popup');
  await click();
  const printed = await popup;
  await expect(printed.locator('h1')).toHaveText(heading);
  await expect(printed.locator('.daifuku-print-bar')).toBeVisible();
  return printed;
}

function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

test('print-templates AC-3/AC-23: quotation, receipt and payment notice open from their record pages; sales orders and drafts get none', async ({
  page,
  request,
}) => {
  const fixture = await financeFixture(request);
  const quotation = await financeOrder(request, fixture, 'sales', true);
  const salesOrder = await financeOrder(request, fixture, 'sales');
  const draftQuote = await api(request, fixture.headers, '/api/trade_quotation', {
    partnerId: fixture.partner.id,
    date: BUSINESS_DATE,
    lines: {
      trade_quotation_line: [
        {
          productId: fixture.product.id,
          description: '下書き見積',
          quantity: '1',
          unitPrice: '1000',
          taxCategory: 'standard',
        },
      ],
    },
  });
  const payment = async (direction: 'receive' | 'pay', amount: string) => {
    const row = await api(request, fixture.headers, '/api/payment', {
      direction,
      partnerId: fixture.partner.id,
      date: BUSINESS_DATE,
      amount,
      method: 'cash',
      lines: { payment_allocation: [] },
    });
    return submitFinance(request, fixture.headers, 'payment', row.id);
  };
  const receipt = await payment('receive', '5000');
  const disbursement = await payment('pay', '3000');
  await signInQuality(page, fixture.email, PASSWORD);

  await page.goto(`/e/trade_quotation/${quotation.id}`);
  await expect(printButton(page, 'trade.render_quotation_html')).toHaveText('見積書を表示');
  const quote = await openPrint(page, () => printButton(page, 'trade.render_quotation_html').click(), '見積書');
  await expect(quote.locator('body')).toContainText(String(quotation.number));
  await expect(quote.locator('body')).toContainText(String(fixture.partner.name));
  await quote.close();

  await page.goto(`/e/payment/${receipt.id}`);
  await expect(printButton(page, 'payment.render_receipt_html')).toHaveText('領収書を表示');
  await expect(printButton(page, 'payment.render_payment_notice_html')).toHaveCount(0);
  const printedReceipt = await openPrint(
    page,
    () => printButton(page, 'payment.render_receipt_html').click(),
    '領収書',
  );
  await expect(printedReceipt.locator('body')).toContainText('5,000円');
  await expect(printedReceipt.locator('body')).toContainText('前受金（未消込）');
  await printedReceipt.close();

  await page.goto(`/e/payment/${disbursement.id}`);
  await expect(printButton(page, 'payment.render_payment_notice_html')).toHaveText('支払通知書を表示');
  await expect(printButton(page, 'payment.render_receipt_html')).toHaveCount(0);
  const notice = await openPrint(
    page,
    () => printButton(page, 'payment.render_payment_notice_html').click(),
    '支払通知書',
  );
  await expect(notice.locator('body')).toContainText('3,000円');
  await notice.close();

  // A sales order has no printed document (注文請書 is out of scope); a draft quotation gets no button.
  await page.goto(`/e/trade_order/${salesOrder.id}`);
  await expect(page.getByTestId('record-form')).toBeVisible();
  await expect(page.getByTestId('print-button')).toHaveCount(0);
  await page.goto(`/e/trade_quotation/${draftQuote.id}`);
  await expect(page.getByTestId('record-form')).toBeVisible();
  await expect(page.getByTestId('print-button')).toHaveCount(0);
});

test('print-templates AC-4/AC-23/AC-25: the statement dialog asks for a closing date in ja and en, explains a wrong day, 390px and axe', async ({
  page,
  request,
}) => {
  const fixture = await financeFixture(request);
  const invoice = (await financeInvoice(request, fixture, 'sales')) as Row & { number: string };
  await signInQuality(page, fixture.email, PASSWORD);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/e/partner/${fixture.partner.id}`);
  const button = printButton(page, 'sales.render_statement_html');
  await expect(button).toHaveText('合計請求書を表示');
  await assertNoOverflow(page);
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('合計請求書を表示');
  const closing = dialog.getByLabel('締め日', { exact: true });
  await expect(closing).toBeVisible();
  await expect(dialog).toContainText('空欄なら今日以前の直近の締め日を使います');
  await assertNoOverflow(page);

  // A day that is not a closing date (the partner closes at month end): VALIDATION under the field, dialog stays.
  const wrongDay = `${BUSINESS_DATE.slice(0, 7)}-15`;
  await closing.fill(wrongDay);
  const refused = page.waitForResponse((r) => r.url().endsWith('/actions/sales.render_statement_html'));
  await dialog.getByTestId('print-dialog-submit').click();
  expect((await refused).status()).toBe(400);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('not a closing date');

  // The month end of the business month: the statement lists the invoice of this period.
  await closing.fill(monthEnd(BUSINESS_DATE));
  const statement = await openPrint(page, () => dialog.getByTestId('print-dialog-submit').click(), '合計請求書');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(statement.locator('body')).toContainText(invoice.number);
  await expect(statement.locator('body')).toContainText('当期ご請求額合計（税込）');
  // AC-25: the printed document has a viewport; at 390px only the tables scroll inside their frames.
  await statement.setViewportSize({ width: 390, height: 844 });
  expect(
    await statement.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
  await statement.close();

  // axe with the dialog open: ja at 390px, en at 1280px (labels and help text from the print declaration).
  for (const run of [
    { locale: 'ja', width: 390 },
    { locale: 'en', width: 1280 },
  ] as const) {
    await page.setViewportSize({ width: run.width, height: 844 });
    await page.evaluate((locale) => localStorage.setItem('daifuku.locale', locale), run.locale);
    await page.reload();
    await printButton(page, 'sales.render_statement_html').click();
    const open = page.getByRole('dialog');
    if (run.locale === 'en') {
      await expect(printButton(page, 'sales.render_statement_html')).toHaveText('View statement');
      await expect(open.getByLabel('Closing date', { exact: true })).toBeVisible();
      await expect(open).toContainText('Leave blank to use the latest closing date up to today');
      await expect(open.getByTestId('print-dialog-submit')).toHaveText('View');
    } else await expect(open.getByLabel('締め日', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    const a11yRun: A11yRun = { screen: 'print-statement-dialog', locale: run.locale, width: run.width };
    const judgement = judge(results.violations, exceptions, a11yRun, results.incomplete);
    expect(judgement.failures, formatJudgement(a11yRun, judgement)).toEqual([]);
  }
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));
});

test('print-templates AC-24: an employee opens their confirmed payslip from /me', async ({ page, request }) => {
  const own = await qualityEmployee(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const payrollEmail = `print-payroll-${suffix}@example.com`;
  const payrollUser = await api(request, own.headers, '/admin/users', {
    name: '帳票給与本部 ' + suffix,
    email: payrollEmail,
    password: PASSWORD,
  });
  await api(
    request,
    own.headers,
    `/admin/users/${payrollUser.id}/companies/${own.companyId}`,
    { expectedVersion: 0, roles: ['workforce_payroll'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  const session = await api<{ token: string }>(request, {}, '/auth/login', { email: payrollEmail, password: PASSWORD });
  const payroll = { authorization: 'Bearer ' + session.token, 'x-company-id': own.companyId };
  const previous = new Date(BUSINESS_DATE + 'T00:00:00Z');
  previous.setUTCDate(0);
  const period = previous.toISOString().slice(0, 7);
  const policies = await api<{ items: Row[] }>(request, own.headers, '/api/workforce_pay_policy?limit=100');
  const policy = policies.items[0] as Row & { validTo: string };
  await api(request, own.headers, '/api/workforce_pay_terms', {
    employeeId: own.employee.id,
    policyId: policy.id,
    validFrom: '2026-01-01',
    validTo:
      policy.validTo < `${BUSINESS_DATE.slice(0, 4)}-12-31` ? policy.validTo : `${BUSINESS_DATE.slice(0, 4)}-12-31`,
    payType: 'monthly',
    hourlyRate: '0',
    monthlySalary: '200000',
    monthlyBaseMinutes: 9600,
    paidLeaveDayMinutes: 480,
    confirmed: true,
    basis: 'E2E only: signed monthly conditions',
  });
  const draft = await api(request, payroll, '/actions/workforce.calculate_payroll', {
    employeeId: own.employee.id,
    period,
    attendanceCompleteConfirmed: true,
  });
  const kinds = [
    'income_tax',
    'resident_tax',
    'health_insurance',
    'nursing_insurance',
    'pension',
    'employment_insurance',
    'child_support',
    'other',
  ];
  await api(request, payroll, '/actions/workforce.confirm_payroll', {
    payrollId: draft.id,
    expectedVersion: draft.version,
    deductions: kinds.map((kind) => ({
      kind,
      amount: '0',
      basis: 'E2E synthetic payroll: not applicable',
      confirmed: true,
    })),
    allowances: [],
    calculationConfirmed: true,
    reason: 'E2E synthetic payroll reviewed',
  });

  await signInQuality(page, own.email, PASSWORD);
  await expect(page).toHaveURL(/\/me$/);
  await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: '給与', exact: true }).click();
  await page.getByLabel('表示する月').fill(period);
  const button = printButton(page, 'workforce.render_payslip_html');
  await expect(button).toHaveText('給与明細を表示');
  const slip = await openPrint(page, () => button.click(), '給与明細');
  await expect(slip.locator('body')).toContainText('品質検証');
  await expect(slip.locator('body')).toContainText('差引支給額');
  await slip.close();
});
