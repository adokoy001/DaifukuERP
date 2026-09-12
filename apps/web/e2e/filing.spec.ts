import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { FilingExport } from '@daifuku/mod-tax-filing/contract';
import { commerceFixture } from './commerce-helpers.ts';
import { financeAction, financeBankIdentity, submitFinance } from './finance-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, failedRead, qualitySession, signInQuality } from './quality-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';

test.setTimeout(120_000);
async function filingFixture(request: APIRequestContext) {
  const fixture = await commerceFixture(request), year = Number(BUSINESS_DATE.slice(0, 4)) - 1;
  const opened = await api<{ fiscalYear: Row }>(request, fixture.headers, '/actions/accounting.open_fiscal_year', { startDate: `${year}-01-01` });
  const entry = await api(request, fixture.headers, '/api/journal_entry', { date: `${year}-12-20`, description: '申告検証の合成仕訳', lines: { journal_line: [{ accountId: fixture.accounts['1000'], debit: '1000' }, { accountId: fixture.accounts['4000'], credit: '1000', taxCategory: 'out_of_scope' }] } });
  await submitFinance(request, fixture.headers, 'journal_entry', entry.id);
  const periods = await api<{ items: Row[] }>(request, fixture.headers, '/api/fiscal_period?limit=500');
  for (const period of periods.items.filter((row) => row.fiscalYearId === opened.fiscalYear.id)) await api(request, fixture.headers, '/actions/accounting.close_period', { periodId: period.id });
  const admin = await qualitySession(request), email = `filing-review-${fixture.runId}@example.invalid`, reviewer = await api(request, admin.headers, '/admin/users', { name: '申告準備の別確認者', email, password: PASSWORD });
  await api(request, admin.headers, `/admin/users/${reviewer.id}/companies/${fixture.first.id}`, { expectedVersion: 0, roles: ['accounting'], accessScope: 'all', storeIds: [], siteIds: [] }, 'PUT');
  return { ...fixture, fiscalYearId: opened.fiscalYear.id, reviewerEmail: email };
}

