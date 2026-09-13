import { expect, test } from '@playwright/test';
import { api } from './operations-helpers.ts';
import { fiscalFixture, fiscalSignIn, fiscalTab } from './fiscal-helpers.ts';

test('payroll rules: unavailable catalog preserves saved payroll and recovers calculation controls', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const f = await fiscalFixture(request);
  await api(request, f.headers, '/actions/workforce.initialize_payroll_rules', {});
  const saved = await api(request, f.headers, '/actions/workforce.calculate_payroll', {
    employeeId: f.employee.id,
    period: '2026-08',
    expectedVersion: 0,
    attendanceCompleteConfirmed: true,
  });
  const before = await api(request, f.headers, `/api/workforce_payroll/${saved.id}`);
  await fiscalSignIn(page, f.payroll.email);
  await page.route('**/actions/workforce.payroll_rule_catalog', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INVALID_STATE',
          message: 'Synthetic unavailable rule distribution',
          hint: 'Review the installed distribution.',
        },
      }),
    }),
  );
  await page.goto('/workforce/payroll');
  await expect(page.getByTestId('fiscal-management')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Synthetic unavailable rule distribution');
  await expect(page.getByRole('button', { name: '制度の詳細・導入', exact: true })).toHaveCount(0);
  await fiscalTab(page, '給与の算定');
  await page.getByLabel('給与対象月', { exact: true }).fill('2026-08');
  await page.getByLabel('従業員', { exact: true }).selectOption(f.employee.id);
  const record = page
    .locator('article.workforce-record')
    .filter({ has: page.getByRole('heading', { name: `2026-08 給与本人 ${f.runId}`, exact: true }) });
  await expect(record).toBeVisible();
  await record.getByRole('button', { name: '明細を見る', exact: true }).click();
  await expect(record.getByText('総支給額', { exact: true })).toBeVisible();
  const calculate = page.getByRole('button', { name: '選択した従業員の税・保険込みで算定', exact: true });
  await expect(calculate).toBeDisabled();
  await page.unroute('**/actions/workforce.payroll_rule_catalog');
  const rules = page
    .locator('section.workforce-panel')
    .filter({ has: page.getByRole('heading', { name: '制度の版と出典', exact: true }) });
  await rules.getByRole('button', { name: '最新の状態を確認', exact: true }).click();
  await expect(page.getByRole('button', { name: '制度の詳細・導入', exact: true })).toBeVisible();
  await expect(calculate).toBeEnabled();
  await expect(record.getByText('総支給額', { exact: true })).toBeVisible();
  expect(await api(request, f.headers, `/api/workforce_payroll/${saved.id}`)).toEqual(before);
});
