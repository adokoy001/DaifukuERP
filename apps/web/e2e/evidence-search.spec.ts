// Evidence search in the browser (docs/specs/evidence-search.md AC-12..AC-21): open it from the screen search, narrow
// to one piece of evidence by date range x amount range x partner, open the linked purchase invoice and come back with
// the criteria restored, refuse an invalid range, the supersede history dialog and its focus, a zip of two selected
// files read back here, a partial failure (one download answered 409), ignored URL values, English, 390px and axe.
// Data: a fresh synthetic company (financeFixture) with a submitted purchase invoice and evidence uploaded via the API.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { WCAG_TAGS, formatJudgement, judge, parseExceptions, type A11yLocale, type A11yWidth } from './a11y-policy.ts';
import { financeFixture, financeInvoice } from './finance-helpers.ts';
import { openScreen } from './navigation-helpers.ts';
import { API, api, PASSWORD, type Headers, type Row } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

test.setTimeout(240_000);

const repoRoot = new URL('../../../', import.meta.url);
const exceptions = parseExceptions(
  JSON.parse(readFileSync(new URL('./a11y-exceptions.json', import.meta.url), 'utf8')),
  { documentExists: (path) => existsSync(new URL(path, repoRoot)) },
).exceptions;

type Attachment = Row & { filename: string; size: number; supersededById: string | null };

