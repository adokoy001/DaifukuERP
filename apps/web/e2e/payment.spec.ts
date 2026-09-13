// web-phase15 AC-5: receive a payment against a sales invoice through the real UI. The invoice is set up through the API
// (spec: "via API for speed is acceptable"); the payment is entered, allocated with the outstanding panel (AC-1),
// checked for the 配分合計 > 金額 refusal (AC-2), saved and submitted in the UI; the invoice's paid status and zero balance
// are then read back through the API. Requires `pnpm dev:api` (seeded dev DB: partners, accounts, tax rates) and the web.
// Set E2E_SCREENSHOTS=1 to save screenshots in Playwright's per-test artifact directory.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const API = (process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const SHOTS = process.env.E2E_SCREENSHOTS === '1';

interface Rec {
  id: string;
  [field: string]: unknown;
}

interface Api {
  get: (path: string) => Promise<Rec>;
  post: (path: string, body: unknown) => Promise<Rec>;
}

async function apiSession(request: APIRequestContext): Promise<Api> {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  expect(login.status(), 'API login').toBe(200);
  const { token, user } = (await login.json()) as { token: string; user: { defaultCompanyId: string | null } };
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...(user.defaultCompanyId ? { 'x-company-id': user.defaultCompanyId } : {}),
  };
  const check = async (res: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<Rec> => {
    const body = (await res.json()) as Rec;
    expect(res.ok(), `${what} -> ${res.status()} ${JSON.stringify(body)}`).toBe(true);
    return body;
  };
  return {
    get: async (path) => check(await request.get(`${API}${path}`, { headers }), `GET ${path}`),
    post: async (path, body) => check(await request.post(`${API}${path}`, { headers, data: body }), `POST ${path}`),
  };
}

/** A submitted, open sales invoice with one line for a seeded partner (C-0001 when present). */
async function openInvoice(api: Api): Promise<{ invoice: Rec; partnerName: string }> {
  const partners = (await api.get('/api/partner?limit=50')) as unknown as { items: Rec[] };
  const partner = partners.items.find((p) => p.code === 'C-0001') ?? partners.items[0];
  if (!partner) throw new TypeError('no seeded partner: prepare the dedicated E2E fixture from CONTRIBUTING.md');
  const line = { description: `E2E 消込 ${Date.now()}`, quantity: '1', unitPrice: '1000', taxCategory: 'standard' };
  const draft = await api.post('/api/sales_invoice', {
    date: BUSINESS_DATE,
    partnerId: partner.id,
    lines: { sales_invoice_line: [line] },
  });
  const invoice = await api.post(`/api/sales_invoice/${draft.id}/submit`, {});
  expect(invoice.status).toBe('open');
  return { invoice, partnerName: String(partner.name) };
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
}

