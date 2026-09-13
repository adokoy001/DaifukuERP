import { expect, test } from '@playwright/test';
import { api, API } from './operations-helpers.ts';
import {
  fiscalAction,
  fiscalChecks,
  fiscalDialogAction,
  fiscalFixture,
  fiscalSignIn,
  fiscalTab,
  PASSWORD,
} from './fiscal-helpers.ts';

test('enterprise payroll: verified conditions, automatic deductions, mobile declaration, review and planned variable hours', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const f = await fiscalFixture(request);
  await fiscalSignIn(page, f.payroll.email);
  await page.goto('/workforce/payroll');
  await expect(page.getByTestId('fiscal-management')).toBeVisible();
  await fiscalAction(page, 'initialize_payroll_rules', () =>
    page.getByRole('button', { name: '2026年の制度資料を準備', exact: true }).click(),
  );
  await page.getByLabel('従業員', { exact: true }).selectOption(f.employee.id);
  await page.getByRole('button', { name: '適用期間を追加', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('生年月日', { exact: true }).fill('1993-04-10');
  await dialog.getByLabel('健康保険の標準報酬月額（加入時必須）', { exact: true }).fill('300000');
  await dialog.getByLabel('厚生年金の標準報酬月額（加入時必須）', { exact: true }).fill('300000');
  await dialog.getByLabel('住民税の通知月額', { exact: true }).fill('12000');
  await dialog.getByLabel('住民税通知の資料番号・根拠', { exact: true }).fill('Synthetic 2026 resident tax notice');
  await dialog.getByLabel('加入・非加入・免除の根拠', { exact: true }).fill('Synthetic enrollment documents');
  await dialog
    .getByLabel('全体の確認記録・資料番号', { exact: true })
    .fill('Synthetic original salary and family facts');
  await fiscalChecks(page);
  await fiscalDialogAction(page, 'save_payroll_condition', '確認済みの条件を保存');
  await fiscalTab(page, '給与の算定');
  await page.getByLabel('給与対象月', { exact: true }).fill('2026-08');
  await page.getByRole('button', { name: '選択した従業員の税・保険込みで算定', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('給与支払日', { exact: true }).fill('2026-09-10');
  await dialog.getByLabel('健康保険・厚生年金の対象月', { exact: true }).fill('2026-08');
  await dialog
    .getByLabel('その他控除の根拠（該当なしも明記）', { exact: true })
    .fill('No other deductions in synthetic fixture');
  await fiscalChecks(page);
  await fiscalDialogAction(page, 'calculate_statutory_payroll', '根拠を確認して算定');
  await page.getByRole('button', { name: '選択した従業員の税・保険込みで算定', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('給与支払日', { exact: true })).toHaveValue('2026-09-10');
  await expect(dialog.getByLabel('その他控除の根拠（該当なしも明記）', { exact: true })).toHaveValue(
    'No other deductions in synthetic fixture',
  );
  await expect(
    dialog.getByRole('checkbox', {
      name: '対象期間の勤怠・有給・訂正・賃金条件と手当をすべて確認しました',
      exact: true,
    }),
  ).not.toBeChecked();
  await dialog.getByRole('button', { name: '戻る', exact: true }).click();
  await page.getByRole('button', { name: '確認・確定', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '自動算定した給与を確定', exact: true })).toBeVisible();
  await expect(dialog.getByText('健康保険', { exact: true })).toBeVisible();
  await expect(dialog.locator('input[name="income_tax.amount"]')).toHaveCount(0);
  await dialog.getByLabel('確認記録', { exact: true }).fill('Synthetic headquarters review of computed deductions');
  await fiscalChecks(page);
  await fiscalDialogAction(page, 'confirm_payroll', '根拠を確認して給与を確定');
  await expect(page.getByText('確定済み', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await fiscalSignIn(page, f.person.email);
  await expect(page).toHaveURL(/\/me$/);
  await fiscalTab(page, '給与');
  await page.getByLabel('表示する月', { exact: true }).fill('2026-08');
  await page.getByRole('button', { name: '明細を見る', exact: true }).click();
  await expect(page.getByText('所得税', { exact: true })).toBeVisible();
  await fiscalTab(page, '年末調整');
  await page.getByRole('button', { name: '年末調整を申告', exact: true }).click();
  dialog = page.getByRole('dialog');
  const family = dialog
    .locator('section.fiscal-form-section')
    .filter({ has: page.getByRole('heading', { name: '2. 配偶者と扶養親族', exact: true }) });
  await family.getByRole('button', { name: '追加', exact: true }).click();
  await family.getByLabel('家族の識別名（例：子1）', { exact: true }).fill('Child1');
  await family.getByLabel('生年月日', { exact: true }).fill('2020-01-10');
  await expect(family.locator('input[name="relative0.claimDependentDeduction"]')).not.toBeChecked();
  await dialog
    .getByLabel('申告全体の資料番号・確認記録', { exact: true })
    .fill('Synthetic employee evidence: child claimed by another parent; no insurance claims or previous employer');
  for (const checkbox of await dialog.locator('input[type="checkbox"][required]').all()) await checkbox.check();
  await page.route('**/actions/workforce.submit_year_end_declaration', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INTERNAL',
          message: 'Synthetic temporary connection failure',
          hint: 'Retry with the retained declaration.',
        },
      }),
    }),
  );
  await dialog.getByRole('button', { name: '確認して本部へ提出', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Synthetic temporary connection failure');
  await expect(dialog.getByLabel('申告全体の資料番号・確認記録', { exact: true })).toHaveValue(
    /Synthetic employee evidence/,
  );
  await page.unroute('**/actions/workforce.submit_year_end_declaration');
  await fiscalDialogAction(page, 'submit_year_end_declaration', '確認して本部へ提出');
  await expect(page.getByText('確認待ち', { exact: true })).toBeVisible();
  await page.getByText('提出した内容を確認', { exact: true }).click();
  await expect(
    page.getByText('この本人は扶養等の控除を申告しない（子の特例判定には使用）', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('year-end-mobile-390.png'), fullPage: true });
  const employeeLogin = await api<{ token: string }>(request, {}, '/auth/login', {
    email: f.person.email,
    password: PASSWORD,
  });
  const forbidden = await request.post(API + '/actions/workforce.fiscal_board', {
    headers: { authorization: 'Bearer ' + employeeLogin.token, 'x-company-id': f.company.id },
    data: { taxYear: 2026 },
  });
  expect(forbidden.status()).toBe(403);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await fiscalSignIn(page, f.payroll.email);
  await page.goto('/workforce/payroll');
  await fiscalTab(page, '年末調整');
  await page.getByRole('button', { name: '申告を確認・受付', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('この本人は扶養等の控除を申告しない（子の特例判定には使用）', { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('確認根拠・理由', { exact: true }).fill('Synthetic supporting certificates reviewed');
  await fiscalDialogAction(page, 'review_year_end_declaration', '申告内容と証明資料を確認');
  await expect(page.getByText('受付済み', { exact: true })).toBeVisible();

  await fiscalSignIn(page, f.manager.email);
  await page.goto('/workforce/systems');
  await expect(page.getByTestId('work-system-management')).toBeVisible();
  const month = await page.getByLabel('表示月', { exact: true }).inputValue();
  await page.getByLabel('従業員', { exact: true }).selectOption(f.employee.id);
  await page.getByRole('button', { name: '選択した従業員の制度を作成', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '勤務制度', exact: true }).selectOption('monthly_variable');
  const weekdays: string[] = [];
  const date = new Date(month + '-01T00:00:00Z');
  while (weekdays.length < 2) {
    if (![0, 6].includes(date.getUTCDay())) weekdays.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  await dialog.getByLabel(weekdays[0] + ' 予定終了', { exact: true }).fill('20:00');
  await dialog.getByLabel(weekdays[0] + ' 所定分数', { exact: true }).fill('600');
  await dialog.getByLabel(weekdays[1] + ' 所定分数', { exact: true }).fill('0');
  await dialog
    .getByLabel('就業規則・労使協定等の資料番号', { exact: true })
    .fill('Synthetic pre-agreed variable working calendar');
  await dialog
    .getByLabel('対象者・制度・所定時間の確認記録', { exact: true })
    .fill('Synthetic manager review before period starts');
  await dialog.getByRole('checkbox', { name: '適用する就業規則・労使協定等と周知を確認しました', exact: true }).check();
  await fiscalDialogAction(page, 'save_work_system', '所定カレンダーを保存');
  await expect(page.getByRole('button', { name: '制度を取消', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '開始前に確定', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('確認根拠・理由', { exact: true }).fill('Confirmed before work starts, synthetic evidence');
  await fiscalDialogAction(page, 'confirm_work_system', '確認して実行');
  await expect(page.getByText('確定済み', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('所定カレンダーを見る', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('work-system-mobile-390.png'), fullPage: true });
});
