import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import type { MyShifts, ShiftBoard } from '@daifuku/mod-workforce/shift-contract';
import { api } from './operations-helpers.ts';
import { assertNoOverflow, failedRead } from './quality-helpers.ts';
import { openMyShifts, openPlanner, SHIFT_WEEK, shiftAction, shiftDays, shiftFixture, signInQuality, type ShiftFixture } from './shift-helpers.ts';

async function submitMobileHope(page: Page, f: ShiftFixture) {
  await page.setViewportSize({ width: 375, height: 812 }); await openMyShifts(page, f.alice.email);
  await page.getByRole('button', { name: '希望を提出', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('combobox', { name: '勤務希望', exact: true })).toHaveCount(7);
  await expect(dialog.getByRole('combobox', { name: '勤務希望', exact: true }).nth(0)).toHaveValue('unavailable');
  for (const index of [0, 1]) await dialog.getByRole('combobox', { name: '勤務希望', exact: true }).nth(index).selectOption('preferred');
  await page.route('**/actions/workforce.save_shift_availability', (route) => route.fulfill(failedRead()));
  await dialog.getByRole('button', { name: '7日分の希望を提出', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Synthetic refresh failure');
  await expect(dialog.getByRole('combobox', { name: '勤務希望', exact: true }).nth(0)).toHaveValue('preferred'); await page.screenshot({ path: test.info().outputPath('shift-availability-form-mobile.png'), fullPage: true }); await page.unroute('**/actions/workforce.save_shift_availability');
  await shiftAction(page, 'save_shift_availability', () => dialog.getByRole('button', { name: '7日分の希望を提出', exact: true }).click());
  await expect(dialog).toHaveCount(0); await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('shift-availability-mobile.png'), fullPage: true });
}
async function configurePerson(page: Page, f: ShiftFixture) {
  await page.setViewportSize({ width: 1440, height: 1100 }); await signInQuality(page, f.manager.email); await page.goto('/workforce');
  await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: '従業員', exact: true }).click();
  const card = page.locator('article.workforce-record').filter({ hasText: f.alice.name });
  await card.getByRole('button', { name: '勤務条件を編集', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('対応スキル（カンマ区切り）', { exact: true }).fill('接客');
  await dialog.getByLabel('週の目標（分）', { exact: true }).fill('960');
  await dialog.getByLabel('週の上限（分）', { exact: true }).fill('960');
  await shiftAction(page, 'save_shift_profile', () => dialog.getByRole('button', { name: '勤務条件を保存', exact: true }).click()); await expect(dialog).toHaveCount(0);
}
async function addDemand(page: Page, date: string, name: string, required: number) {
  const day = page.locator('section.shift-day').filter({ has: page.getByRole('heading', { name: date, exact: true }) });
  await day.getByRole('button', { name: '勤務枠を追加', exact: true }).click();
  const row = day.locator('fieldset.shift-slot-fields').last();
  await row.getByLabel('枠の名前', { exact: true }).fill(name); await row.getByLabel('必要人数', { exact: true }).fill(String(required));
  await row.getByLabel('必要スキル（任意）', { exact: true }).fill('接客');
}

test('employee shifts: mobile hope, employee profile, real worker, locked refinement, shortage publication and personal schedule', async ({ page, request }) => {
  test.setTimeout(240000); const f = await shiftFixture(request);
  await submitMobileHope(page, f); await configurePerson(page, f); await openPlanner(page, f);
  await addDemand(page, SHIFT_WEEK, '接客チーム', 3); await addDemand(page, '2026-09-15', '開店チーム', 1);
  const workerEvent = page.waitForEvent('worker'); await page.getByRole('button', { name: '推薦案を作る', exact: true }).click(); await workerEvent;
  await expect(page.getByRole('status').filter({ hasText: '反復で計算済み' })).toBeVisible();
  const monday = page.locator('article.shift-assignment-card').filter({ hasText: '接客チーム' });
  await expect(monday).toContainText('3 / 2 / 1'); await expect(monday.locator('.shift-assigned')).toHaveCount(2);
  await monday.getByText('候補を外れた理由', { exact: true }).click(); await expect(monday).toContainText('希望が未提出');
  await monday.getByRole('checkbox', { name: '固定', exact: true }).first().check();
  const lockedName = await monday.locator('.shift-assigned').first().locator('span').textContent();
  await page.getByRole('button', { name: '推薦案を作る', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '反復で計算済み' })).toBeVisible();
  await expect(monday.locator('.shift-assigned').filter({ hasText: lockedName ?? '' }).getByRole('checkbox')).toBeChecked();
  await page.route('**/actions/workforce.save_shift_plan', (route) => route.fulfill(failedRead()));
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Synthetic refresh failure');
  await expect(monday.locator('.shift-assigned')).toHaveCount(2); await page.unroute('**/actions/workforce.save_shift_plan');
  const draft = await shiftAction(page, 'save_shift_plan', () => page.getByRole('button', { name: '下書きを保存', exact: true }).click());
  const privateView = await api<MyShifts>(request, f.alice.headers, '/actions/workforce.my_shifts', { weekStart: SHIFT_WEEK }); expect(privateView.assignments).toEqual([]);
  await page.getByRole('button', { name: '内容を確認して公開へ', exact: true }).click(); const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('不足人数（延べ）'); await dialog.getByLabel('確認理由・対応方針', { exact: true }).fill('合成試験: 応援要員を別途確保する');
  let publications = 0; page.on('request', (r) => { if (r.url().endsWith('/actions/workforce.publish_shift_plan')) publications++; });
  await dialog.getByRole('button', { name: '確認して公開', exact: true }).click(); expect(publications).toBe(0);
  await dialog.getByRole('checkbox', { name: '不足が残ることと対応方針を確認しました', exact: true }).check();
  await shiftAction(page, 'publish_shift_plan', () => dialog.getByRole('button', { name: '確認して公開', exact: true }).click());
  await expect(dialog).toHaveCount(0); await expect(page.getByText('現在の公開版', { exact: false }).first()).toBeVisible();
  await assertNoOverflow(page); await page.locator('main').evaluate((element) => { element.scrollTop = 0; }); await page.screenshot({ path: test.info().outputPath('shift-planner-desktop.png'), fullPage: true });
  await page.getByRole('table', { name: '勤務枠ごとの割当', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath('shift-results-desktop.png'), fullPage: true });
  const published = await api<ShiftBoard>(request, f.manager.headers, '/actions/workforce.shift_board', { siteId: f.site.id, weekStart: SHIFT_WEEK });
  expect(published.published?.id).toBe(draft.id); expect(published.publishedEvaluation?.issues).toEqual([]);
  expect(published.published?.assignments.some((row) => row.employeeId === f.missing.employee.id)).toBe(false);
  await page.setViewportSize({ width: 375, height: 812 }); await openMyShifts(page, f.alice.email);
  await expect(page.getByTestId('my-shifts')).toContainText('接客チーム'); await expect(page.getByTestId('my-shifts')).not.toContainText(f.bob.name); await assertNoOverflow(page);
  await page.getByRole('heading', { name: '公開された自分の勤務', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath('shift-published-mobile.png'), fullPage: true });
});

