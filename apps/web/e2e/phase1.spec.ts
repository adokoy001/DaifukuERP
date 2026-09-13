import { openScreen } from './navigation-helpers.ts';
// web-phase1 AC-6: create a document with 2 lines through the UI, submit it, verify the grids are read-only, then run a
// report page and find the rows. Data-driven from /meta: the first document entity with `lines` (journal_entry when the
// accounting module is installed) and a table-result action (accounting.trial_balance preferred, else the first one).
// Requires `pnpm dev:api` (seeded dev DB: accounts + an open fiscal year) and `pnpm dev:web`.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';
const API = (process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

interface Field {
  name: string;
  kind: string;
  required: boolean;
  hasDefault: boolean;
  serverOwned?: boolean;
  readOnly?: boolean;
  hidden: boolean;
  values?: string[];
}
interface Entity {
  name: string;
  kind: 'entity' | 'document';
  displayField: string | undefined;
  fields: Field[];
  ops: string[];
  lines?: { entity: string; parentField: string }[];
}
interface Action {
  name: string;
  resultKind: 'table' | 'record' | 'other';
}
interface Meta {
  entities: Entity[];
  actions: Action[];
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(EMAIL);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
}

/** /meta as the app sees it (fetched from inside the page so the same token/company headers apply). */
async function fetchMeta(page: Page): Promise<Meta> {
  const result = await page.evaluate(async (api) => {
    const token = globalThis.sessionStorage.getItem('daifuku.token') ?? '';
    const user = globalThis.sessionStorage.getItem('daifuku.user');
    const company = user ? (JSON.parse(user) as { defaultCompanyId?: string | null }).defaultCompanyId : null;
    const res = await fetch(`${api}/meta`, {
      headers: { authorization: `Bearer ${token}`, ...(company ? { 'x-company-id': company } : {}) },
    });
    return { status: res.status, body: (await res.json()) as unknown };
  }, API);
  expect(result.status, `GET ${API}/meta -> ${result.status}`).toBe(200);
  return result.body as Meta;
}

/** The subject of the test: a creatable+submittable document whose line entities are all readable, and a table action. */
function pickSubjects(meta: Meta): { doc: Entity; lines: Entity[]; report: Action } | string {
  const doc = meta.entities.find(
    (e) =>
      e.kind === 'document' &&
      (e.lines?.length ?? 0) > 0 &&
      e.ops.includes('create') &&
      e.ops.includes('submit') &&
      (e.lines ?? []).every((l) => meta.entities.some((x) => x.name === l.entity)),
  );
  if (!doc)
    return 'no document entity with `lines` (creatable + submittable) in /meta — install a module with a line document (e.g. accounting)';
  const tables = meta.actions.filter((a) => a.resultKind === 'table');
  const report = tables.find((a) => a.name.endsWith('trial_balance')) ?? tables[0];
  if (!report) return 'no action with resultKind "table" in /meta — install a module with a report action';
  const lines = (doc.lines ?? []).flatMap((l) => meta.entities.filter((e) => e.name === l.entity));
  return { doc, lines, report };
}

const today = () => BUSINESS_DATE;

/** Opens the ref combobox in `scope`, waits for the option list, picks option `index` (0 when fewer). Returns its text. */
async function pickRef(scope: Locator, index: number, optional: boolean): Promise<string | undefined> {
  const box = scope.getByRole('combobox');
  await box.click();
  const list = scope.getByRole('listbox');
  await expect(list).toBeVisible();
  const options = list.getByRole('option');
  // Either options or the "no match" line appears once the search query has settled.
  await expect(list.locator('li')).not.toHaveCount(0);
  await expect(list.locator('li').filter({ hasText: /読み込み中/ })).toHaveCount(0);
  const count = await options.count();
  if (count === 0) {
    if (optional) {
      await box.press('Escape');
      return undefined;
    }
    return undefined;
  }
  const option = options.nth(Math.min(index, count - 1));
  // The option renders "<display> <code>"; the display value is the first text node.
  const text = (await option.evaluate((el) => el.firstChild?.textContent ?? '')).trim();
  await option.click();
  return text;
}

async function fillHeader(page: Page, doc: Entity, marker: string): Promise<void> {
  const form = page.getByTestId('record-form');
  for (const f of doc.fields) {
    if (f.hidden || f.serverOwned || f.readOnly || f.kind === 'timestamp') continue;
    const isDisplay = f.name === doc.displayField && f.kind === 'text';
    if (!isDisplay && f.kind !== 'date' && (!f.required || f.hasDefault)) continue;
    const cell = form.locator(`[data-field="${f.name}"]`);
    if (f.kind === 'text') await cell.locator('input, textarea').fill(isDisplay ? marker : 'E2E');
    else if (f.kind === 'date') await cell.locator('input').fill(today());
    else if (f.kind === 'enum') await cell.locator('select').selectOption(f.values?.[0] ?? '');
    else if (f.kind === 'int' || f.kind === 'decimal') await cell.locator('input').fill('1');
    else if (f.kind === 'ref')
      expect(await pickRef(cell, 0, false), `no ${f.name} records to pick for ${doc.name}`).toBeTruthy();
    else if (f.kind !== 'bool')
      throw new Error(`cannot auto-fill required header field ${doc.name}.${f.name} (${f.kind})`);
  }
}

interface RowFill {
  picked: string[];
  decimals: string[];
}

/** Fills one grid row: required refs pick option `rowIndex`, optional refs the first option, one decimal column gets 100. */
async function fillRow(row: Locator, line: Entity, rowIndex: number): Promise<RowFill> {
  const names = await row
    .locator('td[data-field]')
    .evaluateAll((tds) => tds.map((td) => (td as HTMLElement).dataset.field ?? ''));
  const fields = names.flatMap((n) => line.fields.filter((f) => f.name === n && !f.serverOwned && !f.readOnly));
  const decimals = fields.filter((f) => f.kind === 'decimal').map((f) => f.name);
  // Row 0 fills the first decimal column, row 1 the second (debit / credit) so a journal entry balances.
  const target = decimals[Math.min(rowIndex, Math.max(0, decimals.length - 1))];
  const picked: string[] = [];
  for (const f of fields) {
    const cell = row.locator(`td[data-field="${f.name}"]`);
    if (f.kind === 'ref') {
      const text = await pickRef(cell, f.required ? rowIndex : 0, !f.required);
      if (f.required) {
        expect(text, `no ${f.name} records to pick for ${line.name}`).toBeTruthy();
        if (text) picked.push(text);
      }
    } else if (f.kind === 'decimal' && f.name === target) await cell.locator('input').fill('100');
    else if (f.kind === 'enum' && f.required && !f.hasDefault)
      await cell.locator('select').selectOption(f.values?.[0] ?? '');
    else if (f.kind === 'text' && f.required && !f.hasDefault)
      await cell.locator('input, textarea').fill(`E2E line ${rowIndex + 1}`);
    else if (f.kind === 'date' && f.required && !f.hasDefault) await cell.locator('input').fill(today());
  }
  return { picked, decimals };
}

test('AC-6: document with 2 lines -> submit -> grid read-only -> report page shows the rows', async ({ page }) => {
  await login(page);
  const subjects = pickSubjects(await fetchMeta(page));
  // Missing fixture metadata is a setup regression, not a successful skipped test.
  if (typeof subjects === 'string') throw new Error(subjects);
  const { doc, lines, report } = subjects;
  const line = lines[0];
  if (!line) throw new Error('The selected document must expose its line metadata');
  const marker = `E2E-${Date.now()}`;

  await page.goto(`/e/${doc.name}/new`);
  const form = page.getByTestId('record-form');
  await expect(form).toHaveAttribute('data-mode', 'create');
  await fillHeader(page, doc, marker);

  // AC-1: one grid per line entity; "行を追加" adds the first row, Enter on the last row adds the second.
  const grid = page.getByTestId(`lines-${line.name}`);
  await expect(grid).toHaveAttribute('data-readonly', 'false');
  await grid.getByRole('button', { name: '行を追加' }).click();
  const rows = grid.getByTestId('line-row');
  await expect(rows).toHaveCount(1);
  const first = await fillRow(rows.nth(0), line, 0);
  await rows.nth(0).locator('input:not([disabled])').last().press('Enter');
  await expect(rows).toHaveCount(2);
  const second = await fillRow(rows.nth(1), line, 1);

  // AC-2: client-side sums footer ("参考値") reflects the two rows.
  const sums = grid.getByTestId('line-sums');
  await expect(sums).toContainText('参考値');
  const sumCol = first.decimals[0];
  if (sumCol) await expect(sums.locator(`td[data-sum="${sumCol}"]`)).toContainText('100');

  // AC-1: one request saves header + lines; the record page reloads both.
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${doc.name}/[0-9a-f-]{36}$`));
  await expect(page.getByTestId(`lines-${line.name}`).getByTestId('line-row')).toHaveCount(2);
  if (sumCol)
    await expect(page.getByTestId(`lines-${line.name}`).locator(`td[data-sum="${sumCol}"]`)).toContainText('100');

  // Submit -> docstatus 確定; grids frozen (kernel refuses line writes on submitted documents).
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');
  const frozen = page.getByTestId(`lines-${line.name}`);
  await expect(frozen).toHaveAttribute('data-readonly', 'true');
  await expect(frozen.getByRole('button', { name: '行を追加' })).toHaveCount(0);
  for (const input of await frozen.locator('input, select, textarea').all()) await expect(input).toBeDisabled();

  // AC-3: the complete screen directory reaches the report and its posted accounts.
  await openScreen(page, `/r/${report.name}`);
  await expect(page).toHaveURL(new RegExp(`/r/${report.name.replace(/\./g, '\\.')}$`));
  await page.getByTestId('report-form').getByRole('button', { name: '実行' }).click();
  const table = page.getByTestId('report-table');
  await expect(table).toBeVisible();
  await expect(table.getByTestId('report-row').first()).toBeVisible();
  for (const name of [...first.picked, ...second.picked]) await expect(table).toContainText(name);
  await expect(page.getByTestId('report-count')).toContainText('行');
  await expect(page.getByRole('button', { name: /CSV/ })).toBeEnabled();
});
