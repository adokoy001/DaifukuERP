// docs/specs/web-phase1.md — API additions: /meta actions carry inputSchema + resultKind (AC-3); GET/PUT /meta/settings (AC-5).
import { companyMemberships, defineAction, hashPassword, label, newId, registry, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildServer } from '../src/server.ts';

const JWT_SECRET = 'test-secret';

let db: TestDb;
let app: FastifyInstance;
let token: string;
let salesToken: string;

interface JsonResponse {
  status: number;
  body: Record<string, unknown> & { error?: { code: string; message: string; hint: string; details?: Record<string, unknown> } };
}

interface ActionMeta {
  name: string;
  generic: boolean;
  resultKind: 'table' | 'record' | 'other';
  inputSchema?: { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] };
}

interface SettingOut {
  key: string;
  label: { ja: string; en: string };
  schema: { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] };
  value: unknown;
}

async function call(method: 'GET' | 'POST' | 'PUT', url: string, opts: { body?: unknown; token?: string | null } = {}): Promise<JsonResponse> {
  const t = opts.token === undefined ? token : opts.token;
  const res = await app.inject({
    method,
    url,
    headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as JsonResponse['body'] };
}

async function login(email: string, password: string): Promise<string> {
  const res = await call('POST', '/auth/login', { body: { email, password }, token: null });
  return res.body.token as string;
}

// A TableResult-shaped report action and a setting, declared the way a module would (docs/conventions/reports.md).
const tableResult = z.object({
  title: z.object({ ja: z.string(), en: z.string() }),
  columns: z.array(z.object({ key: z.string(), label: z.object({ ja: z.string(), en: z.string() }), kind: z.enum(['text', 'decimal', 'int', 'date', 'ref', 'bool']), ref: z.string().optional(), align: z.enum(['left', 'right']).optional() })),
  rows: z.array(z.record(z.string(), z.unknown())),
  totals: z.record(z.string(), z.string()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
const roundingSchema = z.object({ unit: z.enum(['invoice', 'delivery_note']).default('invoice'), mode: z.enum(['half_up', 'down', 'up']) });

beforeAll(async () => {
  db = await freshDb();
  defineAction({
    name: 'test_report.balance',
    description: label('テスト用の残高表', 'Test balance table'),
    input: z.object({ from: z.string(), to: z.string(), partnerId: z.uuid().optional(), includeZero: z.boolean().default(false) }),
    output: tableResult,
    permission: 'authenticated',
    tx: 'none',
    handler: async (_ctx, { from, to }) => ({
      title: label('残高表', 'Balances'),
      columns: [
        { key: 'code', label: label('コード', 'Code'), kind: 'text' as const },
        { key: 'amount', label: label('金額', 'Amount'), kind: 'decimal' as const },
      ],
      rows: [{ code: 'A', amount: '10.5' }],
      totals: { amount: '10.5' },
      meta: { from, to },
    }),
  });
  registry.registerSetting({ key: 'test_report.rounding', label: label('丸め設定', 'Rounding'), description: label('税額の丸め', 'Tax rounding'), schema: roundingSchema });
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: JWT_SECRET });
  await app.ready();
  token = await login('admin@example.com', 'password');
  const salesId = newId();
  await db.owner.drizzle.insert(users).values({
    id: salesId,
    tenantId: db.tenantId,
    email: 'sales@example.com',
    name: 'Sales',
    passwordHash: hashPassword('sales-pw'),
    roles: ['sales'],
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle.insert(companyMemberships).values({ tenantId: db.tenantId, userId: salesId, companyId: db.companyId, roles: ['sales'] });
  salesToken = await login('sales@example.com', 'sales-pw');
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('GET /meta actions (web-phase1 AC-3)', () => {
  it('every action has resultKind; TableResult outputs are "table", entity outputs "record", others "other"', async () => {
    const meta = await call('GET', '/meta');
    expect(meta.status).toBe(200);
    const actions = meta.body.actions as ActionMeta[];
    expect(actions.length).toBeGreaterThan(6);
    for (const a of actions) expect(['table', 'record', 'other']).toContain(a.resultKind);
    const byName = new Map(actions.map((a) => [a.name, a] as const));
    expect(byName.get('test_report.balance')?.resultKind).toBe('table');
    expect(byName.get('partner.get')?.resultKind).toBe('record');
    expect(byName.get('partner.create')?.resultKind).toBe('record');
    expect(byName.get('partner.list')?.resultKind).toBe('other');
    expect(byName.get('partner.delete')?.resultKind).toBe('other');
    expect(byName.get('partner.compute_due_date')?.resultKind).toBe('other');
  });

  it('module actions carry inputSchema (JSON Schema, no $schema); generic CRUD actions do not', async () => {
    const actions = (await call('GET', '/meta')).body.actions as ActionMeta[];
    const report = actions.find((a) => a.name === 'test_report.balance');
    expect(report?.generic).toBe(false);
    expect(report?.inputSchema).toMatchObject({ type: 'object', required: ['from', 'to'] });
    expect(report?.inputSchema).not.toHaveProperty('$schema');
    const props = report?.inputSchema?.properties ?? {};
    expect(props.from).toMatchObject({ type: 'string' });
    expect(props.partnerId).toMatchObject({ type: 'string', format: 'uuid' });
    expect(props.includeZero).toMatchObject({ type: 'boolean', default: false });
    const due = actions.find((a) => a.name === 'partner.compute_due_date');
    expect(Object.keys(due?.inputSchema?.properties ?? {})).toEqual(['partnerId', 'invoiceDate']);
    for (const a of actions.filter((x) => x.generic)) expect(a.inputSchema).toBeUndefined();
  });

  it('the report action itself runs through POST /actions/:name and returns the TableResult shape', async () => {
    const res = await call('POST', '/actions/test_report.balance', { body: { from: '2026-01-01', to: '2026-12-31' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: { ja: '残高表', en: 'Balances' }, rows: [{ code: 'A', amount: '10.5' }], totals: { amount: '10.5' }, meta: { from: '2026-01-01', to: '2026-12-31' } });
  });
});

describe('settings routes (web-phase1 AC-5)', () => {
  it('GET /meta/settings lists declared settings with JSON Schema and null value when unset; admin/settings role only', async () => {
    const res = await call('GET', '/meta/settings');
    expect(res.status).toBe(200);
    const list = res.body as unknown as SettingOut[];
    const rounding = list.find((s) => s.key === 'test_report.rounding');
    expect(rounding).toMatchObject({ label: { ja: '丸め設定', en: 'Rounding' }, description: { ja: '税額の丸め', en: 'Tax rounding' }, value: null });
    expect(rounding?.schema).toMatchObject({ type: 'object', required: ['mode'] });
    expect(rounding?.schema.properties?.mode).toMatchObject({ enum: ['half_up', 'down', 'up'] });
    expect(rounding?.schema.properties?.unit).toMatchObject({ default: 'invoice' });
    const denied = await call('GET', '/meta/settings', { token: salesToken });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('PERMISSION_DENIED');
    expect((await call('GET', '/meta/settings', { token: null })).status).toBe(401);
  });

  it('PUT /meta/settings/:key validates with the module schema, stores, and is reflected by GET; unknown key -> 404; sales -> 403', async () => {
    const bad = await call('PUT', '/meta/settings/test_report.rounding', { body: { value: { mode: 'sideways' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'test_report.rounding.mode' }] } });
    const ok = await call('PUT', '/meta/settings/test_report.rounding', { body: { value: { mode: 'up' } } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ key: 'test_report.rounding', value: { unit: 'invoice', mode: 'up' } });
    const after = (await call('GET', '/meta/settings')).body as unknown as SettingOut[];
    expect(after.find((s) => s.key === 'test_report.rounding')?.value).toEqual({ unit: 'invoice', mode: 'up' });
    const unknown = await call('PUT', '/meta/settings/nope.nothing', { body: { value: 1 } });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatchObject({ code: 'NOT_FOUND', hint: expect.stringContaining('/meta/settings') });
    const denied = await call('PUT', '/meta/settings/test_report.rounding', { body: { value: { mode: 'down' } }, token: salesToken });
    expect(denied.status).toBe(403);
    const missingBody = await call('PUT', '/meta/settings/test_report.rounding', { body: { nope: 1 } });
    expect(missingBody.status).toBe(400);
  });

  it('the settings routes are documented in /openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const doc = res.json() as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/meta/settings', '/meta/settings/{key}']));
  });
});
