import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { FilingBoard, FilingExport, FilingKind } from '@daifuku/mod-tax-filing/contract';
import { commerceFixture, type CommerceFixture } from './commerce-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';
import { financeAction, submitFinance } from './finance-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { failedRead, qualitySession, signInQuality } from './quality-helpers.ts';

test.setTimeout(120_000);
const changedNotice = '記録が更新されました。入力内容を確認して閉じ、最新の記録から開き直してください。';
const categories: Record<string, string> = {
  '1000': 'current_assets',
  '1100': 'current_assets',
  '1300': 'current_assets',
  '1500': 'current_assets',
  '1900': 'current_assets',
  '2100': 'current_liabilities',
  '2200': 'current_liabilities',
  '2400': 'current_liabilities',
  '4000': 'sales',
  '5000': 'operating_expenses',
};

async function otherActor(request: APIRequestContext, fixture: CommerceFixture) {
  const admin = await qualitySession(request),
    email = `filing-concurrent-${fixture.runId}@example.invalid`;
  const user = await api(request, admin.headers, '/admin/users', {
    name: '申告資料の同時編集者',
    email,
    password: PASSWORD,
  });
  await api(
    request,
    admin.headers,
    `/admin/users/${user.id}/companies/${fixture.first.id}`,
    { expectedVersion: 0, roles: ['accounting', 'workforce_payroll'], accessScope: 'all', storeIds: [], siteIds: [] },
    'PUT',
  );
  const session = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
  return { authorization: `Bearer ${session.token}`, 'x-company-id': fixture.first.id };
}

function profileInput(fixture: CommerceFixture, kind: FilingKind) {
  return kind === 'accounting'
    ? {
        countryProfile: 'jp-hot010-general-v3',
        entityType: 'corporation',
        accountingBasis: 'tax_exclusive',
        consolidation: 'standalone',
        legalName: '株式会社合成初期',
        mappings: Object.entries(fixture.accounts).map(([code, accountId]) => ({
          accountId,
          category: categories[code],
          displayName:
            '合成科目' + code.replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0)),
        })),
        basis: '合成元帳と分類を確認',
      }
    : {
        countryProfile: 'jp-payroll-preparation-2026',
        taxYear: 2026,
        legalName: '株式会社合成初期',
        payerAddress: '東京都合成市一丁目',
        payerPhone: null,
        recipients: [],
        basis: '合成会社の対象年を確認',
      };
}

function waitForProfilePoll(page: Page, kind: FilingKind, version: number) {
  return page.waitForResponse(
    async (response) => {
      if (
        !response.url().endsWith('/actions/tax_filing.board') ||
        response.request().method() !== 'POST' ||
        !response.ok() ||
        response.request().postDataJSON().kind !== kind
      )
        return false;
      const board = (await response.json()) as FilingBoard;
      return (kind === 'accounting' ? board.accountingProfile : board.payrollProfile)?.version === version;
    },
    { timeout: 30_000 },
  );
}

