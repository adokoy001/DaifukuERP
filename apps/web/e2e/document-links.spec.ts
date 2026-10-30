// document-links AC-1..AC-8 through the real UI: duplicate a submitted sales invoice into a new draft, record its receipt
// with the quick action (prefilled direction / partner / outstanding amount / allocation line) and submit it, see the
// receipt and the journal entry in the invoice's 関連 panel, refuse a duplicate of a record that changed after it was
// shown, and use the panel and the actions at 390px. Invoices are set up through the API (as in payment.spec.ts).
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';
import { api, type Headers, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualityPartner, qualitySession, signInQuality } from './quality-helpers.ts';

interface Invoice extends Row {
  number: string;
  balance: string;
  partnerId: string;
  journalEntryId: string;
  date: string;
}

async function draftInvoice(request: APIRequestContext, headers: Headers, partnerId: string, note: string) {
  return api<Invoice>(request, headers, '/api/sales_invoice', {
    date: BUSINESS_DATE,
    partnerId,
    note,
    lines: {
      sales_invoice_line: [{ description: `C2 ${note}`, quantity: '2', unitPrice: '1500', taxCategory: 'standard' }],
    },
  });
}

async function openInvoice(request: APIRequestContext, headers: Headers, partnerId: string, note: string) {
  const draft = await draftInvoice(request, headers, partnerId, note);
  return api<Invoice>(request, headers, `/api/sales_invoice/${draft.id}/submit`, {});
}