async function uploadEvidence(
  request: APIRequestContext,
  headers: Headers,
  filename: string,
  fields: Record<string, string>,
): Promise<Attachment> {
  const res = await request.post(`${API}/api/attachments/upload`, {
    headers,
    multipart: {
      file: {
        name: filename,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4 ${filename} ${crypto.randomUUID()}`),
      },
      ...fields,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Attachment;
}

/** Entry names and sizes of a STORE zip, from its central directory. */
function zipEntries(bytes: Buffer): { name: string; size: number; utf8: boolean }[] {
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const out: { name: string; size: number; utf8: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const flags = bytes.readUInt16LE(at + 8);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    out.push({
      name: bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      size,
      utf8: (flags & 0x0800) !== 0,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

const row = (page: Page, id: string) => page.getByTestId(`evidence-row-${id}`);

async function search(page: Page) {
  await page.getByTestId('evidence-form').getByRole('button', { name: '検索', exact: true }).click();
}

async function downloadZip(page: Page): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '選択した証憑を zip でダウンロード', exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/^evidence_\d{14}\.zip$/);
  const path = await file.path();
  if (!path) throw new Error('No download file');
  return readFile(path);
}

async function axe(page: Page, locale: A11yLocale, width: A11yWidth) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const run = { screen: 'evidence-search', locale, width };
  const judgement = judge(results.violations, exceptions, run, results.incomplete);
  const report = formatJudgement(run, judgement);
  expect(judgement.failures.length + judgement.stale.length, report).toBe(0);
}

test('AC-12..AC-21 evidence search: three keys AND, linked invoice, history, zip with a partial failure, en/390px/axe', async ({
  page,
  request,
}) => {
  const f = await financeFixture(request);
  const h = f.headers;
  const invoice = await financeInvoice(request, f, 'purchase');
  const p1 = f.partner;
  const p2 = await api(request, h, '/api/partner', { code: 'EV2-' + f.runId, name: '証憑検索 第二取引先 ' + f.runId });
  const linked = { linkedEntity: 'purchase_invoice', linkedId: invoice.id };
  const target = await uploadEvidence(request, h, '請求書_A社.pdf', {
    kind: 'invoice_received',
    txnDate: '2025-05-10',
    amount: '12000',
    partnerId: p1.id,
    ...linked,
  });
  const otherPartner = await uploadEvidence(request, h, '請求書_B社.pdf', {
    kind: 'invoice_received',
    txnDate: '2025-05-20',
    amount: '12000',
    partnerId: p2.id,
  });
  const otherDate = await uploadEvidence(request, h, '翌月分.pdf', {
    txnDate: '2025-06-10',
    amount: '12000',
    partnerId: p1.id,
  });
  const otherAmount = await uploadEvidence(request, h, '高額.pdf', {
    txnDate: '2025-05-15',
    amount: '50000',
    partnerId: p1.id,
  });
  const v1 = await uploadEvidence(request, h, 'contract_v1.pdf', {
    kind: 'contract',
    txnDate: '2025-07-01',
    amount: '3000',
    partnerId: p2.id,
  });
  const v2 = await uploadEvidence(request, h, 'contract_v2.pdf', {
    kind: 'contract',
    txnDate: '2025-07-01',
    amount: '3300',
    partnerId: p2.id,
  });
  await api(request, h, '/actions/attachment.supersede', { id: v1.id, newAttachmentId: v2.id, reason: '金額の訂正' });

  await signInQuality(page, f.email, PASSWORD);
  // AC-12: a finance dedicated screen found by the screen search
  await openScreen(page, '/finance/evidence');
  await expect(page.getByRole('heading', { level: 1, name: '証憑の検索', exact: true })).toBeVisible();
  // no criteria: every evidence of the company, first page
  await expect(page.getByTestId('evidence-summary')).toHaveText('条件なし（すべての証憑）: 6 件');

  // AC-13 / AC-2: date range x amount range x partner -> the one row that matches all three
  await page.getByLabel('取引年月日（開始）', { exact: true }).fill('2025-05-01');
  await page.getByLabel('取引年月日（終了）', { exact: true }).fill('2025-05-31');
  await page.getByLabel('取引金額（下限）', { exact: true }).fill('10,000');
  await page.getByLabel('取引金額（上限）', { exact: true }).fill('20000');
  const partner = page.getByRole('combobox', { name: '取引先', exact: true });
  await partner.fill(p1.name as string);
  await page
    .getByRole('option')
    .filter({ hasText: p1.name as string })
    .first()
    .click();
  await search(page);
  await expect(page.getByTestId('evidence-summary')).toHaveText('指定した条件をすべて満たす証憑: 1 件');
  await expect(row(page, target.id)).toBeVisible();
  for (const other of [otherPartner, otherDate, otherAmount]) await expect(row(page, other.id)).toHaveCount(0);
  const url = new URL(page.url());
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    from: '2025-05-01',
    to: '2025-05-31',
    partnerId: p1.id,
  });
  expect(url.searchParams.get('amountFrom')).toContain('10000'); // a decimal string (the router quotes JSON-like text)
  await expect(page.getByTestId('evidence-criteria')).toContainText('取引金額: 10,000〜20,000');

  // AC-15 / AC-5: the linked purchase invoice opens with its number; back restores the criteria and the result
  const link = row(page, target.id).getByTestId('evidence-linked').getByRole('link');
  await expect(link).toHaveText(`仕入請求書 ${String(invoice.number)}`);
  await link.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/e/purchase_invoice/${invoice.id}`);
  await expect(page.getByText(String(invoice.number)).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('取引年月日（開始）', { exact: true })).toHaveValue('2025-05-01');
  await expect(row(page, target.id)).toBeVisible();

  // AC-14: an invalid range is not searched; the reason is shown and the field takes focus
  const before = page.url();
  await page.getByLabel('取引年月日（開始）', { exact: true }).fill('2025-06-15');
  await search(page);
  const from = page.getByLabel('取引年月日（開始）', { exact: true });
  await expect(from).toHaveAttribute('aria-invalid', 'true');
  await expect(from).toBeFocused();
  await expect(from).toHaveAccessibleDescription('開始日は終了日以前にしてください。');
  expect(page.url()).toBe(before);

  // AC-16: the supersede history of the replacement, with the reason; focus returns to the opener
  await page.getByRole('button', { name: '条件をクリア', exact: true }).click();
  await partner.fill(p2.name as string);
  await page
    .getByRole('option')
    .filter({ hasText: p2.name as string })
    .first()
    .click();
  await search(page);
  await expect(page.getByTestId('evidence-summary')).toHaveText('指定した条件をすべて満たす証憑: 3 件');
  await expect(row(page, v1.id).getByTestId('evidence-supersede')).toContainText('差替済み');
  await expect(row(page, v2.id).getByTestId('evidence-supersede')).toContainText('差替前 1 件');
  const historyButton = row(page, v2.id).getByRole('button', { name: '履歴: contract_v2.pdf', exact: true });
  await historyButton.click();
  const dialog = page.getByRole('dialog', { name: '差替の履歴: contract_v2.pdf' });
  await expect(dialog.getByTestId('evidence-version')).toHaveCount(2);
  await expect(dialog.getByTestId('evidence-version-relation')).toHaveText(['この証憑', '古い版']);
  await expect(dialog.getByTestId('evidence-version-reason')).toHaveText('金額の訂正');
  await expect(dialog).toContainText('削除されずに保存');
  await axe(page, 'ja', 1280);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
  await expect(historyButton).toBeFocused();

  // AC-17: two selected files -> one zip with dated names and the stored bytes
  await row(page, otherPartner.id).getByRole('checkbox').check();
  await row(page, v2.id).getByRole('checkbox').check();
  await expect(page.getByTestId('evidence-selection')).toContainText('選択 2 / 50 件');
  const zip = zipEntries(await downloadZip(page));
  expect(zip).toEqual([
    { name: '2025-05-20_請求書_B社.pdf', size: otherPartner.size, utf8: true },
    { name: '2025-07-01_contract_v2.pdf', size: v2.size, utf8: true },
  ]);
  await expect(page.getByTestId('evidence-download-result')).toContainText('2 件を zip に保存しました。');

  // AC-19: one download answered 409 -> the others are zipped, the failure is listed
  await page.getByRole('button', { name: '選択を解除', exact: true }).click();
  await page.route(`**/api/attachments/${v1.id}/download`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INVALID_STATE',
          message: 'Attachment content does not match its recorded digest.',
          hint: 'Restore.',
        },
      }),
    }),
  );
  await row(page, v1.id).getByRole('checkbox').check();
  await row(page, otherPartner.id).getByRole('checkbox').check();
  const partial = zipEntries(await downloadZip(page));
  expect(partial.map((e) => e.name)).toEqual(['2025-05-20_請求書_B社.pdf']);
  await expect(page.getByTestId('evidence-download-failures')).toContainText('contract_v1.pdf');
  await expect(page.getByTestId('evidence-download-failures')).toContainText('保存内容が記録と一致しません');
  await page.unroute(`**/api/attachments/${v1.id}/download`);

  // AC-21: 390px without page overflow (the table scrolls in its frame), axe at both widths and in English
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page);
  await axe(page, 'ja', 390);
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'en'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Evidence search', exact: true })).toBeVisible();
  await expect(page.getByTestId('evidence-summary')).toHaveText('Evidence matching all criteria: 3');
  await assertNoOverflow(page);
  await axe(page, 'en', 390);
  await page.setViewportSize({ width: 1280, height: 800 });
  await axe(page, 'en', 1280);
  await page.evaluate(() => localStorage.setItem('daifuku.locale', 'ja'));

  // AC-14: invalid values in a shared URL are ignored and reported
  await page.goto('/finance/evidence?from=2026-02-30&amountFrom=abc&incomplete=yes');
  await expect(page.getByTestId('evidence-ignored')).toContainText('取引年月日（開始）');
  await expect(page.getByTestId('evidence-ignored')).toContainText('取引金額（下限）');
  await expect(page.getByTestId('evidence-summary')).toHaveText('条件なし（すべての証憑）: 6 件');
});

test('AC-12 a user without attachment read who opens the URL gets an explanation', async ({ page, request }) => {
  const { headers, companyId } = await qualitySession(request);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `evidence-none-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', {
    name: '証憑権限なし ' + suffix,
    email,
    password: PASSWORD,
  });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['settings'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  await signInQuality(page, email, PASSWORD);
  await page.goto('/finance/evidence');
  await expect(
    page.getByRole('heading', { level: 1, name: '証憑の検索を使う権限がありません', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'ホームへ戻る', exact: true })).toHaveAttribute('href', '/');
});
