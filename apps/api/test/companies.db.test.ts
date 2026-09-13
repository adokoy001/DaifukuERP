import { bootstrapTenant, newId } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let token: string;
let otherCompany: string;
let foreignCompany: string;
beforeAll(async () => {
  db = await freshDb();
  otherCompany = newId();
  await db.owner
    .sql`insert into companies(id,tenant_id,code,name) values(${otherCompany},${db.tenantId},'FARM','農家サンプル')`;
  const foreign = await bootstrapTenant(db.owner, {
    tenantName: 'Other tenant',
    companyCode: 'ALIEN',
    companyName: 'Hidden company',
    adminEmail: 'other@example.com',
    adminName: 'Other',
    adminPassword: 'password',
  });
  foreignCompany = foreign.companyId;
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'company-picker-test', logger: false });
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@example.com', password: 'password' },
  });
  token = login.json<{ token: string }>().token;
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('industry-templates selectable companies', () => {
  it('lists only companies in the authenticated tenant and resolves a selected company consistently', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/companies',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const list = response.json<{ items: { id: string; name: string }[]; companyId: string }>();
    expect(list.items.map((c) => c.id).sort()).toEqual([db.companyId, otherCompany].sort());
    expect(list.companyId).toBe(db.companyId);
    const selected = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}`, 'x-company-id': otherCompany },
    });
    expect(selected.json()).toMatchObject({
      companyId: otherCompany,
      company: { id: otherCompany, name: '農家サンプル' },
    });
  });
  it('rejects anonymous listing and a company outside the tenant without disclosing its name', async () => {
    expect((await app.inject({ method: 'GET', url: '/auth/companies' })).statusCode).toBe(401);
    const response = await app.inject({
      method: 'GET',
      url: '/auth/companies',
      headers: { authorization: `Bearer ${token}`, 'x-company-id': foreignCompany },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('Hidden company');
  });
  it.each(['not-a-uuid', '', newId()])(
    'rejects malformed or nonexistent company selection (%j) instead of recovering',
    async (companyId) => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/companies',
        headers: { authorization: `Bearer ${token}`, 'x-company-id': companyId },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION', details: { issues: [{ path: 'headers.x-company-id' }] } },
      });
      expect(response.body).not.toContain('Hidden company');
    },
  );
});