/** Types into the ref combobox of `cell` and picks the option whose text contains `name`. */
async function pickRef(cell: Locator, search: string, name: string): Promise<void> {
  await cell.getByRole('combobox').fill(search);
  const option = cell.getByRole('option').filter({ hasText: name }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(cell.getByRole('combobox')).toHaveValue(name);
}

async function closeToasts(page: Page): Promise<void> {
  const toasts = page.locator('[aria-live="polite"]').getByRole('button', { name: '閉じる' });
  while ((await toasts.count()) > 0) await toasts.first().click();
}

test('document-links AC-1/AC-4: duplicate a submitted invoice -> new draft with copied lines, today and no number', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, 'C2 複製先 ' + crypto.randomUUID().slice(0, 8));
  const source = await openInvoice(request, headers, partner.id, 'monthly ' + crypto.randomUUID().slice(0, 6));

  await signInQuality(page);
  await page.goto(`/e/sales_invoice/${source.id}`);
  // AC-4: the related panel loads beside the form; the posting journal entry and the customer are listed
  const panel = page.getByTestId('related-panel');
  await expect(panel.getByRole('heading', { name: '関連', exact: true })).toBeVisible();
  const entries = panel.getByTestId('related-group-journal_entry');
  await expect(entries.locator(`[data-id="${source.journalEntryId}"]`)).toBeVisible();
  await expect(panel.getByTestId('related-group-partner')).toContainText(String(partner.name));

  await page.getByTestId('duplicate-record').click();
  await expect(page).toHaveURL(/\/e\/sales_invoice\/new$/);
  const notice = page.getByTestId('seed-notice');
  await expect(notice).toContainText(source.number);
  await expect(notice).toContainText(`元の日付 ${source.date}`);
  await expect(notice).toContainText('保存するまで記録は作成されません');
  const form = page.getByTestId('record-form');
  await expect(form).toHaveAttribute('data-mode', 'create');
  await expect(form).toHaveAttribute('data-dirty', 'false');
  await expect(form.locator('div[data-field="partnerId"]').getByRole('combobox')).toHaveValue(String(partner.name));
  await expect(form.locator('div[data-field="date"] input')).toHaveValue(BUSINESS_DATE);
  await expect(form.locator('div[data-field="note"] textarea')).toHaveValue(String(source.note));
  const rows = page.getByTestId('lines-sales_invoice_line').getByTestId('line-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td[data-field="description"] input')).toHaveValue(`C2 ${String(source.note)}`);
  // AC-1: nothing exists until saved — the source's partner still has exactly one invoice
  const before = await api<{ total: number }>(
    request,
    headers,
    `/api/sales_invoice?where=${encodeURIComponent(JSON.stringify({ partnerId: partner.id }))}`,
  );
  expect(before.total).toBe(1);

  await form.getByRole('button', { name: '保存' }).click();
  await expect(page).toHaveURL(/\/e\/sales_invoice\/[0-9a-f-]{36}$/);
  const copyId = page.url().slice(page.url().lastIndexOf('/') + 1);
  expect(copyId).not.toBe(source.id);
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '0');
  const copy = await api<Invoice & { lines: { sales_invoice_line: Row[] } }>(
    request,
    headers,
    `/api/sales_invoice/${copyId}`,
  );
  expect(copy).toMatchObject({ docstatus: 0, number: null, amendedFrom: null, status: 'draft', date: BUSINESS_DATE });
  expect(copy.journalEntryId).toBeNull();
  expect(copy.lines.sales_invoice_line).toHaveLength(1);
  expect(copy.lines.sales_invoice_line[0]).toMatchObject({ description: `C2 ${String(source.note)}`, quantity: '2' });
  expect(copy.total).toBe(source.total);
  // the saved copy replaced the prefilled /new entry: Back returns to the source, not to a second prefilled form
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/e/sales_invoice/${source.id}$`));
});

test('document-links AC-5/AC-4: record receipt from an invoice -> prefilled payment -> submit -> invoice paid, panel lists it', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, 'C2 入金先 ' + crypto.randomUUID().slice(0, 8));
  const invoice = await openInvoice(request, headers, partner.id, 'receipt ' + crypto.randomUUID().slice(0, 6));

  await signInQuality(page);
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  await page.getByTestId('quick-action-sales_invoice.record_receipt').click();
  await expect(page).toHaveURL(/\/e\/payment\/new$/);
  await expect(page.getByTestId('seed-notice')).toContainText(invoice.number);
  const form = page.getByTestId('record-form');
  await expect(form.locator('div[data-field="direction"] select')).toHaveValue('receive');
  await expect(form.locator('div[data-field="partnerId"]').getByRole('combobox')).toHaveValue(String(partner.name));
  await expect(form.locator('div[data-field="amount"] input')).toHaveAttribute('data-raw', invoice.balance);
  await expect(form.locator('div[data-field="date"] input')).toHaveValue(BUSINESS_DATE);
  const grid = page.getByTestId('lines-payment_allocation');
  const line = grid.getByTestId('line-row');
  await expect(line).toHaveCount(1);
  await expect(line.first().locator('td[data-field="invoiceEntity"] select')).toHaveValue('sales_invoice');
  await expect(line.first().locator('td[data-field="invoiceId"] input')).toHaveValue(invoice.id);
  await expect(line.first().getByTestId('target-link')).toHaveText(invoice.number);
  await expect(grid.getByTestId('allocation-unallocated')).toHaveAttribute('data-value', '0');
  await pickRef(form.locator('div[data-field="accountId"]'), '普通預金', '普通預金');

  await form.getByRole('button', { name: '保存' }).click();
  await expect(page).toHaveURL(/\/e\/payment\/[0-9a-f-]{36}$/);
  const paymentId = page.url().slice(page.url().lastIndexOf('/') + 1);
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');
  // the payment's panel names the invoice it settled
  await expect(page.getByTestId('related-group-sales_invoice').locator(`[data-id="${invoice.id}"]`)).toContainText(
    invoice.number,
  );

  const paid = await api<Invoice & { status: string }>(request, headers, `/api/sales_invoice/${invoice.id}`);
  expect(paid.status).toBe('paid');
  expect(paid.balance).toBe('0');

  // AC-4: the invoice's panel lists the receipt (through its allocation line) and the journal entry
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  const panel = page.getByTestId('related-panel');
  const receipt = panel.getByTestId('related-group-payment').locator(`[data-id="${paymentId}"]`);
  await expect(receipt).toBeVisible();
  await expect(receipt.getByTestId('related-docstatus')).toHaveText('確定');
  await expect(receipt.locator('[data-relation="referenced_by"]')).toBeVisible();
  await expect(
    panel.getByTestId('related-group-journal_entry').locator(`[data-id="${invoice.journalEntryId}"]`),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('document-links-invoice-header.png') });
  await panel.screenshot({ path: test.info().outputPath('document-links-invoice-related.png') });
  // a fully paid invoice no longer offers the receipt action
  await expect(page.getByTestId('quick-action-sales_invoice.record_receipt')).toHaveCount(0);
  await receipt.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/e/payment/${paymentId}$`));
});

