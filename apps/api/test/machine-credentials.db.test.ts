// docs/specs/machine-credentials.md over HTTP: /admin/tokens, `Authorization: Bearer dfk_…` on business routes,
// company isolation, human-only routes, budgets, the request log and business operations that need a person.
import {
  auditLog,
  bootstrapTenant,
  companyMemberships,
  configureStorage,
  hashPassword,
  LocalStorage,
  machineCredentials,
  newId,
  systemParams,
  tokenHash,
  users,
  withContext,
  repo,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let admin: string;
const logs: string[] = [];
const PASSWORD = 'password';
const PDF = Buffer.from('%PDF-1.7\nSynthetic receipt for machine credential tests.\n%%EOF');

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface View {
  id: string;
  status: string;
  revokedAt: string | null;
  revokedBy: { id: string; name: string } | null;
  roles: string[];
}

async function call(
  method: Method,
  url: string,
  token: string,
  payload?: InjectOptions['payload'],
  headers: Record<string, string> = {},
  remoteAddress?: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(payload === undefined ? {} : { payload }),
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}
async function login(email: string, password = PASSWORD) {
  const result = await call('POST', '/auth/login', '', { email, password });
  expect(result.statusCode, result.body).toBe(200);
  return result.json<{ token: string }>().token;
}
async function stepUp(token = admin, password = PASSWORD) {
  const result = await call('POST', '/auth/step-up', token, { currentPassword: password });
  expect(result.statusCode, result.body).toBe(200);
  return result.json<{ stepUpToken: string }>().stepUpToken;
}
const body = (patch: Record<string, unknown> = {}) => ({
  name: 'EC 連携',
  purpose: 'integration',
  companyId: db.companyId,
  roles: ['viewer'],
  expiresInDays: 30,
  ...patch,
});
async function issue(patch: Record<string, unknown> = {}, token = admin, password = PASSWORD) {
  const result = await call('POST', '/admin/tokens', token, {
    ...body(patch),
    stepUpToken: await stepUp(token, password),
  });
  expect(result.statusCode, result.body).toBe(200);
  return result.json<{ token: string; credential: View }>();
}
async function person(email: string, roles: string[], tenantAdmin = false, siteIds: string[] = []) {
  const id = newId();
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: db.tenantId,
    email,
    name: email.split('@')[0] ?? email,
    passwordHash: await hashPassword(PASSWORD),
    roles,
    tenantAdmin,
    defaultCompanyId: db.companyId,
  });
  if (roles.length)
    await db.owner.drizzle.insert(companyMemberships).values({
      tenantId: db.tenantId,
      companyId: db.companyId,
      userId: id,
      roles,
      accessScope: siteIds.length ? 'sites' : 'all',
      siteIds,
    });
  return { id, token: await login(email) };
}
const machineAudits = (id: string, op: string) =>
  db.owner.drizzle
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'machine_credential'), eq(auditLog.recordId, id), eq(auditLog.op, op)));