test('employee shifts: source changes preserve edits, block stale save and require re-evaluation', async ({ page, request }) => {
  const f = await shiftFixture(request); await openPlanner(page, f); await addDemand(page, SHIFT_WEEK, '更新確認枠', 1);
  await api(request, f.bob.headers, '/actions/workforce.save_shift_availability', { weekStart: SHIFT_WEEK, expectedVersion: 1, days: shiftDays('unavailable') });
  await page.getByRole('button', { name: '最新の資料を確認', exact: true }).click();
  await expect(page.getByText('元情報または下書きが更新されました', { exact: true })).toBeVisible();
  await expect(page.getByLabel('枠の名前', { exact: true })).toHaveValue('更新確認枠'); await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '最新資料で再評価', exact: true }).click();
  await page.getByRole('button', { name: '推薦案を作る', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: '反復で計算済み' })).toBeVisible();
  await expect(page.locator('.shift-assigned')).toHaveCount(0); await expect(page.locator('article.shift-assignment-card')).toContainText('1 / 0 / 1');
  await shiftAction(page, 'save_shift_plan', () => page.getByRole('button', { name: '下書きを保存', exact: true }).click());
  await page.setViewportSize({ width: 375, height: 812 }); await assertNoOverflow(page);
});

async function publishFromApi(request: APIRequestContext, f: ShiftFixture, label: string) {
  const source = await api<ShiftBoard>(request, f.manager.headers, '/actions/workforce.shift_board', { siteId: f.site.id, weekStart: SHIFT_WEEK });
  const slot = { id: crypto.randomUUID(), date: SHIFT_WEEK, label, startMinute: 540, endMinute: 1080, breakMinutes: 60, required: 1, skill: '接客' };
  const draft = await api<{ id: string; version: number }>(request, f.manager.headers, '/actions/workforce.save_shift_plan', { siteId: f.site.id, weekStart: SHIFT_WEEK, expectedVersion: 0, sourceRevision: source.sourceRevision, slots: [slot], assignments: [{ slotId: slot.id, employeeId: f.bob.employee.id, locked: true }], seed: 13 });
  const current = await api<ShiftBoard>(request, f.manager.headers, '/actions/workforce.shift_board', { siteId: f.site.id, weekStart: SHIFT_WEEK });
  await api(request, f.manager.headers, '/actions/workforce.publish_shift_plan', { planId: draft.id, expectedVersion: draft.version, sourceRevision: current.sourceRevision, acknowledgeShortage: false, reason: '合成試験: 別経路で確認公開' });
  return draft.id;
}
async function confirmPlan(page: Page, action: 'publish_shift_plan' | 'cancel_shift_plan') {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('確認理由・対応方針', { exact: true }).fill('合成試験: 社員と確認した改訂・取消');
  const result = await shiftAction(page, action, () => dialog.getByRole('button', { name: action === 'publish_shift_plan' ? '確認して公開' : '理由を記録して取消', exact: true }).click());
  await expect(dialog).toHaveCount(0); return result;
}

