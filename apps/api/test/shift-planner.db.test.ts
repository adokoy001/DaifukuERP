import { companyMemberships, hashPassword, newId, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { MyShifts, ShiftBoard } from '@daifuku/mod-workforce/shift-contract';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb, app: FastifyInstance, admin: string, siteId: string, otherSiteId: string;
let employee: { id: string; token: string; employeeId: string }, manager: { id: string; token: string; employeeId: string };
const weekStart = '2026-09-14';
const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${14 + i}`, preference: 'preferred', startMinute: 540, endMinute: 1020 }));
const profile = { skills: ['接客'], employmentType: 'part_time', targetMinutes: 1200, maxWeeklyMinutes: 1800, maxDailyMinutes: 480, maxDays: 5, maxConsecutiveDays: 5, minRestMinutes: 660 };
const request = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: InjectOptions['payload']) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload === undefined ? {} : { payload }) });
async function login(email: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200); return response.json<{ token: string }>().token;
}
async function command(name: string, token: string, input: InjectOptions['payload']) {
  const response = await request('POST', '/actions/workforce.' + name, token, input);
  expect(response.statusCode, response.body).toBe(200); return response.json<{ id: string; version: number }>();
}
async function person(name: string, role: string) {
  const id = newId(), email = name + '@example.com';
  await db.owner.drizzle.insert(users).values({ id, tenantId: db.tenantId, email, name, passwordHash: hashPassword('shift-test-password'), roles: [], defaultCompanyId: db.companyId });
  await db.owner.drizzle.insert(companyMemberships).values({ tenantId: db.tenantId, userId: id, companyId: db.companyId, roles: [role], accessScope: 'sites', siteIds: [siteId] });
  const row = await command('register_employee', admin, { userId: id, siteId, code: name, name, hiredOn: '2026-01-01' });
  return { id, token: await login(email, 'shift-test-password'), employeeId: row.id };
}
beforeAll(async () => {
  db = await freshDb(); app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'synthetic-shift-adapter-secret' }); await app.ready();
  admin = await login('admin@example.com', 'password');
  for (const code of ['A', 'B']) {
    const response = await request('POST', '/api/workforce_site', admin, { code, name: code }); expect(response.statusCode, response.body).toBe(200);
    if (code === 'A') siteId = response.json<{ id: string }>().id; else otherSiteId = response.json<{ id: string }>().id;
  }
  await command('initialize_policy', admin, {});
  employee = await person('shift-employee', 'workforce_employee'); manager = await person('shift-manager', 'workforce_manager');
});
afterAll(async () => { await app?.close(); await db?.close(); });

describe('employee-shift-planner generated HTTP boundaries', () => {
  it('exposes self-service only to the employee and rejects forged ownership and manager operations', async () => {
    const meta = await request('GET', '/meta', employee.token); expect(meta.statusCode).toBe(200);
    const actions = meta.json<{ actions: { name: string }[] }>().actions.map((row) => row.name);
    expect(actions).toContain('workforce.my_shifts'); expect(actions).toContain('workforce.save_shift_availability'); expect(actions).not.toContain('workforce.shift_board');
    const forged = await request('POST', '/actions/workforce.save_shift_availability', employee.token, { weekStart, expectedVersion: 0, days, employeeId: manager.employeeId });
    expect(forged.statusCode).toBe(400);
    expect((await request('POST', '/actions/workforce.shift_board', employee.token, { siteId, weekStart })).statusCode).toBe(403);
    expect((await request('POST', '/actions/workforce.save_shift_profile', employee.token, { employeeId: employee.employeeId, expectedVersion: 0, profile })).statusCode).toBe(403);
    await command('save_shift_availability', employee.token, { weekStart, expectedVersion: 0, days });
    const own = await request('POST', '/actions/workforce.my_shifts', employee.token, { weekStart });
    expect(own.statusCode, own.body).toBe(200); expect(own.headers['cache-control']).toBe('private, no-store');
    const data = own.json<MyShifts>(); expect(data.employee?.id).toBe(employee.employeeId); expect(data.availability?.days).toHaveLength(7);
    expect(own.body).not.toContain(manager.employeeId); expect(data.assignments).toEqual([]);
  });
  it('limits planning snapshots to the assigned site without payroll, expense or leave reasons', async () => {
    await command('save_shift_profile', manager.token, { employeeId: employee.employeeId, expectedVersion: 0, profile });
    const response = await request('POST', '/actions/workforce.shift_board', manager.token, { siteId, weekStart });
    expect(response.statusCode, response.body).toBe(200);
    const board = response.json<ShiftBoard>(); expect(board.problem.employees.find((row) => row.id === employee.employeeId)?.profile).toMatchObject(profile);
    for (const field of ['payrolls', 'expenses', 'passwordHash', 'grossPay', 'reviewReason']) expect(response.body).not.toContain('"' + field + '"');
    expect((await request('POST', '/actions/workforce.shift_board', manager.token, { siteId: otherSiteId, weekStart })).statusCode).toBe(404);
    const generic = await request('POST', '/api/workforce_shift_plan', manager.token, { siteId, weekStart, status: 'published', slots: [], assignments: [] });
    expect(generic.statusCode).toBeGreaterThanOrEqual(400);
  });
  it('rechecks current membership for an already signed-in manager', async () => {
    expect((await request('POST', '/actions/workforce.shift_board', manager.token, { siteId, weekStart })).statusCode).toBe(200);
    await db.owner.sql`update user_company_memberships set site_ids = '[]'::jsonb where user_id = ${manager.id}`;
    const denied = await request('POST', '/actions/workforce.shift_board', manager.token, { siteId, weekStart });
    expect(denied.statusCode).toBe(404); expect(denied.body).not.toContain(employee.employeeId);
  });
});