beforeAll(async () => {
  db = await freshDb();
  configureStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'daifuku-machine-credentials-'))));
  app = await buildServer({
    owner: db.owner,
    app: db.app,
    jwtSecret: 'machine-credential-test-secret',
    identity: {
      encryptionKey: Buffer.alloc(32, 9).toString('base64'),
      webUrl: 'https://erp.example.com',
      providers: [],
    },
    logger: { level: 'info', stream: { write: (line: string) => void logs.push(line) } },
  });
  await app.ready();
  admin = await login('admin@example.com');
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('/admin/tokens (AC-1, AC-3..AC-6, AC-17, AC-19..AC-21)', () => {
  it('AC-1 AC-3 AC-3a AC-4 AC-5 issues after a step-up and validates the strict body', async () => {
    const issued = await issue({ roles: ['sales', 'viewer'] });
    expect(issued.token).toMatch(/^dfk_[A-Za-z0-9_-]{43}$/);
    expect(issued.credential).toMatchObject({ status: 'active', roles: ['sales', 'viewer'] });

    const invalid = await call('POST', '/admin/tokens', admin, {
      ...body({ name: '', roles: [], expiresInDays: 0, accessScope: 'stores' }),
      stepUpToken: await stepUp(),
    });
    expect(invalid.statusCode).toBe(400);
    const paths = invalid
      .json<{ error: { details: { issues: { path: string }[] } } }>()
      .error.details.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'roles', 'expiresInDays']));
    expect((await call('POST', '/admin/tokens', admin, body())).statusCode).toBe(400);
    expect((await call('POST', '/admin/tokens', admin, { ...body(), stepUpToken: 'x'.repeat(43) })).statusCode).toBe(
      401,
    );
    // the 401 above cleared nothing server-side; the admin session still works
    expect((await call('GET', '/admin/tokens', admin)).statusCode).toBe(200);

    const agent = await call(
      'POST',
      '/admin/tokens',
      admin,
      { ...body(), stepUpToken: await stepUp() },
      { 'x-agent-id': 'mcp-agent' },
    );
    expect(agent.statusCode).toBe(403);
    const companyAdmin = await person('company-admin@example.com', ['admin']);
    expect((await call('GET', '/admin/tokens', companyAdmin.token)).statusCode).toBe(403);
    expect(
      (
        await call('POST', '/admin/tokens', companyAdmin.token, {
          ...body(),
          stepUpToken: await stepUp(companyAdmin.token),
        })
      ).statusCode,
    ).toBe(403);
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Other',
      companyCode: 'OT',
      companyName: '別テナント',
      adminEmail: 'other-tenant@example.com',
      adminName: 'Other',
      adminPassword: PASSWORD,
    });
    const foreign = await call('POST', '/admin/tokens', admin, {
      ...body({ companyId: other.companyId }),
      stepUpToken: await stepUp(),
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain('別テナント');
  });

  it('AC-17 AC-20 AC-21 lists without secrets, revokes idempotently and returns the history', async () => {
    const { token, credential } = await issue();
    const listed = await call('GET', '/admin/tokens', admin);
    expect(listed.statusCode).toBe(200);
    expect(listed.headers['cache-control']).toBe('private, no-store');
    const list = listed.json<{
      items: View[];
      truncated: boolean;
      roles: string[];
      companies: { id: string }[];
      limits: unknown;
    }>();
    expect(list.items.some((i) => i.id === credential.id)).toBe(true);
    expect(list.truncated).toBe(false);
    expect(list.roles).toEqual(expect.arrayContaining(['admin', 'sales', 'viewer']));
    expect(list.roles).not.toContain('relay');
    expect(list.companies.map((c) => c.id)).toContain(db.companyId);
    expect(list.limits).toEqual({ maxActive: 100, maxDays: 365 });
    expect(listed.body).not.toContain(token.slice(4, 16));
    const [row] = await db.owner.drizzle
      .select()
      .from(machineCredentials)
      .where(eq(machineCredentials.id, credential.id));
    expect(listed.body).not.toContain(row?.secretHash);

    const first = await call('POST', `/admin/tokens/${credential.id}/revoke`, admin, { reason: '連携を停止' });
    expect(first.statusCode, first.body).toBe(200);
    const second = await call('POST', `/admin/tokens/${credential.id}/revoke`, admin, {});
    expect(second.json()).toEqual(first.json());
    expect(first.json<{ credential: View }>().credential.status).toBe('revoked');
    expect(await machineAudits(credential.id, 'revoke')).toHaveLength(1);
    expect((await call('POST', `/admin/tokens/${newId()}/revoke`, admin, {})).statusCode).toBe(404);
    expect((await call('POST', `/admin/tokens/not-a-uuid/revoke`, admin, {})).statusCode).toBe(400);
    expect(
      (await call('POST', `/admin/tokens/${credential.id}/revoke`, admin, { reason: 'x'.repeat(201) })).statusCode,
    ).toBe(400);

    expect((await call('GET', '/api/partner', token)).statusCode).toBe(401);
    const history = await call('GET', `/admin/tokens/${credential.id}/audit`, admin);
    expect(history.statusCode).toBe(200);
    const ops = history.json<{ items: { op: string; reason: string | null; actorName: string | null }[] }>().items;
    expect(ops.map((i) => i.op)).toEqual(['use_denied', 'revoke', 'issue']);
    expect(ops[0]?.reason).toBe('revoked');
    expect(ops[1]).toMatchObject({ reason: '連携を停止', actorName: 'Admin' });
    expect(history.body).not.toContain(token.slice(4, 16));
  });

  it('AC-19 offers no route to edit or delete a key', async () => {
    const { credential } = await issue();
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const)
      expect((await call(method, `/admin/tokens/${credential.id}`, admin, { name: 'changed' })).statusCode).toBe(404);
  });
});