test('accounting preparation maps accounts, separates review, preserves encoded downloads and detects stale sources', async ({ page, request, browser }) => {
  const fixture = await filingFixture(request);
  await signInQuality(page, fixture.email, PASSWORD); await page.goto('/finance/filing');
  await page.getByRole('button', { name: '作成条件・補足情報', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('法人名', { exact: true }).fill('株式会社合成申告');
  const categories = { '1000': 'current_assets', '1100': 'current_assets', '1300': 'current_assets', '1500': 'current_assets', '1900': 'current_assets', '2100': 'current_liabilities', '2200': 'current_liabilities', '2400': 'current_liabilities', '4000': 'sales', '5000': 'operating_expenses' };
  for (const [code, category] of Object.entries(categories)) await dialog.getByLabel(`${code} 区分`, { exact: true }).selectOption(category);
  await dialog.getByLabel('科目対応の確認根拠', { exact: true }).fill('合成仕訳と分類表を照合'); await dialog.getByRole('checkbox').check();
  await financeAction(page, 'tax_filing.save_accounting_profile', () => dialog.getByRole('button', { name: '確認した対応を保存', exact: true }).click()); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '準備資料を作成', exact: true }).click(); await dialog.getByRole('combobox', { name: '会計年度', exact: true }).selectOption(fixture.fiscalYearId);
  await dialog.getByLabel('消費税区分と例外項目の確認記録', { exact: true }).fill('消費税対象外の合成仕訳を確認'); await dialog.getByRole('checkbox').check();
  const pack = await financeAction(page, 'tax_filing.prepare_accounting', () => dialog.getByRole('button', { name: '根拠を固定して資料を作成', exact: true }).click()); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '貸借対照表', exact: true })).toBeVisible();
  await expect(page.getByText('作成者以外の担当者が原資料と検算結果を確認してください。', { exact: true })).toBeVisible();
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', locale: 'ja-JP', viewport: { width: 390, height: 844 } });
  try {
    const review = await context.newPage(); await signInQuality(review, fixture.reviewerEmail, PASSWORD); await review.goto('/finance/filing');
    await expect(review.getByRole('button', { name: '給与の申告準備', exact: true })).toHaveCount(0);
    await review.getByRole('button', { name: '根拠と検算を確認', exact: true }).click(); await review.getByRole('button', { name: '資料の確認へ', exact: true }).click(); const reviewDialog = review.getByRole('dialog');
    await reviewDialog.getByLabel('確認・取消の根拠', { exact: true }).fill('別確認者が合成元帳と検算を確認'); await reviewDialog.getByRole('checkbox').check();
    await financeAction(review, 'tax_filing.confirm', () => reviewDialog.getByRole('button', { name: '資料の確認を完了', exact: true }).click()); await expect(reviewDialog).toHaveCount(0);
    await assertNoOverflow(review); await review.screenshot({ path: test.info().outputPath('filing-reviewed-mobile.png'), fullPage: true });
    await review.getByRole('button', { name: 'ファイルを取得', exact: true }).click();
    const output = await financeAction<FilingExport>(review, 'tax_filing.export', () => reviewDialog.getByRole('button', { name: '最新の根拠を検査して出力', exact: true }).click()); expect(output.officialImport).toBe(true);
    for (const file of output.files) {
      const pending = review.waitForEvent('download'); await reviewDialog.getByRole('button', { name: `${file.filename} · ${file.encoding}`, exact: true }).click(); const downloaded = await pending, path = await downloaded.path();
      if (!path) throw new Error('Missing filing download'); expect(await readFile(path)).toEqual(Buffer.from(file.contentBase64, 'base64'));
    }
    const cash = await api(request, fixture.headers, `/api/account/${fixture.accounts['1000']}`);
    await api(request, fixture.headers, `/api/account/${cash.id}`, { patch: { name: '現金（確認後の名称変更）' }, expectedVersion: cash.version }, 'PATCH');
    await review.reload(); await review.getByRole('button', { name: '根拠と検算を確認', exact: true }).click();
    await expect(review.getByText('作成後に根拠資料または設定が変わっています。最新資料で再作成してください。', { exact: true })).toBeVisible(); await expect(review.getByRole('button', { name: 'ファイルを取得', exact: true })).toBeDisabled();
    const detail = await api<{ stale: boolean }>(request, fixture.headers, '/actions/tax_filing.get', { kind: 'accounting', id: pack.id }); expect(detail.stale).toBe(true);
  } finally { await context.close(); }
});

test('banking refresh denial removes cached financial rows and company switching clears the workspace', async ({ page, request }) => {
  const fixture = await commerceFixture(request);
  const accountName = '銀行限定口座 ' + fixture.runId;
  await api(request, fixture.headers, '/actions/banking.save_account', { ...financeBankIdentity, code: 'MAIN', name: accountName, ledgerAccountId: fixture.accounts['1100'], requesterCode: '1234567890', active: true });
  await signInQuality(page, fixture.email, PASSWORD); await page.goto('/finance/banking');
  await page.getByRole('button', { name: '口座設定', exact: true }).click();
  await expect(page.getByRole('button', { name: '自社口座を登録', exact: true })).toBeVisible();
  await expect(page.getByText(accountName, { exact: true })).toBeVisible();
  await page.route('**/actions/banking.board', (route) => route.request().method() === 'OPTIONS' ? route.continue() : route.fulfill(failedRead(403)));
  await page.getByRole('button', { name: '最新の状況を取得', exact: true }).click(); await expect(page.getByText('Synthetic refresh failure', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '自社口座を登録', exact: true })).toHaveCount(0);
  await expect(page.getByText(accountName, { exact: true })).toHaveCount(0);
  await page.unroute('**/actions/banking.board'); await page.goto('/templates'); await page.getByLabel('対象の会社', { exact: true }).selectOption(fixture.second.id); await page.goto('/finance/banking');
  await expect(page.getByRole('button', { name: '明細CSVを取込', exact: true })).toBeDisabled(); await assertNoOverflow(page);
});