test('employee shifts: external publication refresh, revision draft cancellation, confirmed revision and publication cancellation', async ({ page, request }) => {
  test.setTimeout(180000); const f = await shiftFixture(request);
  const originalId = await publishFromApi(request, f, '初回公開枠'); await openPlanner(page, f);
  await expect(page.getByLabel('枠の名前', { exact: true })).toHaveValue('初回公開枠');
  await expect(page.getByLabel('枠の名前', { exact: true })).toBeDisabled();
  const externalId = await publishFromApi(request, f, '別経路改訂枠'); expect(externalId).not.toBe(originalId);
  await page.getByRole('button', { name: '最新の資料を確認', exact: true }).click();
  await expect(page.getByLabel('枠の名前', { exact: true })).toHaveValue('別経路改訂枠');
  await expect(page.locator('article.shift-assignment-card')).toContainText('別経路改訂枠');
  await expect(page.locator('.shift-assigned')).toHaveCount(1); await expect(page.locator('.shift-assigned')).toContainText(f.bob.name);
  await page.getByRole('button', { name: '公開版から改訂案を作る', exact: true }).click();
  await page.getByLabel('枠の名前', { exact: true }).fill('取り消す下書き');
  const abandoned = await shiftAction(page, 'save_shift_plan', () => page.getByRole('button', { name: '下書きを保存', exact: true }).click());
  expect(abandoned.id).not.toBe(externalId);
  const personalBefore = await api<MyShifts>(request, f.bob.headers, '/actions/workforce.my_shifts', { weekStart: SHIFT_WEEK });
  expect(personalBefore.assignments.map((row) => row.label)).toEqual(['別経路改訂枠']);
  await page.getByRole('button', { name: '下書きを取り消す', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('現在の公開版はそのまま保持されます');
  await confirmPlan(page, 'cancel_shift_plan');
  await expect(page.getByLabel('枠の名前', { exact: true })).toHaveValue('別経路改訂枠');
  const afterCancel = await api<ShiftBoard>(request, f.manager.headers, '/actions/workforce.shift_board', { siteId: f.site.id, weekStart: SHIFT_WEEK });
  expect(afterCancel.draft).toBeNull(); expect(afterCancel.published?.id).toBe(externalId);
  await page.getByRole('button', { name: '公開版から改訂案を作る', exact: true }).click();
  await page.getByLabel('枠の名前', { exact: true }).fill('確認済み改訂枠');
  const revision = await shiftAction(page, 'save_shift_plan', () => page.getByRole('button', { name: '下書きを保存', exact: true }).click());
  expect(revision.id).not.toBe(externalId); expect(revision.id).not.toBe(abandoned.id);
  await page.getByRole('button', { name: '内容を確認して公開へ', exact: true }).click(); await confirmPlan(page, 'publish_shift_plan');
  const personalAfter = await api<MyShifts>(request, f.bob.headers, '/actions/workforce.my_shifts', { weekStart: SHIFT_WEEK });
  expect(personalAfter.assignments.map((row) => row.label)).toEqual(['確認済み改訂枠']);
  expect(personalAfter.assignments.every((row) => row.planId === revision.id)).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 }); await assertNoOverflow(page);
  await page.screenshot({ path: test.info().outputPath('shift-revision-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '公開を取り消す', exact: true }).click(); await confirmPlan(page, 'cancel_shift_plan');
  const cancelled = await api<MyShifts>(request, f.bob.headers, '/actions/workforce.my_shifts', { weekStart: SHIFT_WEEK });
  expect(cancelled.assignments).toEqual([]);
  await expect(page.getByText('現在の公開版', { exact: false })).toHaveCount(0); await expect(page.locator('.shift-assigned')).toHaveCount(0);
});


test('employee shifts: losing site membership during editing removes the old employee data after a real 404', async ({ page, request }) => {
  const f = await shiftFixture(request); await openPlanner(page, f); await addDemand(page, SHIFT_WEEK, '権限変更確認枠', 1);
  await expect(page.getByTestId('shift-planner')).toContainText(f.bob.name);
  const otherSite = await api(request, f.headers, '/api/workforce_site', { code: 'REVOKE-' + f.suffix, name: '変更先拠点 ' + f.suffix });
  await api(request, f.headers, `/admin/users/${f.manager.user.id}/companies/${f.companyId}`, { expectedVersion: 1, roles: ['workforce_manager'], accessScope: 'sites', siteIds: [otherSite.id], storeIds: [] }, 'PUT');
  const response = page.waitForResponse((row) => row.url().endsWith('/actions/workforce.save_shift_plan') && row.request().method() === 'POST');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  expect((await response).status()).toBe(404);
  await expect(page.getByText(f.bob.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText(f.alice.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '計画する拠点', exact: true })).toHaveValue(otherSite.id);
  await expect(page.getByTestId('shift-planner')).not.toContainText(f.bob.name);
});