describe('using a key on business routes (AC-7..AC-12, AC-16)', () => {
  it('AC-7 reads and writes like a person with the same roles; writes are audited as machine', async () => {
    const created = await call('POST', '/api/partner', admin, { name: '共通取引先', code: 'MC-1' });
    expect(created.statusCode, created.body).toBe(200);
    const salesPerson = await person('sales-person@example.com', ['sales']);
    const viewer = await person('viewer-person@example.com', ['viewer']);
    const salesKey = (await issue({ roles: ['sales'] })).token;
    const viewerKey = await issue({ roles: ['viewer'] });
    const human = await call('GET', '/api/partner?orderBy=code', salesPerson.token);
    const machine = await call('GET', '/api/partner?orderBy=code', salesKey);
    expect(machine.statusCode).toBe(200);
    expect(machine.json()).toEqual(human.json());
    expect(machine.headers['cache-control']).toBe('private, no-store');

    const write = await call('POST', '/api/partner', salesKey, { name: '鍵で登録', code: 'MC-2' });
    expect(write.statusCode, write.body).toBe(200);
    const id = write.json<{ id: string }>().id;
    const [audit] = await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'partner'), eq(auditLog.recordId, id)));
    const [principal] = await db.owner.drizzle
      .select({ id: machineCredentials.id })
      .from(machineCredentials)
      .where(eq(machineCredentials.secretHash, tokenHash(salesKey)));
    expect(audit).toMatchObject({ actorType: 'machine', actorId: principal?.id, onBehalfOf: null });
    const [stored] = await db.owner.drizzle.execute(sql`select created_by, updated_by from partner where id = ${id}`);
    expect(stored).toMatchObject({ created_by: null, updated_by: null });

    const viewerWrite = await call('POST', '/api/partner', viewerKey.token, { name: '閲覧者', code: 'MC-3' });
    const humanViewerWrite = await call('POST', '/api/partner', viewer.token, { name: '閲覧者', code: 'MC-3' });
    expect(viewerWrite.statusCode).toBe(403);
    expect(humanViewerWrite.statusCode).toBe(403);
    expect((await call('GET', '/meta', viewerKey.token)).statusCode).toBe(200);
  });

  it('AC-8 AC-9 refuses revoked, expired and unknown keys with one identical 401 body', async () => {
    const revoked = await issue();
    await call('POST', `/admin/tokens/${revoked.credential.id}/revoke`, admin, {});
    const expired = await issue();
    await db.owner.drizzle
      .update(machineCredentials)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(machineCredentials.id, expired.credential.id));
    const mcp = await issue({ purpose: 'mcp' });
    const responses = [
      await call('GET', '/api/partner', revoked.token),
      await call('GET', '/api/partner', expired.token),
      await call('GET', '/api/partner', mcp.token),
      await call('GET', '/api/partner', `dfk_${'q'.repeat(43)}`),
      await call('GET', '/api/partner', 'dfk_malformed'),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: { message: string } }>().error.message).toBe(
        'API key is invalid, expired or revoked.',
      );
    }
    expect(new Set(responses.map((r) => r.body)).size).toBe(1);
  });

  it('AC-7 AC-10 keeps a key in its company and tenant', async () => {
    const created = await call('POST', '/admin/companies', admin, { code: 'MC2', name: '第二会社' });
    expect(created.statusCode, created.body).toBe(200);
    const second = created.json<{ id: string }>().id;
    const inSecond = await call(
      'POST',
      '/api/partner',
      admin,
      { name: '第二の取引先', code: 'S-1' },
      { 'x-company-id': second },
    );
    expect(inSecond.statusCode, inSecond.body).toBe(200);
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Isolated',
      companyCode: 'IS',
      companyName: '分離',
      adminEmail: 'isolated@example.com',
      adminName: 'Isolated',
      adminPassword: PASSWORD,
    });
    const foreign = await withContext(db.app, systemParams(other.tenantId, other.companyId), (ctx) =>
      repo(ctx, Partner).create({ name: '別テナントの取引先', code: 'F-1' }),
    );
    const { token, credential } = await issue({ roles: ['sales'] });
    expect((await call('GET', `/api/partner/${inSecond.json<{ id: string }>().id}`, token)).statusCode).toBe(404);
    expect((await call('GET', `/api/partner/${foreign.id}`, token)).statusCode).toBe(404);
    const mismatch = await call('GET', '/api/partner', token, undefined, { 'x-company-id': second });
    expect(mismatch.statusCode).toBe(403);
    expect(
      (await machineAudits(credential.id, 'use_denied')).map((a) => (a.after as { reason: string }).reason),
    ).toEqual(['company_mismatch']);
    expect((await call('GET', '/api/partner', token, undefined, { 'x-company-id': db.companyId })).statusCode).toBe(
      200,
    );
    // the key's own company in upper case is accepted like a person's header; a malformed header is a 400, not audited
    expect(
      (await call('GET', '/api/partner', token, undefined, { 'x-company-id': db.companyId.toUpperCase() })).statusCode,
    ).toBe(200);
    const malformed = await call('GET', '/api/partner', token, undefined, { 'x-company-id': 'not-a-uuid' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
    // x-agent-id is ignored: the actor stays the credential
    const write = await call(
      'POST',
      '/api/partner',
      token,
      { name: 'agent header', code: 'MC-4' },
      { 'x-agent-id': 'spoof' },
    );
    const [audit] = await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'partner'), eq(auditLog.recordId, write.json<{ id: string }>().id)));
    expect(audit).toMatchObject({ actorType: 'machine', actorId: credential.id });
  });

  it('AC-11 never reads a key from the query and refuses browser origins', async () => {
    const { token } = await issue();
    expect((await call('GET', `/api/partner?access_token=${token}`, '')).statusCode).toBe(401);
    const fromBrowser = await call('GET', '/api/partner', token, undefined, { origin: 'https://evil.example.com' });
    expect(fromBrowser.statusCode).toBe(401);
    // a same-origin GET from a browser has no Origin, but always Sec-Fetch-Site
    const sameOrigin = await call('GET', '/api/partner', token, undefined, { 'sec-fetch-site': 'same-origin' });
    expect(sameOrigin.statusCode).toBe(401);
    expect(sameOrigin.body).toBe(fromBrowser.body);
    // Node's fetch sends Sec-Fetch-Mode: cors from a server; that alone is not a browser
    expect((await call('GET', '/api/partner', token, undefined, { 'sec-fetch-mode': 'cors' })).statusCode).toBe(200);
  });

  it('AC-12 answers 403 on routes that need a person, even for admin and edge_manager keys', async () => {
    const { token } = await issue({ roles: ['admin', 'edge_manager'] });
    for (const [method, url, payload] of [
      ['GET', '/auth/me', undefined],
      ['GET', '/auth/companies', undefined],
      ['GET', '/auth/security', undefined],
      ['POST', '/auth/logout-all', {}],
      ['GET', '/admin/access', undefined],
      ['GET', '/admin/tokens', undefined],
      ['POST', '/admin/tokens', body()],
      ['GET', '/admin/companies', undefined],
      ['POST', '/edge/pairings', { gatewayId: newId(), expectedVersion: 1, stepUpToken: 'x'.repeat(43) }],
      [
        'POST',
        '/edge/credentials/revoke',
        { gatewayId: newId(), expectedVersion: 1, stepUpToken: 'x'.repeat(43), reason: 'r' },
      ],
    ] as const) {
      const response = await call(method, url, token, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('AC-12 matches the routed path, so encoded or doubled-slash spellings get the same 403 without a lookup', async () => {
    const { token, credential } = await issue({ roles: ['admin', 'edge_manager'] });
    const lastUsed = async () =>
      (
        await db.owner.drizzle
          .select({ at: machineCredentials.lastUsedAt })
          .from(machineCredentials)
          .where(eq(machineCredentials.id, credential.id))
      )[0]?.at ?? null;
    for (const [method, url, payload] of [
      ['GET', '/%61dmin/tokens', undefined],
      ['GET', '/%61dmin/access', undefined],
      ['POST', `/%61dmin/tokens/${credential.id}/revoke`, {}],
      ['GET', '/%61uth/me', undefined],
      ['GET', '/%61uth/companies', undefined],
      ['GET', '/%61uth/security', undefined],
      ['POST', '/%65dge/pairings', { gatewayId: newId(), expectedVersion: 1, stepUpToken: 'x'.repeat(43) }],
      [
        'POST',
        '/edge/credentials/%72evoke',
        { gatewayId: newId(), expectedVersion: 1, stepUpToken: 'x'.repeat(43), reason: 'r' },
      ],
    ] as const) {
      const response = await call(method, url, token, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json<{ error: { details?: { op?: string } } }>().error.details?.op, url).toBe(
        'human-session-required',
      );
    }
    expect(await lastUsed()).toBeNull();
    expect((await call('GET', '/api/partner', token)).statusCode).toBe(200);
    expect(await lastUsed()).not.toBeNull();
  });

  it('AC-2 AC-16 logs the machine actor and never the key', async () => {
    const { token, credential } = await issue();
    logs.length = 0;
    expect((await call('GET', '/api/partner', token)).statusCode).toBe(200);
    expect((await call('GET', `/api/partner?k=${token}`, token)).statusCode).toBe(200);
    const lines = logs.map((line) => JSON.parse(line) as { msg: string; actor?: unknown; url?: string });
    const requests = lines.filter((l) => l.msg === 'request');
    expect(requests).toHaveLength(2);
    for (const line of requests) expect(line.actor).toEqual({ type: 'machine', id: credential.id });
    expect(logs.join('\n')).not.toContain(token.slice(4, 16));
  });
});

describe('attempt budgets (AC-13)', () => {
  it('AC-13 limits unknown keys per IP without charging valid or known-refused keys to the IP', async () => {
    const good = await issue();
    const revoked = await issue();
    await call('POST', `/admin/tokens/${revoked.credential.id}/revoke`, admin, {});
    const codes: number[] = [];
    for (let i = 0; i < 200; i++)
      codes.push((await call('GET', '/api/partner', revoked.token, undefined, {}, '10.20.0.1')).statusCode);
    expect(codes.slice(0, 100).every((c) => c === 401)).toBe(true);
    expect(codes.slice(100).every((c) => c === 429)).toBe(true);
    expect((await call('GET', '/api/partner', good.token, undefined, {}, '10.20.0.1')).statusCode).toBe(200);

    const burst = await Promise.all(
      Array.from({ length: 150 }, () => call('GET', '/api/partner', good.token, undefined, {}, '10.20.0.2')),
    );
    expect(burst.map((r) => r.statusCode).every((c) => c === 200)).toBe(true);

    for (let i = 0; i < 100; i++)
      expect(
        (await call('GET', '/api/partner', `dfk_${'u'.repeat(42)}${i % 10}`, undefined, {}, '10.20.0.3')).statusCode,
      ).toBe(401);
    expect((await call('GET', '/api/partner', `dfk_${'u'.repeat(43)}`, undefined, {}, '10.20.0.3')).statusCode).toBe(
      429,
    );
    expect((await call('GET', '/api/partner', good.token, undefined, {}, '10.20.0.3')).statusCode).toBe(429);
    expect((await call('GET', '/api/partner', good.token, undefined, {}, '10.20.0.4')).statusCode).toBe(200);
  });
});

describe('issuer coupling over HTTP (AC-18, AC-33)', () => {
  it('AC-18 AC-33 reports the issuer live keys and revokes them on deactivation', async () => {
    const issuer = await person('issuer@example.com', [], true);
    const { token } = await issue({}, issuer.token);
    const directory = await call('GET', '/admin/access', admin);
    expect(directory.json<{ activeApiKeys: Record<string, number> }>().activeApiKeys[issuer.id]).toBe(1);
    const version = directory
      .json<{ users: { id: string; version: number }[] }>()
      .users.find((u) => u.id === issuer.id)?.version;
    const changed = await call('PATCH', `/admin/users/${issuer.id}`, admin, {
      expectedVersion: version,
      active: false,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ active: false, revokedMachineCredentials: 1 });
    expect((await call('GET', '/api/partner', token)).statusCode).toBe(401);
    const after = await call('GET', '/admin/access', admin);
    expect(after.json<{ activeApiKeys: Record<string, number> }>().activeApiKeys[issuer.id]).toBeUndefined();
  });
});

describe('operations that need a person refuse keys (AC-22, AC-23)', () => {
  it('AC-22 refuses leave grants, approvals, settlement, receipts, payroll rule approval and inboxes', async () => {
    const site = await call('POST', '/api/workforce_site', admin, { code: 'MC', name: '鍵の拠点' });
    expect(site.statusCode, site.body).toBe(200);
    const siteId = site.json<{ id: string }>().id;
    const employeeUser = await person('employee@example.com', ['workforce_employee'], false, [siteId]);
    const employeeToken = employeeUser.token;
    const managerUser = await person('manager@example.com', ['workforce_manager']);
    const registered = await call('POST', '/actions/workforce.register_employee', admin, {
      userId: employeeUser.id,
      siteId,
      code: 'MC1',
      name: '鍵の試験',
      hiredOn: '2026-01-01',
    });
    expect(registered.statusCode, registered.body).toBe(200);
    const employeeId = registered.json<{ id: string }>().id;
    const saveExpense = async () => {
      const saved = await call('POST', '/actions/workforce.save_expense', employeeToken, {
        expectedVersion: 0,
        idempotencyKey: newId(),
        expenseDate: '2026-09-01',
        category: '交通費',
        description: '鍵の試験',
        amount: '800',
        evidence: '領収書あり',
      });
      expect(saved.statusCode, saved.body).toBe(200);
      return saved.json<{ id: string; version: number }>();
    };
    const draft = await saveExpense();
    const submitted = await call('POST', '/actions/workforce.submit_expense', employeeToken, {
      expenseId: draft.id,
      expectedVersion: draft.version,
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const key = (
      await issue({ roles: ['admin', 'workforce_hr', 'workforce_manager', 'workforce_payroll', 'accounting'] })
    ).token;
    const expectHuman = (response: LightMyRequestResponse, what: string) => {
      expect(response.statusCode, `${what}: ${response.body}`).toBe(403);
      expect(response.json<{ error: { details: { op: string } } }>().error.details.op, what).toBe(
        'human-actor-required',
      );
    };
    expectHuman(
      await call('POST', '/actions/workforce.grant_leave', key, {
        employeeId,
        validFrom: '2026-09-01',
        expiresOn: '2026-12-31',
        days: '1',
        eligibilityConfirmed: true,
        basis: '鍵からの付与',
      }),
      'grant_leave',
    );
    expectHuman(
      await call('POST', '/actions/workforce.review_expense', key, {
        expenseId: draft.id,
        expectedVersion: submitted.json<{ version: number }>().version,
        decision: 'approve',
        reason: '鍵での承認',
      }),
      'review_expense',
    );
    const approved = await call('POST', '/actions/workforce.review_expense', managerUser.token, {
      expenseId: draft.id,
      expectedVersion: submitted.json<{ version: number }>().version,
      decision: 'approve',
      reason: '人が確認',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expectHuman(
      await call('POST', '/actions/workforce.settle_expense', key, {
        expenseId: draft.id,
        expectedVersion: approved.json<{ version: number }>().version,
        paidOn: '2026-09-02',
        reference: '振込',
      }),
      'settle_expense',
    );
    const second = await saveExpense();
    const boundary = `receipt-${newId()}`;
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n${second.version}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      PDF,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    expectHuman(
      await call('POST', `/api/workforce/expenses/${second.id}/receipts`, key, multipart, {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      }),
      'receipt upload',
    );
    const catalog = await call('POST', '/actions/workforce.payroll_rule_catalog', key, {});
    expect(catalog.statusCode, catalog.body).toBe(200);
    const bundle = catalog
      .json<{ bundles: { packageCode: string; status: string; payloadHash: string; manifestHash: string }[] }>()
      .bundles.find((b) => b.status === 'available');
    expect(bundle).toBeDefined();
    expectHuman(
      await call('POST', '/actions/workforce.install_payroll_rule', key, {
        packageCode: bundle?.packageCode,
        expectedPayloadHash: bundle?.payloadHash,
        expectedManifestHash: bundle?.manifestHash,
        sourcesReviewed: true,
        basis: '鍵からの承認',
      }),
      'install_payroll_rule',
    );
    expectHuman(await call('POST', '/actions/workforce.todo', key, {}), 'workforce.todo');
    expectHuman(await call('POST', '/actions/tax_filing.todo', key, {}), 'tax_filing.todo');
  });

  it('AC-23 refuses the cross-company port to a key', async () => {
    const { token } = await issue({ roles: ['admin'] });
    const response = await call('POST', '/actions/group_accounting.companies', token, {});
    expect(response.statusCode, response.body).toBe(403);
  });
});
