// csv-import (docs/specs/csv-import.md) AC-11..AC-14 through the browser: 100 partners with 3 bad rows (UTF-8 BOM) from
// preview to execute and the error CSV, a 20-row Shift_JIS product file, 390px, and where the "Import" link appears.
// Files are generated here; data goes to the isolated E2E database through the real import action.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { api, PASSWORD } from './operations-helpers.ts';
import { assertNoOverflow, qualitySession, signInQuality } from './quality-helpers.ts';

/** Shift_JIS bytes via the reverse of the platform decoder (no encoder dependency in the test). */
function shiftJisEncoder(): (text: string) => Buffer {
  const decoder = new TextDecoder('shift_jis');
  const replacement = String.fromCharCode(0xfffd);
  const table = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const ch = decoder.decode(Uint8Array.of(lead, trail));
      if (ch.length === 1 && ch !== replacement && !table.has(ch)) table.set(ch, [lead, trail]);
    }
  }
  for (let byte = 0xa1; byte <= 0xdf; byte++) table.set(decoder.decode(Uint8Array.of(byte)), [byte]);
  return (text) =>
    Buffer.from(
      [...text].flatMap((ch) => {
        const code = ch.charCodeAt(0);
        if (code < 0x80) return [code];
        const bytes = table.get(ch);
        if (!bytes) throw new Error(`not representable in Shift_JIS: ${ch}`);
        return bytes;
      }),
    );
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const summaryCount = (page: Page, scope: string, status: string) =>
  page.getByTestId(scope).getByTestId('import-summary').locator(`[data-status="${status}"] dd`);

