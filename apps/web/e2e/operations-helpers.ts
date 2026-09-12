import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { BUSINESS_DATE } from './environment.ts';
export const API = (process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
export const PASSWORD = 'Local-operations-check-928!';
export const DAY = BUSINESS_DATE;
export type Headers = Record<string, string>;
export type Row = Record<string, unknown> & { id: string; version: number };
export async function api<T = Row>(request: APIRequestContext, headers: Headers, path: string, data?: unknown, method?: string): Promise<T> {
  const res = await request.fetch(API + path, { headers, method: method ?? (data === undefined ? 'GET' : 'POST'), ...(data === undefined ? {} : { data }) });
  expect(res.ok(), path + ': ' + await res.text()).toBe(true);
  return res.json() as Promise<T>;
}
export async function login(page: Page, email = process.env.E2E_EMAIL ?? 'admin@example.com', password = process.env.E2E_PASSWORD ?? 'password') {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(email); await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
}
export async function restaurant(page: Page) {
  await page.goto('/templates');
  await page.getByLabel('対象の会社', { exact: true }).selectOption({ label: '飲食チェーンサンプル｜こもれび食堂' });
  await expect(page.getByRole('link', { name: 'チェーン運営', exact: true })).toBeVisible();
  return page.getByLabel('対象の会社', { exact: true }).inputValue();
}
export async function adminHeaders(request: APIRequestContext, companyId: string) {
  const session = await api<{ token: string }>(request, {}, '/auth/login', { email: process.env.E2E_EMAIL ?? 'admin@example.com', password: process.env.E2E_PASSWORD ?? 'password' });
  return { authorization: 'Bearer ' + session.token, 'x-company-id': companyId };
}
export async function newStore(request: APIRequestContext, headers: Headers, name: string) {
  const stores = await api<{ items: Row[] }>(request, headers, '/api/restaurant_chain_store?limit=500');
  const source = stores.items.find((row) => row.code === 'RC-A');
  expect(source).toBeDefined();
  const warehouse = await api(request, headers, '/api/warehouse', { code: 'OPS' + Date.now(), name: name + ' 厨房' });
  return api(request, headers, '/api/restaurant_chain_store', { code: 'OPS' + Date.now(), name, warehouseId: warehouse.id, partnerId: source?.partnerId, cashAccountId: source?.cashAccountId });
}
export async function member(request: APIRequestContext, headers: Headers, companyId: string, storeId: string, role: string) {
  const email = role + '.' + Date.now() + '@example.com';
  const user = await api(request, headers, '/admin/users', { name: role + ' UI検証', email, password: PASSWORD });
  await api(request, headers, '/admin/users/' + user.id + '/companies/' + companyId, { expectedVersion: 0, roles: [role], accessScope: 'stores', storeIds: [storeId] }, 'PUT');
  return { ...user, email };
}
export async function openOperations(page: Page, storeId?: string) {
  await page.goto('/operations?from=' + DAY + '&to=' + DAY + '&asOf=' + DAY + (storeId ? '&storeId=' + storeId : ''));
  await expect(page.getByTestId('operations-board')).toBeVisible();
}
export async function boardAction(page: Page, label: string, confirm: string, note?: string) {
  await page.getByTestId('operations-board').getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (note) await dialog.getByLabel('差戻し理由').fill(note);
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && /actions\/restaurant_chain\.(review|submit_for_review|finalize)$/.test(r.url()));
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
  const res = await response; expect(res.ok(), await res.text()).toBe(true);
  await expect(dialog).toHaveCount(0);
}