for (const kind of ['accounting', 'payroll'] as const) {
  test(`${kind} profile poll preserves an open draft and blocks overwriting another reviewer's update`, async ({
    page,
    request,
  }) => {
    const fixture = await commerceFixture(request),
      other = await otherActor(request, fixture),
      input = profileInput(fixture, kind);
    const saved = await api(request, fixture.headers, `/actions/tax_filing.save_${kind}_profile`, {
      ...input,
      expectedVersion: 0,
    });
    await signInQuality(page, fixture.email, PASSWORD);
    await page.goto('/finance/filing');
    if (kind === 'payroll') await page.getByRole('button', { name: '給与の申告準備', exact: true }).click();
    await page.getByRole('button', { name: '作成条件・補足情報', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      name = dialog.getByLabel(kind === 'accounting' ? '法人名' : '給与支払者の名称', { exact: true });
    await name.fill('株式会社Ａ編集中');
    if (kind === 'accounting') await dialog.getByRole('checkbox').check();
    const save = dialog.getByRole('button', {
      name: kind === 'accounting' ? '確認した対応を保存' : '補足情報を保存',
      exact: true,
    });
    await expect(save).toBeEnabled();
    const poll = waitForProfilePoll(page, kind, saved.version + 1);
    const updated = await api(request, other, `/actions/tax_filing.save_${kind}_profile`, {
      ...input,
      expectedVersion: saved.version,
      legalName: '株式会社Ｂ確認済',
      basis: '別担当者Ｂが確認した最新内容',
    });
    await poll;
    await expect(dialog.getByText(changedNotice, { exact: true })).toBeVisible();
    await expect(name).toHaveValue('株式会社Ａ編集中');
    await expect(save).toBeDisabled();
    const current = await api<FilingBoard>(request, other, '/actions/tax_filing.board', { kind }),
      profile = kind === 'accounting' ? current.accountingProfile : current.payrollProfile;
    expect(profile).toMatchObject({
      version: updated.version,
      legalName: '株式会社Ｂ確認済',
      basis: '別担当者Ｂが確認した最新内容',
    });
  });
}

async function confirmedAccounting(request: APIRequestContext) {
  const fixture = await commerceFixture(request),
    other = await otherActor(request, fixture),
    year = Number(BUSINESS_DATE.slice(0, 4)) - 1;
  const opened = await api<{ fiscalYear: Row }>(request, fixture.headers, '/actions/accounting.open_fiscal_year', {
    startDate: `${year}-01-01`,
  });
  const entry = await api(request, fixture.headers, '/api/journal_entry', {
    date: `${year}-12-20`,
    description: '出力競合検証の合成仕訳',
    lines: {
      journal_line: [
        { accountId: fixture.accounts['1000'], debit: '1000' },
        { accountId: fixture.accounts['4000'], credit: '1000', taxCategory: 'out_of_scope' },
      ],
    },
  });
  await submitFinance(request, fixture.headers, 'journal_entry', entry.id);
  const periods = await api<{ items: Row[] }>(request, fixture.headers, '/api/fiscal_period?limit=500');
  for (const period of periods.items.filter((row) => row.fiscalYearId === opened.fiscalYear.id))
    await api(request, fixture.headers, '/actions/accounting.close_period', { periodId: period.id });
  await api(request, fixture.headers, '/actions/tax_filing.save_accounting_profile', {
    ...profileInput(fixture, 'accounting'),
    expectedVersion: 0,
  });
  const prepared = await api(request, fixture.headers, '/actions/tax_filing.prepare_accounting', {
    fiscalYearId: opened.fiscalYear.id,
    idempotencyKey: crypto.randomUUID(),
    incomeTransferNotPostedConfirmed: true,
    taxClassificationReview: '合成仕訳は対象外取引と確認',
  });
  const confirmed = await api(request, other, '/actions/tax_filing.confirm', {
    kind: 'accounting',
    id: prepared.id,
    expectedVersion: prepared.version,
    reason: '別確認者が元帳と検算を確認',
    warningsReviewed: true,
  });
  return { ...fixture, other, confirmed };
}

test('filing export removes old downloads during failed revalidation and stops after another user cancels', async ({
  page,
  request,
}) => {
  const fixture = await confirmedAccounting(request);
  await signInQuality(page, fixture.email, PASSWORD);
  await page.goto('/finance/filing');
  await page.getByRole('button', { name: '根拠と検算を確認', exact: true }).click();
  await page.getByRole('button', { name: 'ファイルを取得', exact: true }).click();
  const dialog = page.getByRole('dialog'),
    validate = dialog.getByRole('button', { name: '最新の根拠を検査して出力', exact: true });
  const files = dialog.getByRole('button', { name: /^HOT010_.+\.csv · shift_jis$/ });
  const output = await financeAction<FilingExport>(page, 'tax_filing.export', () => validate.click());
  expect(output.files).toHaveLength(2);
  await expect(files).toHaveCount(2);

  let requests = 0,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/actions/tax_filing.export', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    requests += 1;
    await held;
    await route.fulfill(failedRead(503));
  });
  try {
    const failed = page.waitForResponse(
      (response) => response.url().endsWith('/actions/tax_filing.export') && response.request().method() === 'POST',
    );
    await validate.evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await expect(validate).toBeDisabled();
    await expect(files).toHaveCount(0);
    release();
    expect((await failed).status()).toBe(503);
    await expect(dialog.getByText('Synthetic refresh failure', { exact: true })).toBeVisible();
    await expect(files).toHaveCount(0);
    await expect(validate).toBeEnabled();
    expect(requests).toBe(1);
  } finally {
    release();
    await page.unroute('**/actions/tax_filing.export');
  }

  await financeAction<FilingExport>(page, 'tax_filing.export', () => validate.click());
  await expect(files).toHaveCount(2);
  const poll = page.waitForResponse(
    async (response) => {
      if (
        !response.url().endsWith('/actions/tax_filing.get') ||
        response.request().method() !== 'POST' ||
        !response.ok()
      )
        return false;
      const detail = (await response.json()) as { id: string; status: string };
      return detail.id === fixture.confirmed.id && detail.status === 'cancelled';
    },
    { timeout: 30_000 },
  );
  const cancelled = await api(request, fixture.other, '/actions/tax_filing.cancel', {
    kind: 'accounting',
    id: fixture.confirmed.id,
    expectedVersion: fixture.confirmed.version,
    reason: '別担当者が確認資料を取消',
  });
  await poll;
  await expect(files).toHaveCount(0);
  await expect(validate).toBeDisabled();
  const current = await api(request, fixture.other, '/actions/tax_filing.get', {
    kind: 'accounting',
    id: fixture.confirmed.id,
  });
  expect(current).toMatchObject({ id: fixture.confirmed.id, version: cancelled.version, status: 'cancelled' });
});
