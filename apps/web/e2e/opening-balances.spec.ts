// Opening balance import in the browser (docs/specs/opening-balances.md AC-31..AC-39): opened from the screen search,
// an unbalanced journal file keeps "Import" disabled, the four files import through the kit dialog, the clearing
// account ends at 0, the trial balance opening column matches, the journal is reversed and imported again, English, 390px
// and axe. Data: a fresh synthetic company (commerceFixture); the clearing account, partners, product and warehouse are
// created through the API.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { WCAG_TAGS } from './a11y-policy.ts';
import { commerceFixture } from './commerce-helpers.ts';
import { openScreen } from './navigation-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, signInQuality } from './quality-helpers.ts';

test.setTimeout(240_000);

const csv = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const section = (page: Page, name: string) => page.getByTestId(`opening-section-${name}`);

async function importFile(page: Page, name: string, file: ReturnType<typeof csv>) {
  const s = section(page, name);
  await s.getByTestId(`opening-file-${name}`).setInputFiles(file);
  await s.getByRole('button', { name: '事前確認', exact: true }).click();
  await expect(page.getByTestId(`opening-preview-${name}`)).toBeVisible();
  await expect(s.getByTestId(`opening-execute-${name}`)).toBeEnabled();
  await s.getByTestId(`opening-execute-${name}`).click();
  const dialog = page.getByRole('dialog', { name: '取り込みますか？' });
  await dialog.getByTestId(`opening-confirm-${name}`).click();
  await expect(dialog).toHaveCount(0);
  const result = page.getByTestId(`opening-result-${name}`);
  await expect(result).toBeVisible();
  await expect(result.getByRole('heading', { name: '取込の結果' })).toBeFocused();
  await expect(page.getByTestId(`opening-not-committed-${name}`)).toHaveCount(0);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const failing = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(failing.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('AC-31..AC-39 opening balances: preview, refuse an unbalanced file, import four files, reverse and re-import', async ({
  page,
  request,
}) => {
  const f = await commerceFixture(request);
  const h = f.headers;
  const run = Date.now().toString(36);
  const years = (
    await api<{ items: (Row & { startDate: string })[] }>(request, h, '/api/fiscal_year?orderBy=startDate:asc&limit=10')
  ).items;
  const first = years[0];
  if (!first) throw new Error('fixture fiscal year missing');
  const start = new Date(`${first.startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const openingDate = start.toISOString().slice(0, 10);
  await api(request, h, '/api/account', { code: '3900', name: '期首残高仮勘定', type: 'equity' });
  await api(request, h, '/api/account', { code: '1400', name: '商品', type: 'asset' });
  await api(request, h, '/api/account', { code: '3000', name: '元入金', type: 'equity' });
  await api(request, h, '/api/uom', { code: 'H87', name: '個' });
  await api(request, h, '/api/warehouse', { code: 'MAIN', name: '本店', isDefault: true });
  const customer = `OBC${run}`.slice(0, 20);
  const supplier = `OBS${run}`.slice(0, 20);
  const product = `OBP${run}`.slice(0, 30);
  await api(request, h, '/api/partner', { code: customer, name: '期首得意先 ' + run, isCustomer: true });
  await api(request, h, '/api/partner', { code: supplier, name: '期首仕入先 ' + run, isSupplier: true });
  await api(request, h, '/api/product', { code: product, name: '期首品目 ' + run, taxCategory: 'standard' });
  const journal = [
    '科目コード,取引先コード,借方,貸方,摘要',
    '1100,,"1,000,000",,',
    '1300,,300000,,売掛金合計',
    '1400,,50000,,',
    '2100,,,120000,買掛金合計',
    '3000,,,1230000,',
  ].join('\r\n');

  await signInQuality(page, f.email, PASSWORD);
  // AC-31: a dedicated screen of the finance workspace, found through the screen search.
  await openScreen(page, '/finance/opening');
  await expect(page.getByRole('heading', { level: 1, name: '期首残高の取込', exact: true })).toBeVisible();
  await expect(page.getByTestId('opening-date')).toHaveText(openingDate);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/finance/opening');

  // AC-35 / AC-36: a file whose totals differ previews with the difference and keeps "Import" disabled.
  const s1 = section(page, 'journal');
  await s1
    .getByTestId('opening-file-journal')
    .setInputFiles(csv('journal-bad.csv', journal.replace('1230000', '1229999')));
  await s1.getByRole('button', { name: '事前確認', exact: true }).click();
  const preview = page.getByTestId('opening-preview-journal');
  await expect(page.getByTestId('opening-issues-journal')).toContainText('借方合計と貸方合計が一致しません');
  await expect(preview.getByTestId('opening-total-journal-Difference')).toHaveText('1');
  await expect(s1.getByTestId('opening-execute-journal')).toBeDisabled();
  await expect(s1.getByText('エラーと問題を直してから取り込めます。')).toBeVisible();

  // The correct file: two rows go to the clearing account, and the preview shows it.
  await s1.getByTestId('opening-file-journal').setInputFiles(csv('journal.csv', journal));
  await expect(preview).toHaveCount(0);
  await s1.getByRole('button', { name: '事前確認', exact: true }).click();
  await expect(preview.locator('[data-testid="opening-row"][data-status="clearing"]')).toHaveCount(2);
  await expect(preview.getByTestId('opening-clearing-change-journal')).toHaveText('0 → 180,000');
  await importFile(page, 'journal', csv('journal.csv', journal));
  await expect(page.getByTestId('opening-clearing-balance')).toHaveText('180,000');
  await expect(page.getByTestId('opening-clearing-warning')).toContainText('1300 売掛金');

  // AC-33: receivables, payables (two files of step 2) and stock.
  await importFile(
    page,
    'receivables',
    csv(
      'ar.csv',
      `取引先コード,金額,支払期日,元請求書番号,元請求日,備考\r\n${customer},300000,,OLD-1,${openingDate},\r\n`,
    ),
  );
  await importFile(page, 'payables', csv('ap.csv', `partnerCode,amount\r\n${supplier},120000\r\n`));
  await importFile(page, 'stock', csv('stock.csv', `倉庫コード,品目コード,数量,単価\r\nMAIN,${product},50,1000\r\n`));
  await expect(page.getByTestId('opening-clearing-balance')).toHaveText('0');
  await expect(page.getByTestId('opening-count-sales_invoice')).toHaveText('1');
  await expect(page.getByTestId('opening-count-stock_entry')).toHaveText('1');

  // AC-30 through the trial balance: the opening column carries the file, the clearing account is 0.
  const tb = await api<{ rows: Row[] }>(request, h, '/actions/accounting.trial_balance', {
    from: first.startDate,
    to: first.endDate,
  });
  const opening = (code: string) => {
    const row = tb.rows.find((r) => r.code === code);
    return [row?.openingDebit, row?.openingCredit];
  };
  expect(opening('1300')).toEqual(['300000', '0']);
  expect(opening('2100')).toEqual(['0', '120000']);
  expect(opening('3900')).toEqual(['0', '0']);

  // AC-37: reverse the opening journal through the dialog, then import it again.
  await page.getByRole('button', { name: '開始仕訳を取り消す', exact: true }).click();
  await page
    .getByRole('dialog', { name: '開始仕訳を取り消しますか？' })
    .getByRole('button', { name: '開始仕訳を取り消す' })
    .click();
  await expect(page.getByTestId('opening-journal-status')).toContainText('未取込');
  await expect(page.getByTestId('opening-status').getByRole('heading', { level: 2 })).toBeFocused();
  await importFile(page, 'journal', csv('journal.csv', journal));
  await expect(page.getByTestId('opening-clearing-balance')).toHaveText('0');
  await axe(page);

  // AC-39: 390px without horizontal overflow of the page or #screen-content, and axe there too.
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page);
  expect(
    await page.evaluate(() => {
      const el = document.querySelector('#screen-content');
      return el ? el.scrollWidth <= el.clientWidth + 1 : true;
    }),
  ).toBe(true);
  await axe(page);

  // AC-39: English.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Opening balances', exact: true })).toBeVisible();
  await expect(section(page, 'stock').getByRole('button', { name: 'Download template', exact: true })).toBeVisible();
});
