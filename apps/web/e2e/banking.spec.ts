import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { financeAction, financeBank, financeFixture, financeInvoice } from './finance-helpers.ts';
import { PASSWORD, api, type Row } from './operations-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';
import { assertNoOverflow, signInQuality } from './quality-helpers.ts';
test.setTimeout(150_000);

test('bank account setup, CSV preview, duplicate import, reviewed receipt and reversal use the browser', async ({
  page,
  request,
}) => {
  const fixture = await financeFixture(request);
  const invoice = await financeInvoice(request, fixture, 'sales');
  await signInQuality(page, fixture.email, PASSWORD);
  await page.goto('/finance/banking');
  await expect(page.getByRole('heading', { name: '銀行連携・消込', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '口座設定', exact: true }).click();
  await page.getByRole('button', { name: '自社口座を登録', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const [label, value] of [
    ['口座管理コード', 'MAIN'],
    ['表示名', '営業用口座'],
    ['振込依頼人コード（10桁）', '1234567890'],
    ['銀行コード（4桁）', '0001'],
    ['支店コード（3桁）', '001'],
    ['口座番号（1～7桁）', '1234567'],
    ['口座名義（半角英数カナ）', 'ﾀﾞｲﾌｸ'],
  ] as const)
    await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole('combobox', { name: '預金の勘定科目', exact: true }).fill('普通預金');
  await dialog.getByRole('option').filter({ hasText: '普通預金' }).click();
  const account = await financeAction(page, 'banking.save_account', () =>
    dialog.getByRole('button', { name: '口座情報を確認して保存', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '銀行明細', exact: true }).click();
  await page.getByRole('combobox', { name: '自社の銀行口座', exact: true }).selectOption(account.id);
  const csv = `externalId,bookedOn,direction,amount,description\r\nBANK-001,${BUSINESS_DATE},receive,11000,商流銀行入金\r\n`;
  for (const repeated of [false, true]) {
    await page.getByRole('button', { name: '明細CSVを取込', exact: true }).click();
    await dialog
      .getByLabel('銀行明細CSV', { exact: true })
      .setInputFiles({ name: 'synthetic-bank.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await financeAction(page, 'banking.preview_import', () =>
      dialog.getByRole('button', { name: '取込内容を確認', exact: true }).click(),
    );
    await expect(dialog).toContainText(repeated ? '新規0件 / 登録済み1件' : '新規1件 / 登録済み0件');
    await financeAction(page, 'banking.import_statement_csv', () =>
      dialog.getByRole('button', { name: '確認した明細を取り込む', exact: true }).click(),
    );
    await expect(dialog).toHaveCount(0);
  }
  await page.getByRole('button', { name: '照合候補を確認', exact: true }).click();
  await dialog.getByRole('radio', { name: String(invoice.number), exact: true }).check();
  await dialog.getByLabel('照合の確認記録', { exact: true }).fill('請求書と銀行明細を合成照合');
  await financeAction(page, 'banking.reconcile', () =>
    dialog.getByRole('button', { name: '根拠を確認して消込', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  expect((await api(request, fixture.headers, '/api/sales_invoice/' + invoice.id)).balance).toBe('0');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('#app-navigation').evaluate((node) => node.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('banking-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '解除', exact: true }).click();
  await dialog.getByLabel('訂正日', { exact: true }).fill(BUSINESS_DATE);
  await dialog.getByLabel('解除理由', { exact: true }).fill('合成照合の訂正');
  await financeAction(page, 'banking.undo_reconciliation', () =>
    dialog.getByRole('button', { name: '理由を記録して解除', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  expect((await api(request, fixture.headers, '/api/sales_invoice/' + invoice.id)).balance).toBe('11000');
});

type ExportResult = {
  bytes: number[];
  sentToBank: boolean;
  encoding: string;
  filename: string;
  batch: { contentHash: string };
};
async function downloadReviewedTransfer(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('checkbox', { name: '振込先・金額・指定日・銀行の取込条件を確認しました', exact: true })
    .check();
  const pending = page.waitForEvent('download');
  const result = await financeAction<ExportResult>(page, 'banking.export_transfer', () =>
    dialog.getByRole('button', { name: '確認してファイルを保存', exact: true }).click(),
  );
  const file = await pending;
  const path = await file.path();
  if (!path) throw new Error('No download file');
  const bytes = await readFile(path);
  expect([...bytes]).toEqual(result.bytes);
  expect(file.suggestedFilename()).toBe(result.filename);
  expect(result.sentToBank).toBe(false);
  await expect(dialog).toHaveCount(0);
  return { bytes, result };
}
function assertExportContent(
  bytes: Buffer,
  invoiceId: string,
  format: 'canonical_csv' | 'zengin120',
  ending: 'none' | 'crlf',
) {
  if (format === 'canonical_csv') {
    expect(bytes.toString('utf8')).toBe(
      '"transferDate","invoiceId","bankCode","branchCode","accountType","accountNumber","holderKana","amount"\r\n' +
        `"${BUSINESS_DATE}","${invoiceId}","0001","001","ordinary","7654321","ﾄﾘﾋｷｻｷ","1320"\r\n`,
    );
    return;
  }
  const stride = ending === 'crlf' ? 122 : 120;
  expect(bytes.length).toBe(stride * 4);
  for (const [index, type] of ['1', '2', '8', '9'].entries()) {
    expect(bytes.subarray(index * stride, index * stride + 1).toString('ascii')).toBe(type);
    if (ending === 'crlf') expect([...bytes.subarray(index * stride + 120, (index + 1) * stride)]).toEqual([13, 10]);
  }
  expect(bytes.subarray(4, 14).toString('ascii')).toBe('1234567890');
  expect(bytes.subarray(stride + 43, stride + 50).toString('ascii')).toBe('7654321');
  expect(bytes.subarray(stride + 80, stride + 90).toString('ascii')).toBe('0000001320');
  expect(bytes.subarray(2 * stride + 1, 2 * stride + 19).toString('ascii')).toBe('000001000000001320');
  expect([...bytes.subarray(stride + 50, stride + 56)]).toEqual([0xc4, 0xd8, 0xcb, 0xb7, 0xbb, 0xb7]);
}

for (const variant of [
  { name: 'Zengin without line endings', format: 'zengin120', ending: 'none' },
  { name: 'Zengin CRLF', format: 'zengin120', ending: 'crlf' },
  { name: 'review CSV', format: 'canonical_csv', ending: 'crlf' },
] as const)
  test(`reviewed ${variant.name} initial export and re-download preserve bytes without posting or sending money`, async ({
    page,
    request,
  }) => {
    const fixture = await financeFixture(request);
    const invoice = await financeInvoice(request, fixture, 'purchase', '2');
    const { account } = await financeBank(request, fixture);
    expect(invoice.priceIncludesTax).toBe(false);
    expect(invoice.total).toBe('1320');
    await signInQuality(page, fixture.email, PASSWORD);
    await page.goto('/finance/banking');
    await page.getByRole('button', { name: '振込準備', exact: true }).click();
    await page.getByRole('combobox', { name: '自社の銀行口座', exact: true }).selectOption(account.id);
    await page.getByRole('button', { name: '振込データを準備', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('振込指定日', { exact: true }).fill(BUSINESS_DATE);
    await dialog.getByRole('checkbox', { name: String(invoice.number), exact: true }).check();
    await financeAction(page, 'banking.prepare_transfer', () =>
      dialog.getByRole('button', { name: '対象と口座を固定して準備', exact: true }).click(),
    );
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '確認・出力', exact: true }).click();
    await expect(dialog).toContainText('7654321');
    await expect(dialog).toContainText('1234567890');
    await expect(dialog).toContainText('ﾄﾘﾋｷｻｷ');
    const format = dialog.getByRole('combobox', { name: '出力形式', exact: true });
    const ending = dialog.getByRole('combobox', { name: '全銀の改行', exact: true });
    await format.selectOption(variant.format);
    if (variant.format === 'zengin120') await ending.selectOption(variant.ending);
    await expect(ending).toHaveValue(variant.ending);
    const first = await downloadReviewedTransfer(page);
    assertExportContent(first.bytes, invoice.id, variant.format, variant.ending);
    expect(first.result.encoding).toBe(variant.format === 'canonical_csv' ? 'utf-8' : 'shift_jis');
    expect((await api(request, fixture.headers, '/api/purchase_invoice/' + invoice.id)).balance).toBe('1320');
    expect((await api<{ items: Row[] }>(request, fixture.headers, '/api/payment')).items).toHaveLength(0);
    await expect(page.getByText('出力済み・送金未確認', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '確認・出力', exact: true }).click();
    await expect(format).toHaveValue(variant.format);
    await expect(format).toBeDisabled();
    await expect(ending).toHaveValue(variant.ending);
    await expect(ending).toBeDisabled();
    const again = await downloadReviewedTransfer(page);
    expect(again.bytes).toEqual(first.bytes);
    expect(again.result.filename).toBe(first.result.filename);
    expect(again.result.batch.contentHash).toBe(first.result.batch.contentHash);
    expect((await api(request, fixture.headers, '/api/purchase_invoice/' + invoice.id)).balance).toBe('1320');
    expect((await api<{ items: Row[] }>(request, fixture.headers, '/api/payment')).items).toHaveLength(0);
    await assertNoOverflow(page);
    await page.screenshot({
      path: test.info().outputPath(`bank-transfer-${variant.format}-${variant.ending}-desktop.png`),
      fullPage: true,
    });
  });