async function openImport(page: Page, entity: string) {
  await page.goto(`/e/${entity}`);
  await page.getByRole('link', { name: '取込', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${entity}/import$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('の取込');
}

test('csv-import AC-11/AC-12/AC-13/AC-14: 100 partners with 3 bad rows — preview, execute, error CSV, 390px', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const prefix = 'CSV' + crypto.randomUUID().slice(0, 6).toUpperCase();
  const bad = new Map([
    [10, { 締め日: '32' }],
    [50, { 登録番号: 'T123' }],
    [77, { 顧客: 'たぶん' }],
  ]);
  const lines = ['取引先コード,名称,カナ名称,顧客,締め日,登録番号'];
  for (let n = 1; n <= 100; n++) {
    const code = `${prefix}-${String(n).padStart(3, '0')}`;
    const override: Record<string, string> = bad.get(n) ?? {};
    const name = n === 2 ? '"株式会社 取込, 第2"' : `取込取引先${n}`;
    lines.push(
      [code, name, 'ﾄﾘｺﾐ', override.顧客 ?? 'はい', override.締め日 ?? '20', override.登録番号 ?? ''].join(','),
    );
  }
  const file = Buffer.concat([BOM, Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
  const total = async () =>
    (await api<{ total: number }>(request, headers, `/api/partner?search=${encodeURIComponent(prefix)}&limit=1`)).total;

  await signInQuality(page);
  await openImport(page, 'partner');
  await page.getByLabel('CSV ファイル').setInputFiles({ name: 'partners.csv', mimeType: 'text/csv', buffer: file });
  await expect(page.getByTestId('import-encoding')).toHaveText('UTF-8 (BOM)');
  await expect(page.getByTestId('import-file-info')).toContainText('100');
  // Every header is a field label, so every column is matched automatically.
  const selects = page.getByTestId('import-mapping').locator('select');
  await expect(selects).toHaveCount(6);
  expect(await selects.evaluateAll((all) => all.map((s) => (s as HTMLSelectElement).value))).toEqual([
    'code',
    'name',
    'nameKana',
    'isCustomer',
    'closingDay',
    'invoiceRegistrationNo',
  ]);

  await page.getByRole('button', { name: '事前確認', exact: true }).click();
  await expect(summaryCount(page, 'import-preview', 'created')).toHaveText('97');
  await expect(summaryCount(page, 'import-preview', 'error')).toHaveText('3');
  await expect(page.getByTestId('import-error-note')).toHaveText(
    'エラーの行は取り込まれません。それ以外の行を取り込みます。',
  );
  const previewRows = page.getByTestId('import-preview-table').getByTestId('import-row');
  await expect(previewRows).toHaveCount(50);
  await page.getByLabel('エラーの行だけ表示').check();
  await expect(previewRows).toHaveCount(3);
  expect(await previewRows.locator('td:first-child').allTextContents()).toEqual(['10', '50', '77']);
  await expect(previewRows.nth(0)).toContainText('締め日');
  await expect(previewRows.nth(2)).toContainText('値の形式が正しくありません');
  // The preview changed nothing.
  expect(await total()).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('csv-import-preview-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('button', { name: '取り込む', exact: true }).click();
  await expect(summaryCount(page, 'import-result', 'created')).toHaveText('97');
  await expect(summaryCount(page, 'import-result', 'error')).toHaveText('3');
  await expect(page.getByTestId('import-result-table').getByTestId('import-row')).toHaveCount(3);
  expect(await total()).toBe(97);
  await page.getByTestId('import-result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('csv-import-result-1280.png') });
  const second = await api<{ items: { name: string; isCustomer: boolean; closingDay: number }[] }>(
    request,
    headers,
    `/api/partner?where=${encodeURIComponent(JSON.stringify({ code: `${prefix}-002` }))}`,
  );
  expect(second.items[0]).toMatchObject({ name: '株式会社 取込, 第2', isCustomer: true, closingDay: 20 });

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'エラーの行を CSV でダウンロード', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('partner-import-errors.csv');
  const path = await download.path();
  if (!path) throw new Error('missing error CSV download');
  const csv = await readFile(path, 'utf8');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  const errorLines = csv.slice(1).trimEnd().split('\r\n');
  expect(errorLines[0]).toBe('取引先コード,名称,カナ名称,顧客,締め日,登録番号,行,理由');
  expect(errorLines.slice(1).map((l) => l.split(',')[0])).toEqual([`${prefix}-010`, `${prefix}-050`, `${prefix}-077`]);
  expect(errorLines.slice(1).map((l) => l.split(',')[6])).toEqual(['10', '50', '77']);
  expect(errorLines[2]).toContain('登録番号');

  await page.getByRole('link', { name: '一覧へ戻る', exact: true }).click();
  await expect(page).toHaveURL(/\/e\/partner$/);
});

test('csv-import AC-11/AC-14: a Shift_JIS product file of 20 rows maps labels, enum labels, units and amounts', async ({
  page,
  request,
}) => {
  const { headers } = await qualitySession(request);
  const units = await api<{ items: { id: string; name: string }[] }>(
    request,
    headers,
    `/api/uom?where=${encodeURIComponent(JSON.stringify({ code: 'H87' }))}`,
  );
  const unit =
    units.items[0] ??
    (await api<{ id: string }>(request, headers, '/api/uom', { code: 'H87', name: '個', symbol: '個' }));
  const prefix = 'SJ' + crypto.randomUUID().slice(0, 6).toUpperCase();
  const lines = ['品目コード,品目名,品目名カナ,種別,税区分,単位,販売単価'];
  for (let n = 1; n <= 20; n++)
    lines.push(
      [
        `${prefix}-${String(n).padStart(2, '0')}`,
        `取込品目 第${n}号`,
        'ﾄﾘｺﾐﾋﾝﾓｸ',
        n % 2 ? '物品' : 'サービス',
        n % 2 ? '課税（軽減）' : '課税（標準）',
        '個',
        '"1,280"',
      ].join(','),
    );
  const file = shiftJisEncoder()(lines.join('\r\n') + '\r\n');

  await signInQuality(page);
  await openImport(page, 'product');
  await page
    .getByLabel('CSV ファイル')
    .setInputFiles({ name: 'products-sjis.csv', mimeType: 'text/csv', buffer: file });
  await expect(page.getByTestId('import-encoding')).toHaveText('Shift_JIS');
  await expect(page.getByTestId('import-file-info')).toContainText('20');
  await expect(page.getByTestId('import-mapping')).toContainText('取込品目 第1号');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '事前確認', exact: true }).click();
  await expect(summaryCount(page, 'import-preview', 'created')).toHaveText('20');
  await expect(summaryCount(page, 'import-preview', 'error')).toHaveText('0');
  await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('csv-import-sjis-390.png'), fullPage: true });
  await page.getByRole('button', { name: '取り込む', exact: true }).click();
  await expect(summaryCount(page, 'import-result', 'created')).toHaveText('20');
  await expect(page.getByRole('button', { name: 'エラーの行を CSV でダウンロード' })).toHaveCount(0);

  const first = await api<{ items: Record<string, unknown>[] }>(
    request,
    headers,
    `/api/product?where=${encodeURIComponent(JSON.stringify({ code: `${prefix}-01` }))}`,
  );
  expect(first.items[0]).toMatchObject({
    name: '取込品目 第1号',
    nameKana: 'ﾄﾘｺﾐﾋﾝﾓｸ',
    kind: 'goods',
    taxCategory: 'reduced',
    uomId: unit.id,
  });
  expect(String(first.items[0]?.salePrice)).toMatch(/^1280(\.0+)?$/);
  const second = await api<{ items: Record<string, unknown>[] }>(
    request,
    headers,
    `/api/product?where=${encodeURIComponent(JSON.stringify({ code: `${prefix}-02` }))}`,
  );
  expect(second.items[0]).toMatchObject({ kind: 'service', taxCategory: 'standard' });
});

test('csv-import AC-11: the import link needs create permission and an importable master', async ({
  page,
  request,
}) => {
  const { headers, companyId } = await qualitySession(request);
  // Documents have no import even for an administrator.
  await signInQuality(page);
  await page.goto('/e/sales_invoice');
  await expect(page.getByRole('link', { name: /新規/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '取込', exact: true })).toHaveCount(0);
  await page.goto('/e/sales_invoice/import');
  await expect(page.getByRole('heading', { level: 1, name: 'この画面からは取り込めません' })).toBeVisible();

  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `import-viewer-${suffix}@example.com`;
  const user = await api(request, headers, '/admin/users', {
    name: '取込閲覧 ' + suffix,
    email,
    password: PASSWORD,
  });
  await api(
    request,
    headers,
    `/admin/users/${user.id}/companies/${companyId}`,
    { expectedVersion: 0, roles: ['viewer'], accessScope: 'all', siteIds: [], storeIds: [] },
    'PUT',
  );
  await page.context().clearCookies();
  await page.evaluate(() => sessionStorage.clear());
  await signInQuality(page, email, PASSWORD);
  await page.goto('/e/partner');
  await expect(page.getByTestId('row').first().or(page.getByTestId('empty-state'))).toBeVisible();
  await expect(page.getByRole('link', { name: '取込', exact: true })).toHaveCount(0);
});
