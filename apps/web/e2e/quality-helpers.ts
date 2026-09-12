import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { api, PASSWORD, type Headers } from './operations-helpers.ts';
export async function qualitySession(request: APIRequestContext) {
  const session = await api<{ token: string; user: { defaultCompanyId: string } }>(request, {}, '/auth/login', { email: process.env.E2E_EMAIL ?? 'admin@example.com', password: process.env.E2E_PASSWORD ?? 'password' });
  return { companyId: session.user.defaultCompanyId, headers: { authorization: `Bearer ${session.token}`, 'x-company-id': session.user.defaultCompanyId } };
}
export async function qualityEmployee(request: APIRequestContext, role: 'workforce_employee' | 'workforce_manager' = 'workforce_employee') {
  const { headers, companyId } = await qualitySession(request), suffix = crypto.randomUUID().slice(0, 8);
  const site = await api(request, headers, '/api/workforce_site', { code: 'Q-' + suffix, name: '品質検証拠点 ' + suffix });
  const email = `quality-${suffix}@example.com`, user = await api(request, headers, '/admin/users', { name: '品質検証 ' + suffix, email, password: PASSWORD });
  await api(request, headers, `/admin/users/${user.id}/companies/${companyId}`, { expectedVersion: 0, roles: [role], accessScope: 'sites', siteIds: [site.id], storeIds: [] }, 'PUT');
  const employee = await api(request, headers, '/actions/workforce.register_employee', { userId: user.id, siteId: site.id, code: 'Q-' + suffix, name: '品質検証 ' + suffix, hiredOn: '2026-01-01' });
  return { headers, companyId, email, employee, site, user };
}
export async function signInQuality(page: Page, email = process.env.E2E_EMAIL ?? 'admin@example.com', password = process.env.E2E_PASSWORD ?? 'password') {
  await page.goto('/login'); await page.getByLabel('メールアドレス', { exact: true }).fill(email); await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click(); await expect(page).not.toHaveURL(/\/login/);
}
export async function qualityPartner(request: APIRequestContext, headers: Headers, name: string) {
  return api(request, headers, '/api/partner', { code: 'Q' + crypto.randomUUID().replaceAll('-', '').slice(0, 15), name, isCustomer: true });
}
export const failedRead = (status = 503) => ({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status === 403 ? 'PERMISSION_DENIED' : status === 404 ? 'NOT_FOUND' : 'INTERNAL', message: 'Synthetic refresh failure', hint: 'Retry the read.' } }) });
export async function assertNoOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