/** Types into the ref combobox of `cell` and picks the option whose text starts with `name`. */
async function pickRef(cell: Locator, search: string, name: string): Promise<void> {
  await cell.getByRole('combobox').fill(search);
  const option = cell.getByRole('option').filter({ hasText: name }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(cell.getByRole('combobox')).toHaveValue(name);
}

/**
 * Replaces the value of a formatted decimal input the way a user does (click, select all, type). Playwright's `fill`
 * selects before it focuses; Chrome then re-applies that selection after the input swapped "1,100" for its raw "1100"
 * on focus, which collapses it and appends the typed text — Tab and Ctrl+A (what users do) are not affected.
 */
async function retype(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.pressSequentially(value);
  await expect(input).toHaveAttribute('data-raw', value);
}

/** Optional artifacts stay in Playwright's per-test directory. */
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const toasts = page.locator('[aria-live="polite"]').getByRole('button', { name: '閉じる' });
  while ((await toasts.count()) > 0) await toasts.first().click();
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

test('AC-5: receive payment -> pick the invoice from the outstanding panel -> submit -> invoice paid', async ({
  page,
  request,
}) => {
  const api = await apiSession(request);
  const { invoice, partnerName } = await openInvoice(api);
  const balance = String(invoice.balance);
  const number = String(invoice.number);

  await login(page);
  await page.goto('/e/payment/new');
  const form = page.getByTestId('record-form');
  await expect(form).toHaveAttribute('data-mode', 'create');
  await form.locator('div[data-field="direction"] select').selectOption('receive');
  await form.locator('div[data-field="date"] input').fill(BUSINESS_DATE);
  await pickRef(form.locator('div[data-field="partnerId"]'), partnerName, partnerName);
  await form.locator('div[data-field="amount"] input').fill(balance);
  await pickRef(form.locator('div[data-field="accountId"]'), '普通預金', '普通預金');

  // AC-1: the panel lists the open invoice with its balance; checking it defaults the amount to min(balance, 未配分).
  const grid = page.getByTestId('lines-payment_allocation');
  await grid.getByRole('button', { name: '未消込の請求書から選ぶ' }).click();
  const panel = grid.getByTestId('outstanding-panel');
  const row = panel.locator(`tr[data-number="${number}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(String(invoice.date));
  await row.getByRole('checkbox', { name: `選択 ${number}` }).check();
  await expect(row.getByRole('textbox', { name: `消込額 ${number}` })).toHaveAttribute('data-raw', balance);
  await shot(page, 'web-phase15-allocation-panel');
  await panel.getByRole('button', { name: '選択した請求書を追加' }).click();
  await expect(panel).toHaveCount(0);

  // The grid received invoiceEntity / invoiceId / amount; 配分合計 = balance, 未配分 = 0.
  const lines = grid.getByTestId('line-row');
  await expect(lines).toHaveCount(1);
  await expect(lines.first().locator('td[data-field="invoiceEntity"] select')).toHaveValue('sales_invoice');
  await expect(lines.first().locator('td[data-field="invoiceId"] input')).toHaveValue(invoice.id);
  await expect(lines.first().getByTestId('target-link')).toHaveText(number);
  await expect(grid.getByTestId('allocation-allocated')).toHaveAttribute('data-value', balance);
  await expect(grid.getByTestId('allocation-unallocated')).toHaveAttribute('data-value', '0');

  // AC-2: 配分合計 > 金額 is refused before any request.
  const amount = form.locator('div[data-field="amount"] input');
  await retype(amount, '1');
  await expect(grid.getByTestId('allocation-summary')).toHaveAttribute('data-over', 'true');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(form.getByRole('alert').filter({ hasText: '配分合計が金額を超えています' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/e\/payment\/new$/);
  await retype(amount, balance);
  await expect(grid.getByTestId('allocation-summary')).toHaveAttribute('data-over', 'false');

  // Save (header + allocation line in one request), then 確定.
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page).toHaveURL(/\/e\/payment\/[0-9a-f-]{36}$/);
  const paymentId = page.url().slice(page.url().lastIndexOf('/') + 1);
  await expect(page.getByTestId('lines-payment_allocation').getByTestId('line-row')).toHaveCount(1);
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');
  await expect(page.getByTestId('lines-payment_allocation')).toHaveAttribute('data-readonly', 'true');
  await expect(page.getByTestId('lines-payment_allocation').getByTestId('target-link')).toHaveText(number);
  await shot(page, 'web-phase15-payment-submitted');

  // Read back through the API: the payment is submitted and fully allocated; the invoice is paid with balance 0.
  const payment = await api.get(`/api/payment/${paymentId}`);
  expect(payment.docstatus).toBe(1);
  expect(payment.unallocatedAmount).toBe('0');
  const paid = await api.get(`/api/sales_invoice/${invoice.id}`);
  expect(paid.status).toBe('paid');
  expect(paid.balance).toBe('0');
  expect(paid.paidAmount).toBe(balance);

  await page.goto(`/e/sales_invoice/${invoice.id}`);
  await expect(page.getByTestId('record-form').locator('div[data-field="status"] select')).toHaveValue('paid');
  await expect(page.getByTestId('record-form').locator('div[data-field="balance"] input')).toHaveValue('0');
  await shot(page, 'web-phase15-invoice-paid');
});

test('AC-2: a saved draft whose allocations exceed its amount cannot be submitted from the UI', async ({
  page,
  request,
}) => {
  const api = await apiSession(request);
  const first = await openInvoice(api);
  const second = await openInvoice(api);
  // Each line is within its invoice balance and the payment amount; only the sum is over (the server checks Σ at submit).
  const allocation = (inv: Rec) => ({ invoiceEntity: 'sales_invoice', invoiceId: inv.id, amount: String(inv.balance) });
  const payment = await api.post('/api/payment', {
    date: BUSINESS_DATE,
    direction: 'receive',
    partnerId: first.invoice.partnerId,
    amount: '1500',
    lines: { payment_allocation: [allocation(first.invoice), allocation(second.invoice)] },
  });
  expect(payment.docstatus).toBe(0);

  await login(page);
  await page.goto(`/e/payment/${payment.id}`);
  const grid = page.getByTestId('lines-payment_allocation');
  await expect(grid.getByTestId('line-row')).toHaveCount(2);
  await expect(grid.getByTestId('allocation-summary')).toHaveAttribute('data-over', 'true');
  await expect(page.getByTestId('submit-blocked')).toContainText('配分合計が金額を超えているため確定できません');
  await expect(page.getByRole('button', { name: '確定', exact: true })).toBeDisabled();
});
