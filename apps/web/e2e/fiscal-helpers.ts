import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
export { PASSWORD };
export async function fiscalFixture(request: APIRequestContext) {
  const session = await api<{ token: string; user: { id: string; tenantId: string; defaultCompanyId: string } }>(request, {}, '/auth/login', { email: process.env.E2E_EMAIL ?? 'admin@example.com', password: process.env.E2E_PASSWORD ?? 'password' });
  const runId = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const text = execFileSync(process.execPath, [fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url)), fileURLToPath(new URL('../../api/test/commerce-e2e-fixture.ts', import.meta.url)), session.user.tenantId, session.user.id, runId], { env: process.env, encoding: 'utf8' });
  const company = (JSON.parse(text) as { id: string }[])[0]; if (!company) throw new Error('Missing synthetic company');
  const headers = { authorization: 'Bearer ' + session.token, 'x-company-id': company.id };
  const site = await api(request, headers, '/api/workforce_site', { code: 'FISCAL', name: '給与検証拠点 ' + runId });
  const member = async (role: string, name: string) => {
    const email = `fiscal-${role}-${runId}@example.invalid`, row = await api(request, headers, '/admin/users', { email, name, password: PASSWORD });
    await api(request, headers, `/admin/users/${row.id}/companies/${company.id}`, { expectedVersion: 0, roles: [role], accessScope: role === 'workforce_payroll' ? 'all' : 'sites', storeIds: [], siteIds: role === 'workforce_payroll' ? [] : [site.id] }, 'PUT');
    return { ...row, email };
  };
  const person = await member('workforce_employee', '給与本人 ' + runId), payroll = await member('workforce_payroll', '給与本部 ' + runId), manager = await member('workforce_manager', '勤務制度管理 ' + runId);
  const employee = await api(request, headers, '/actions/workforce.register_employee', { userId: person.id, siteId: site.id, code: 'FISCAL-' + runId, name: '給与本人 ' + runId, hiredOn: '2026-01-01' });
  const policy = await api(request, headers, '/api/workforce_pay_policy', { code: 'FISCAL-POLICY', name: '合成通常規程', validFrom: '2023-04-01', validTo: '2099-12-31', workSystem: 'ordinary', weekStartsOn: 1, dailyLimitMinutes: 480, weeklyLimitMinutes: 2400, breakAfterMinutes: 360, breakMinutes: 45, longBreakAfterMinutes: 480, longBreakMinutes: 60, nightStartsMinute: 1320, nightEndsMinute: 300, monthlyOvertimeThresholdMinutes: 3600, overtimePremiumRate: '0.25', highOvertimePremiumRate: '0.50', holidayPremiumRate: '0.35', nightPremiumRate: '0.25', basis: 'Synthetic E2E company agreement' });
  await api(request, headers, '/api/workforce_pay_terms', { employeeId: employee.id, policyId: policy.id, validFrom: '2026-01-01', validTo: '2026-12-31', payType: 'monthly', hourlyRate: '0', monthlySalary: '300000', monthlyBaseMinutes: 9600, paidLeaveDayMinutes: 480, confirmed: true, basis: 'Synthetic full-month fixed salary with attendance completion confirmed separately' });
  return { employee, person, payroll, manager, headers, company, runId };
}
export async function fiscalSignIn(page: Page, email: string) {
  await page.goto('/login'); await page.getByLabel('メールアドレス', { exact: true }).fill(email); await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'ログイン', exact: true }).click(); await expect(page).not.toHaveURL(/\/login/);
}
export async function fiscalAction(page: Page, name: string, run: () => Promise<void>) {
  const response = page.waitForResponse((r) => r.url().endsWith('/actions/workforce.' + name) && r.request().method() === 'POST');
  await run(); const result = await response; expect(result.ok(), name + ': ' + await result.text()).toBe(true); return result.json() as Promise<Row>;
}
export async function fiscalDialogAction(page: Page, name: string, button: string) {
  const row = await fiscalAction(page, name, () => page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click()); await expect(page.getByRole('dialog')).toHaveCount(0); return row;
}
export async function fiscalChecks(page: Page) { for (const checkbox of await page.getByRole('dialog').getByRole('checkbox').all()) await checkbox.check(); }
export async function fiscalTab(page: Page, label: string) { await page.getByRole('navigation', { name: '従業員業務' }).getByRole('button', { name: label, exact: true }).click(); }