test('document-links AC-7: a record changed after it was shown is not duplicated; the reason is shown', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, 'C2 版の変化 ' + crypto.randomUUID().slice(0, 8));
  const draft = await draftInvoice(request, headers, partner.id, 'stale');

  await signInQuality(page);
  await page.goto(`/e/sales_invoice/${draft.id}`);
  await expect(page.getByTestId('record-form')).toHaveAttribute('data-mode', 'update');
  await api(request, headers, `/api/sales_invoice/${draft.id}`, { patch: { note: 'changed elsewhere' } }, 'PATCH');
  await page.getByTestId('duplicate-record').click();
  await expect(page.getByText('この記録は表示した後に更新されました')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/e/sales_invoice/${draft.id}$`));
  // the page reloaded the latest version; duplicating now works and carries the new note
  await expect(page.getByTestId('record-form').locator('div[data-field="note"] textarea')).toHaveValue(
    'changed elsewhere',
  );
  await closeToasts(page);
  await page.getByTestId('duplicate-record').click();
  await expect(page).toHaveURL(/\/e\/sales_invoice\/new$/);
  await expect(page.getByTestId('record-form').locator('div[data-field="note"] textarea')).toHaveValue(
    'changed elsewhere',
  );

  // a source the caller can no longer read: the re-read fails, nothing opens, the reason is shown
  await page.goto(`/e/sales_invoice/${draft.id}`);
  await expect(page.getByTestId('duplicate-record')).toBeEnabled();
  await page.route(`**/api/sales_invoice/${draft.id}`, (route) =>
    route.request().method() === 'GET' && route.request().resourceType() === 'fetch'
      ? route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'PERMISSION_DENIED', message: 'Synthetic permission loss', hint: 'Ask an administrator.' },
          }),
        })
      : route.continue(),
  );
  await page.getByTestId('duplicate-record').click();
  await expect(page.getByText('元の記録を読み直せないため、新規画面を開きませんでした')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/e/sales_invoice/${draft.id}$`));
  await page.unroute(`**/api/sales_invoice/${draft.id}`);
});

test('document-links AC-8: the related panel and the record actions work at 390px', async ({ page, request }) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, 'C2 スマホ ' + crypto.randomUUID().slice(0, 8));
  const invoice = await openInvoice(request, headers, partner.id, 'phone ' + crypto.randomUUID().slice(0, 6));
  await signInQuality(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  const panel = page.getByTestId('related-panel');
  await expect(panel.getByTestId('related-group-journal_entry')).toBeVisible();
  await expect(page.getByTestId('duplicate-record')).toBeVisible();
  await expect(page.getByTestId('quick-action-sales_invoice.record_receipt')).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('document-links-390-header.png') });
  await panel.screenshot({ path: test.info().outputPath('document-links-390-related.png') });
  // English labels too (the language switch is in the desktop sidebar)
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('heading', { name: 'Related', exact: true })).toBeVisible();
  await expect(page.getByTestId('duplicate-record')).toHaveText('Duplicate');
  await expect(page.getByTestId('quick-action-sales_invoice.record_receipt')).toHaveText('Record receipt');
  await assertNoOverflow(page);
  await page.getByTestId('quick-action-sales_invoice.record_receipt').click();
  await expect(page).toHaveURL(/\/e\/payment\/new$/);
  await expect(page.getByTestId('seed-notice')).toContainText('Nothing is created until you save');
  await assertNoOverflow(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Language: ja', exact: true }).click();
});

test('document-links AC-4: a failing related read stays inside the panel; the record stays usable and retry recovers', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const partner = await qualityPartner(request, headers, 'C2 関連失敗 ' + crypto.randomUUID().slice(0, 8));
  const invoice = await openInvoice(request, headers, partner.id, 'failing ' + crypto.randomUUID().slice(0, 6));
  await signInQuality(page);
  const related = `**/api/sales_invoice/${invoice.id}/related`;
  await page.route(related, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Synthetic related failure', hint: 'Retry.' } }),
    }),
  );
  await page.goto(`/e/sales_invoice/${invoice.id}`);
  const panel = page.getByTestId('related-panel');
  await expect(panel.getByTestId('related-error')).toContainText('関連する記録を読み込めませんでした');
  // the record itself is shown and its actions work while the panel failed
  await expect(page.getByTestId('record-title')).toHaveText(invoice.number);
  await expect(page.getByTestId('duplicate-record')).toBeEnabled();
  await page.unroute(related);
  await panel.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(panel.getByTestId('related-error')).toHaveCount(0);
  await expect(
    panel.getByTestId('related-group-journal_entry').locator(`[data-id="${invoice.journalEntryId}"]`),
  ).toBeVisible();
});
