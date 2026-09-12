// web-phase15 AC-3 / AC-7 / AC-8 through the real UI and API.
// AC-3: no module registers an ext field in the dev build, so the test adds two to `partner` in the /meta response the
// browser receives (page.route) — everything else is real: the form renders them under 「追加項目」, the create/update
// requests carry `ext`, the API stores the keys (unregistered keys are kept, ADR-0003/0014), the record and list pages
// read them back. AC-8: the money ext has meta scale 0 (JPY) and shows 1,234.5, not 1,234.
// AC-7: accounting.tax_period_summary returns totals whose keys match no column; they are listed under the table.
// Requires `pnpm dev:api` (seeded dev DB) and the web, like smoke/phase1.
import { expect, test, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const API = (process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

interface MetaEntity {
  name: string;
  extFields?: unknown[];
  views: { list: string[] };
}

const label = (ja: string, en: string) => ({ ja, en });
const EXT_FIELDS = [
  { name: 'ext.rank', kind: 'enum', label: label('ランク', 'Rank'), required: false, hasDefault: false, hidden: false, immutable: false, values: ['a', 'b'], valueLabels: { a: label('A ランク', 'Rank A'), b: label('B ランク', 'Rank B') }, source: 'e2e' },
  { name: 'ext.creditLimit', kind: 'decimal', label: label('与信限度額', 'Credit limit'), required: false, hasDefault: false, hidden: false, immutable: false, money: true, scale: 0, source: 'e2e' },
];

/** Serves the real /meta with two ext fields on partner and `ext.rank` in its list view. */
async function withPartnerExt(page: Page): Promise<void> {
  await page.route(`${API}/meta`, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { entities: MetaEntity[] };
    const partner = body.entities.find((e) => e.name === 'partner');
    if (partner) {
      partner.extFields = EXT_FIELDS;
      partner.views.list = [...partner.views.list, 'ext.rank'];
    }
    await route.fulfill({ response: res, json: body });
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
}

async function apiGet(page: Page, path: string): Promise<Record<string, unknown>> {
  const result = await page.evaluate(
    async ([api, p]) => {
      const token = globalThis.sessionStorage.getItem('daifuku.token') ?? '';
      const res = await fetch(`${api}${p}`, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    [API, path] as const,
  );
  expect(result.status, `GET ${path}`).toBe(200);
  return result.body;
}

test('AC-3/AC-8: ext fields render under 追加項目, round-trip through row.ext, and show as a list column', async ({ page }) => {
  await withPartnerExt(page);
  await login(page);
  const name = `E2E ext ${Date.now()}`;

  await page.goto('/e/partner/new');
  const form = page.getByTestId('record-form');
  const ext = form.getByTestId('ext-fields');
  await expect(ext).toContainText('追加項目');
  await form.locator('#f-name').fill(name);
  await ext.locator('div[data-field="ext.rank"] select').selectOption('b');
  await ext.locator('div[data-field="ext.creditLimit"] input').fill('1234.50');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page).toHaveURL(/\/e\/partner\/[0-9a-f-]{36}$/);
  const id = page.url().slice(page.url().lastIndexOf('/') + 1);

  // Values read back from the saved record (row.ext); money scale 0 is a minimum, so 1234.5 keeps its fraction (AC-8).
  const saved = page.getByTestId('record-form').getByTestId('ext-fields');
  await expect(saved.locator('div[data-field="ext.rank"] select')).toHaveValue('b');
  await expect(saved.locator('div[data-field="ext.creditLimit"] input')).toHaveValue('1,234.5');
  expect((await apiGet(page, `/api/partner/${id}`)).ext).toEqual({ rank: 'b', creditLimit: '1234.5' });

  // Update: only the changed ext value moves; the other key is kept in the replaced `ext`.
  await saved.locator('div[data-field="ext.rank"] select').selectOption('a');
  await page.getByTestId('record-form').getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
  await expect.poll(async () => (await apiGet(page, `/api/partner/${id}`)).ext).toEqual({ rank: 'a', creditLimit: '1234.5' });

  // List view with `ext.rank` in views.list shows the column with the enum label.
  await page.goto(`/e/partner?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('columnheader', { name: 'ランク' })).toBeVisible();
  await expect(page.locator(`tr[data-id="${id}"]`)).toContainText('A ランク');
});

test('AC-7: report totals that match no column are listed under the table', async ({ page }) => {
  await login(page);
  await page.goto('/r/accounting.tax_period_summary');
  const month = BUSINESS_DATE.slice(0, 7);
  await page.locator('#r-from').fill(`${month}-01`);
  await page.locator('#r-to').fill(`${month}-28`);
  await page.getByTestId('report-form').getByRole('button', { name: '実行' }).click();
  await expect(page.getByTestId('report-table')).toBeVisible();
  const extra = page.getByTestId('report-extra-totals');
  await expect(extra).toContainText('合計');
  for (const key of ['output_tax_total', 'input_tax_total', 'net_tax_due']) await expect(extra.locator(`[data-total-key="${key}"]`)).toBeVisible();
  // No empty totals row in the table when no total belongs to a column.
  await expect(page.getByTestId('report-totals')).toHaveCount(0);
});
