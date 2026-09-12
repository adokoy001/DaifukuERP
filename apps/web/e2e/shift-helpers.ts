import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { api, PASSWORD, type Headers } from './operations-helpers.ts';
import { qualitySession, signInQuality as signInBase } from './quality-helpers.ts';
export { PASSWORD };
export async function signInQuality(page: Page, email: string) { await signInBase(page, email, PASSWORD); }
export const SHIFT_WEEK = '2026-09-14';
export const shiftDays = (preference: 'preferred' | 'available' | 'unavailable' = 'preferred') => Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${14 + i}`, preference, startMinute: 540, endMinute: 1080 }));
export async function shiftFixture(request: APIRequestContext) {
  const { headers, companyId } = await qualitySession(request), suffix = crypto.randomUUID().slice(0, 8);
  const site = await api(request, headers, '/api/workforce_site', { code: 'SHIFT-' + suffix, name: 'シフト検証拠点 ' + suffix });
  async function member(name: string, role: string) {
    const email = `shift-${crypto.randomUUID()}@example.com`, user = await api(request, headers, '/admin/users', { name: `${name} ${suffix}`, email, password: PASSWORD });
    await api(request, headers, `/admin/users/${user.id}/companies/${companyId}`, { expectedVersion: 0, roles: [role], accessScope: 'sites', siteIds: [site.id], storeIds: [] }, 'PUT');
    const employee = await api(request, headers, '/actions/workforce.register_employee', { userId: user.id, siteId: site.id, code: `${name}-${suffix}`, name: `${name} ${suffix}`, hiredOn: '2026-01-01' });
    const session = await api<{ token: string }>(request, {}, '/auth/login', { email, password: PASSWORD });
    const own: Headers = { authorization: 'Bearer ' + session.token, 'x-company-id': companyId };
    return { email, employee, user, name: `${name} ${suffix}`, headers: own };
  }
  const alice = await member('青木', 'workforce_employee'), bob = await member('林', 'workforce_employee'), missing = await member('未提出', 'workforce_employee'), manager = await member('店長', 'workforce_manager');
  const profile = { skills: ['接客'], employmentType: 'part_time', targetMinutes: 960, maxWeeklyMinutes: 1920, maxDailyMinutes: 480, maxDays: 5, maxConsecutiveDays: 5, minRestMinutes: 660 };
  for (const person of [bob, missing]) await api(request, headers, '/actions/workforce.save_shift_profile', { employeeId: person.employee.id, expectedVersion: 0, profile });
  await api(request, bob.headers, '/actions/workforce.save_shift_availability', { weekStart: SHIFT_WEEK, expectedVersion: 0, days: shiftDays('available') });
  return { headers, companyId, site, suffix, alice, bob, missing, manager };
}
export type ShiftFixture = Awaited<ReturnType<typeof shiftFixture>>;
export async function shiftAction(page: Page, name: string, click: () => Promise<void>) {
  const waiting = page.waitForResponse((response) => response.url().endsWith('/actions/workforce.' + name) && response.request().method() === 'POST');
  await click(); const response = await waiting; expect(response.ok(), name + ': ' + await response.text()).toBe(true);
  return response.json() as Promise<{ id: string; version: number; status: string }>;
}
export async function openPlanner(page: Page, f: ShiftFixture) {
  await signInQuality(page, f.manager.email); await page.goto('/workforce/shifts');
  await expect(page.getByTestId('shift-page')).toBeVisible(); await page.getByLabel('計画する週（月曜）', { exact: true }).fill(SHIFT_WEEK);
  await expect(page.getByTestId('shift-planner')).toBeVisible(); await expect(page.getByRole('combobox', { name: '計画する拠点', exact: true })).toHaveValue(f.site.id);
}
export async function openMyShifts(page: Page, email: string) {
  await signInQuality(page, email); await page.goto('/me');
  await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: 'シフト', exact: true }).click();
  await page.getByLabel('希望・予定の週（月曜）', { exact: true }).fill(SHIFT_WEEK);
  await expect(page.getByTestId('my-shifts')).toBeVisible();
}
