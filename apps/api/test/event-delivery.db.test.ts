// docs/specs/event-delivery.md with the full API runtime: secrets are write-only through every API and table (AC-14,
// AC-15), worker ticks deliver signed webhooks to a local HTTP receiver in this process (AC-2, AC-8, AC-11), retries and
// manual resends keep the delivery id (AC-9, AC-10, AC-20), two workers do not double-deliver (AC-5, AC-11), a failing
// tenant does not stop the others and the tick reports counts only (AC-2, AC-3), stop waits then aborts (AC-1), inbox
// mail counts the real workforce.todo provider in the user's own scope (AC-16, AC-17), and the self-service and admin
// routes refuse everyone else (AC-18, AC-19, AC-22, AC-23). No external network: the receiver listens on 127.0.0.1.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  bootstrapTenant,
  companies,
  companyMemberships,
  defineAction,
  hashPassword,
  label,
  newId,
  repo,
  runAction,
  todoInput,
  todoResult,
  users,
  verifyWebhookSignature,
  type ContextParams,
  type IdentityMailPayload,
  type IdentityMailTransport,
  type Logger,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { seedWorkforce, WorkforceSite } from '@daifuku/mod-workforce';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventWorkerConfig } from '../src/events/config.ts';
import { emptyTick, runEventTick, startEventWorker, tickExitCode, type EventWorkerDeps } from '../src/events/worker.ts';
import { buildServer } from '../src/server.ts';

const KEY = Buffer.alloc(32, 5).toString('base64');
const WEB = 'http://127.0.0.1:5173';
const NOW = new Date('2026-09-12T00:00:00Z');
const minutes = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}
let receiver: Server;
let base: string;
const received: Received[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.writeHead(200).end('ok');

class FakeMail implements IdentityMailTransport {
  messages: (IdentityMailPayload & { messageId: string })[] = [];
  async send(message: IdentityMailPayload & { messageId: string }): Promise<void> {
    this.messages.push(message);
  }
}

let db: TestDb;
let api: FastifyInstance;
let plain: FastifyInstance;
const mail = new FakeMail();
let secret = '';
let adminToken = '';
const config: EventWorkerConfig = { enabled: true, intervalMs: 1000, inboxCheckMinutes: 15, allowLoopback: true };

function capture(): { log: Logger; text: () => string } {
  const lines: unknown[] = [];
  const push = (msg: string, data?: Record<string, unknown>) => lines.push([msg, data]);
  return { log: { info: push, warn: push, error: push }, text: () => JSON.stringify(lines) };
}
const quiet = capture().log;
const deps = (patch: Partial<EventWorkerDeps> = {}): EventWorkerDeps => ({
  owner: db.owner,
  app: db.app,
  config,
  identity: { encryptionKey: KEY, webUrl: WEB, mailTransport: mail },
  log: quiet,
  ...patch,
});
const tick = (now: Date, patch: Partial<EventWorkerDeps> = {}) => runEventTick(deps({ now: () => now, ...patch }));

async function login(server: FastifyInstance, email: string, password = 'password'): Promise<string> {
  const r = await server.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ token: string }>().token;
}
const call = (
  server: FastifyInstance,
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  server.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function person(
  email: string,
  roles: string[],
  scope: { accessScope?: 'all' | 'stores' | 'sites'; storeIds?: string[]; siteIds?: string[] } = {},
  companyId = db.companyId,
): Promise<string> {
  const id = newId();
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: db.tenantId,
    email,
    name: email.split('@')[0] ?? email,
    passwordHash: await hashPassword('test-password'),
    defaultCompanyId: companyId,
  });
  await db.owner.drizzle.insert(companyMemberships).values({
    tenantId: db.tenantId,
    companyId,
    userId: id,
    roles,
    accessScope: scope.accessScope ?? 'all',
    storeIds: scope.storeIds ?? [],
    siteIds: scope.siteIds ?? [],
  });
  return id;
}

const endpoint = (id: string, path: string, topics = ['test.*']) => ({
  id,
  label: `Receiver ${id}`,
  url: `${base}${path}`,
  topics,
  enabled: true,
});
async function putWebhooks(value: unknown, token = adminToken, companyHeader: Record<string, string> = {}) {
  return call(api, token, 'PUT', '/meta/settings/integration.webhooks', { value }, companyHeader);
}
const emit = (topic: string, payload: unknown, params: Partial<ContextParams> = {}) =>
  db.run(params, async (ctx) => {
    await ctx.emit(topic, payload);
  });
const deliveryRows = () => db.owner.sql<{ id: string; status: string; attempts: number; target: string }[]>`
  select id, status, attempts, target from event_deliveries order by created_at, id`;

beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  db = await freshDb();
  api = await buildServer({
    owner: db.owner,
    app: db.app,
    jwtSecret: 'event-delivery-test',
    identity: { encryptionKey: KEY, webUrl: WEB, providers: [], allowLoopbackForTests: true, mailTransport: mail },
    eventWorker: { enabledHere: false },
  });
  plain = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'event-delivery-test' });
  await api.ready();
  await plain.ready();
  adminToken = await login(api, 'admin@example.com');
});
afterAll(async () => {
  await api?.close();
  await plain?.close();
  await db?.close();
  receiver?.closeAllConnections();
  await new Promise<void>((resolve) => receiver?.close(() => resolve()));
});

describe('settings and write-only secrets (AC-14, AC-15)', () => {
  it('AC-15 a value with a secret, a duplicate id or an inbox topic is 400 and nothing is stored', async () => {
    for (const value of [
      { endpoints: [{ ...endpoint('recv', '/hook'), secret: 'whsec_typed-by-hand' }], inboxEmail: true },
      { endpoints: [endpoint('recv', '/hook'), endpoint('recv', '/hook')], inboxEmail: true },
      { endpoints: [endpoint('recv', '/hook', ['inbox.count_changed'])], inboxEmail: true },
      { endpoints: [{ ...endpoint('recv', '/hook'), url: 'http://hooks.example.com/x' }], inboxEmail: true },
    ]) {
      const r = await putWebhooks(value);
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
    }
    const [company] = await db.owner.drizzle.select().from(companies).where(eq(companies.id, db.companyId));
    expect(company?.settings).not.toHaveProperty('integration.webhooks');
  });

  it('AC-14 the secret is returned once with no-store and appears in no API, audit row, table or setting', async () => {
    const saved = await putWebhooks({ endpoints: [endpoint('recv', '/hook')], inboxEmail: true });
    expect(saved.statusCode, saved.body).toBe(200);
    const issued = await call(api, adminToken, 'POST', '/admin/webhooks/recv/secret');
    expect(issued.statusCode, issued.body).toBe(200);
    expect(issued.headers['cache-control']).toContain('no-store');
    secret = issued.json<{ secret: string }>().secret;
    expect(secret).toMatch(/^whsec_/);
    const webhooks = await call(api, adminToken, 'GET', '/admin/webhooks');
    expect(webhooks.json()).toMatchObject({
      secretsAvailable: true,
      mailConfigured: true,
      inboxEmail: true,
      worker: { enabledHere: false },
      endpoints: [{ id: 'recv', url: `${base}/hook`, secret: { state: 'active', issuedByName: 'Admin' } }],
    });
    for (const url of [
      '/meta/settings',
      '/meta/settings/integration.webhooks/audit',
      '/admin/webhooks',
      '/admin/event-deliveries?status=pending',
    ]) {
      const r = await call(api, adminToken, 'GET', url);
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).not.toContain(secret);
    }
    for (const table of ['audit_log', 'outbox', 'event_deliveries', 'companies', 'webhook_secrets']) {
      const rows = await db.owner.sql.unsafe(`select * from ${table}`);
      expect(JSON.stringify(rows), table).not.toContain(secret);
    }
    const noKey = await call(plain, await login(plain, 'admin@example.com'), 'POST', '/admin/webhooks/recv/secret');
    expect(noKey.statusCode).toBe(409);
    expect(noKey.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
    expect(noKey.json<{ error: { hint: string } }>().error.hint).toContain('IDENTITY_ENCRYPTION_KEY');
    expect((await call(api, adminToken, 'POST', '/admin/webhooks/unknown/secret')).statusCode).toBe(404);
  });
});

describe('worker ticks (AC-2, AC-3, AC-5, AC-8..AC-11, AC-20)', () => {
  it('AC-8 AC-11 AC-5 two concurrent workers deliver each signed event to the receiver exactly once', async () => {
    received.length = 0;
    for (let i = 0; i < 5; i++) await emit('test.ping', { i });
    const later = minutes(new Date(), 1);
    const [one, two] = await Promise.all([tick(later), tick(later)]);
    expect((one?.events.delivered ?? 0) + (two?.events.delivered ?? 0)).toBe(5);
    expect((one?.sends.sent ?? 0) + (two?.sends.sent ?? 0)).toBe(5);
    expect(received).toHaveLength(5);
    const ids = received.map((r) => r.headers['daifuku-delivery-id']);
    expect(new Set(ids).size).toBe(5);
    for (const r of received) {
      expect(r.path).toBe('/hook');
      expect(r.headers['content-type']).toBe('application/json');
      expect(r.headers['user-agent']).toBe('Daifuku-Webhook/1');
      expect(r.headers['daifuku-topic']).toBe('test.ping');
      expect(r.headers['daifuku-event-id']).toBe(JSON.parse(r.body).eventId);
      expect(
        verifyWebhookSignature(
          secret,
          String(r.headers['daifuku-delivery-id']),
          String(r.headers['daifuku-timestamp']),
          r.body,
          String(r.headers['daifuku-signature']),
        ),
      ).toBe(true);
    }
    expect((await deliveryRows()).every((row) => row.status === 'delivered')).toBe(true);
  });

  it('AC-9 AC-10 AC-20 a failing receiver is retried with the same delivery id, dead after 8, and resent by the admin', async () => {
    await db.owner.sql`delete from event_deliveries`;
    received.length = 0;
    respond = (_req, res) => res.writeHead(500).end('broken');
    await emit('test.ping', { retry: true });
    let now = minutes(new Date(), 1);
    for (let attempt = 1; attempt <= 8; attempt++) {
      await tick(now);
      now = minutes(now, 61);
    }
    expect(received).toHaveLength(8);
    const [row] = await deliveryRows();
    expect(row).toMatchObject({ status: 'dead', attempts: 8 });
    expect(new Set(received.map((r) => r.headers['daifuku-delivery-id']))).toEqual(new Set([row?.id]));
    const list = await call(api, adminToken, 'GET', '/admin/event-deliveries?status=dead');
    expect(list.json()).toMatchObject({
      items: [{ id: row?.id, kind: 'webhook', status: 'dead', lastError: 'http_status', lastStatus: 500 }],
    });
    expect(list.body).not.toContain(base);
    expect(list.body).not.toContain('"retry":true');
    const retried = await call(api, adminToken, 'POST', `/admin/event-deliveries/${row?.id}/retry`);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json()).toMatchObject({ id: row?.id, status: 'pending', attempts: 0 });
    expect((await call(api, adminToken, 'POST', `/admin/event-deliveries/${row?.id}/retry`)).statusCode).toBe(409);
    respond = (_req, res) => res.writeHead(200).end('ok');
    await tick(minutes(new Date(), 2));
    expect(received.at(-1)?.headers['daifuku-delivery-id']).toBe(row?.id);
    expect((await deliveryRows())[0]).toMatchObject({ status: 'delivered' });
  });

  it('AC-2 AC-3 a failing tenant is logged by class only and the others continue; the result is counts only', async () => {
    await db.owner.sql`delete from event_deliveries`;
    received.length = 0;
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Other tenant',
      companyCode: 'O',
      companyName: 'Other',
      adminEmail: 'other@event.test',
      adminName: 'Other',
      adminPassword: 'other-password',
    });
    await emit('test.ping', { tenant: 'A' });
    await emit(
      'test.other_tenant',
      {},
      { tenantId: other.tenantId, companyId: other.companyId, actor: { type: 'user', id: other.userId } },
    );
    const captured = capture();
    const result = await tick(minutes(new Date(), 1), {
      log: captured.log,
      dueTenants: async () => ['not-a-uuid', db.tenantId, other.tenantId],
    });
    expect(result.failedTenants).toBe(1);
    expect(result.tenants).toBe(3);
    expect(result.events.delivered).toBe(2);
    expect(result.sends.sent).toBe(1);
    expect(received).toHaveLength(1);
    expect(tickExitCode(result)).toBe(1);
    expect(captured.text()).toContain('22P02');
    expect(captured.text()).not.toContain('invalid input syntax');
    const text = JSON.stringify(result);
    for (const forbidden of [base, secret, other.tenantId, db.tenantId, 'test.ping'])
      expect(text).not.toContain(forbidden);
    expect(Object.keys(result).sort()).toEqual(Object.keys(emptyTick()).sort());
  });

  it('AC-3 AC-11 a process without the encryption key leaves webhook rows pending and exits with 2', async () => {
    await db.owner.sql`delete from event_deliveries`;
    received.length = 0;
    await emit('test.ping', { nokey: true });
    const later = minutes(new Date(), 1);
    const result = await runEventTick({ owner: db.owner, app: db.app, config, log: quiet, now: () => later });
    expect(result.sends).toMatchObject({ sent: 0, skipped: 1 });
    expect(tickExitCode(result)).toBe(2);
    expect(received).toHaveLength(0);
    expect((await deliveryRows())[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(tickExitCode({ ...emptyTick() })).toBe(0);
    const sent = await tick(minutes(new Date(), 2));
    expect(sent.sends.sent).toBe(1);
  });

  it('AC-1 stop waits for the running tick, then aborts the in-flight send; the row is resent after its lease', async () => {
    await db.owner.sql`delete from event_deliveries`;
    received.length = 0;
    respond = (req, res) => {
      if (req.url === '/slow') setTimeout(() => res.writeHead(200).end(), 5000).unref();
      else res.writeHead(200).end();
    };
    const saved = await putWebhooks({
      endpoints: [endpoint('recv', '/hook'), endpoint('slow', '/slow', ['test.slow'])],
      inboxEmail: true,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const issued = await call(api, adminToken, 'POST', '/admin/webhooks/slow/secret');
    expect(issued.statusCode).toBe(200);
    await emit('test.slow', {});
    const worker = startEventWorker(deps({ config: { ...config, intervalMs: 1000 } }));
    while (!received.some((r) => r.path === '/slow')) await new Promise((resolve) => setTimeout(resolve, 20));
    const started = Date.now();
    await worker.stop(300);
    expect(Date.now() - started).toBeLessThan(3000);
    const row = (await deliveryRows()).find((r) => r.target === 'slow');
    expect(row).toMatchObject({ status: 'sending', attempts: 1 });
    respond = (_req, res) => res.writeHead(200).end();
    expect((await tick(minutes(new Date(), 0.5))).sends.sent).toBe(0);
    expect((await tick(minutes(new Date(), 2))).sends.sent).toBe(1);
    const slow = received.filter((r) => r.path === '/slow');
    expect(slow).toHaveLength(2);
    expect(slow[1]?.headers['daifuku-delivery-id']).toBe(slow[0]?.headers['daifuku-delivery-id']);
  });
});

describe('inbox mail with the real workforce.todo provider (AC-16, AC-17)', () => {
  let siteA = '';
  let siteB = '';
  let managerId = '';
  let managerToken = '';
  let failing = false;
  const alice: Partial<ContextParams> = {};
  const carol: Partial<ContextParams> = {};
  const hr: Partial<ContextParams> = {};

  const wf = (params: Partial<ContextParams>, name: string, input: unknown) =>
    db.run({ ...params, now: () => NOW }, (ctx) => runAction(ctx, `workforce.${name}`, input)) as Promise<{
      id: string;
      version: number;
    }>;
  async function submittedExpense(params: Partial<ContextParams>): Promise<void> {
    const saved = await wf(params, 'save_expense', {
      expectedVersion: 0,
      idempotencyKey: newId(),
      expenseDate: '2026-09-10',
      category: '交通費',
      description: '訪問交通費（通知の試験）',
      amount: '1000',
      evidence: '合成の領収書参照',
    });
    await wf(params, 'submit_expense', { expenseId: saved.id, expectedVersion: saved.version });
  }
  const changedEvents = () =>
    db.owner.sql<{ payload: { userId: string; total: number; previousTotal: number } }[]>`
      select payload from outbox where topic = 'inbox.count_changed' order by created_at`;
  const watch = async () =>
    (
      await db.owner.sql<{ last_total: number | null }[]>`
        select last_total from inbox_watches where user_id = ${managerId}`
    )[0];

  beforeAll(async () => {
    defineAction({
      name: 'zzfail.todo',
      description: label('試験用の失敗する提供元', 'Failing test provider'),
      input: todoInput,
      output: todoResult,
      permission: { roles: ['workforce_manager'] },
      siteAccess: true,
      tx: 'none',
      mutates: false,
      async handler() {
        if (failing) throw new Error('provider failure with secret-ish text');
        return { items: [] };
      },
    });
    const sites = await db.run({ now: () => NOW }, async (ctx) => {
      await seedWorkforce(ctx);
      return [
        await repo(ctx, WorkforceSite).create({ code: 'A', name: '東拠点' }),
        await repo(ctx, WorkforceSite).create({ code: 'B', name: '西拠点' }),
      ];
    });
    siteA = sites[0]?.id ?? '';
    siteB = sites[1]?.id ?? '';
    managerId = await person('manager@event.test', ['workforce_manager'], { accessScope: 'sites', siteIds: [siteA] });
    const hrId = await person('hr@event.test', ['workforce_hr']);
    Object.assign(hr, { actor: { type: 'user', id: hrId }, roles: ['workforce_hr'] });
    for (const [who, params, site, code] of [
      ['alice', alice, siteA, 'A'],
      ['carol', carol, siteB, 'C'],
    ] as const) {
      const id = await person(`${who}@event.test`, ['workforce_employee'], { accessScope: 'sites', siteIds: [site] });
      Object.assign(params, {
        actor: { type: 'user', id },
        roles: ['workforce_employee'],
        accessScope: 'sites',
        siteIds: [site],
      });
      await wf(hr, 'register_employee', { userId: id, siteId: site, code, name: who, hiredOn: '2026-01-01' });
    }
    managerToken = await login(api, 'manager@event.test', 'test-password');
  });

  it('AC-18 AC-16 a site-scoped manager registers; the first check is a baseline; an increase in their own scope is mailed', async () => {
    const on = await call(api, managerToken, 'PUT', '/me/notifications', { inboxEmail: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toEqual({ inboxEmail: true, available: true });
    await db.owner.sql`update inbox_watches set next_check_at = ${NOW.toISOString()} where user_id = ${managerId}`;
    const first = await tick(NOW);
    expect(first.inbox).toMatchObject({ checked: 1, changed: 0 });
    expect(await watch()).toEqual({ last_total: 0 });
    await submittedExpense(alice);
    await submittedExpense(carol);
    const second = await tick(minutes(NOW, 16));
    expect(second.inbox).toMatchObject({ checked: 1, changed: 1 });
    const events = await changedEvents();
    expect(events).toHaveLength(1);
    // Carol's request belongs to the other site: the manager's own scope counts one.
    expect(events[0]?.payload).toMatchObject({ userId: managerId, total: 1, previousTotal: 0 });
    mail.messages.length = 0;
    const third = await tick(minutes(NOW, 17));
    expect(third.sends.sent).toBe(1);
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]?.to).toBe('manager@event.test');
    expect(mail.messages[0]?.text).toContain('0 件から 1 件');
    expect(mail.messages[0]?.text).toContain('承認待ちの経費: 1 件');
    expect(mail.messages[0]?.text).toContain(`${WEB}/inbox`);
    expect(mail.messages[0]?.messageId).toMatch(/^<[0-9a-f-]+@daifuku\.events>$/);
  });

  it('AC-16 two concurrent ticks count the user once and write one event', async () => {
    await submittedExpense(alice);
    const at = minutes(NOW, 40);
    await Promise.all([tick(at), tick(at)]);
    const events = await changedEvents();
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toMatchObject({ total: 2, previousTotal: 1 });
  });

  it('AC-16 a failing provider discards the observation; losing the company removes the registration', async () => {
    failing = true;
    await submittedExpense(alice);
    const captured = capture();
    const result = await tick(minutes(NOW, 60), { log: captured.log });
    expect(result.inbox).toMatchObject({ checked: 1, discarded: 1, changed: 0 });
    expect(await watch()).toEqual({ last_total: 2 });
    expect(captured.text()).not.toContain('secret-ish');
    failing = false;
    await db.owner.drizzle
      .delete(companyMemberships)
      .where(and(eq(companyMemberships.userId, managerId), eq(companyMemberships.companyId, db.companyId)));
    const removed = await tick(minutes(NOW, 80));
    expect(removed.inbox).toMatchObject({ checked: 1, removed: 1, changed: 0 });
    expect(await watch()).toBeUndefined();
    expect(await changedEvents()).toHaveLength(2);
  });
});

describe('self-service and admin access (AC-18, AC-19, AC-22, AC-23)', () => {
  it('AC-18 reasons for 409, off always works, and non-user actors are refused', async () => {
    const plainAdmin = await login(plain, 'admin@example.com');
    expect((await call(plain, plainAdmin, 'GET', '/me/notifications')).json()).toEqual({
      inboxEmail: false,
      available: false,
      reason: 'mail_not_configured',
    });
    const noMail = await call(plain, plainAdmin, 'PUT', '/me/notifications', { inboxEmail: true });
    expect(noMail.statusCode).toBe(409);
    expect(noMail.json()).toMatchObject({
      error: { code: 'INVALID_STATE', details: { reason: 'mail_not_configured' } },
    });
    expect((await call(plain, plainAdmin, 'PUT', '/me/notifications', { inboxEmail: false })).statusCode).toBe(200);
    const saved = await putWebhooks({ endpoints: [endpoint('recv', '/hook')], inboxEmail: false });
    expect(saved.statusCode).toBe(200);
    const off = await call(api, adminToken, 'PUT', '/me/notifications', { inboxEmail: true });
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ error: { details: { reason: 'company_disabled' } } });
    const agent = { 'x-agent-id': 'agent-under-test' };
    expect((await call(api, adminToken, 'GET', '/me/notifications', undefined, agent)).statusCode).toBe(403);
    expect((await call(api, adminToken, 'PUT', '/me/notifications', { inboxEmail: false }, agent)).statusCode).toBe(
      403,
    );
  });

  it('AC-22 settings role, store-scoped admin, no role and agents get 403 on every admin route', async () => {
    const tokens = [];
    const people: { email: string; roles: string[]; scope: Parameters<typeof person>[2] }[] = [
      { email: 'settings@event.test', roles: ['settings'], scope: {} },
      { email: 'store-admin@event.test', roles: ['admin'], scope: { accessScope: 'stores', storeIds: [newId()] } },
      { email: 'nobody@event.test', roles: [], scope: {} },
    ];
    for (const { email, roles, scope } of people) {
      await person(email, roles, scope);
      tokens.push({ token: await login(api, email, 'test-password'), headers: {} as Record<string, string> });
    }
    tokens.push({ token: adminToken, headers: { 'x-agent-id': 'agent-under-test' } });
    for (const { token, headers } of tokens)
      for (const [method, url] of [
        ['GET', '/admin/event-deliveries'],
        ['POST', `/admin/event-deliveries/${newId()}/retry`],
        ['GET', '/admin/webhooks'],
        ['POST', '/admin/webhooks/recv/secret'],
      ] as const) {
        const r = await call(api, token, method, url, undefined, headers);
        expect(r.statusCode, `${method} ${url} ${r.body}`).toBe(403);
      }
  });

  it('AC-23 another company sees none of the rows (404 on retry) and its endpoints receive nothing', async () => {
    await db.owner.sql`delete from event_deliveries`;
    received.length = 0;
    const companyB = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: companyB, tenantId: db.tenantId, code: 'EVB', name: 'Event B' });
    await db.owner.drizzle
      .insert(companyMemberships)
      .values({
        tenantId: db.tenantId,
        companyId: companyB,
        userId:
          (await db.owner.sql<{ id: string }[]>`select id from users where email = 'admin@example.com'`)[0]?.id ?? '',
        roles: ['admin'],
      })
      .onConflictDoNothing();
    const inB = { 'x-company-id': companyB };
    const savedB = await putWebhooks(
      { endpoints: [endpoint('recv', '/company-b')], inboxEmail: false },
      adminToken,
      inB,
    );
    expect(savedB.statusCode, savedB.body).toBe(200);
    expect((await call(api, adminToken, 'POST', '/admin/webhooks/recv/secret', undefined, inB)).statusCode).toBe(200);
    respond = (_req, res) => res.writeHead(500).end();
    await emit('test.ping', { company: 'A' });
    await tick(minutes(new Date(), 1));
    expect(received.map((r) => r.path)).toEqual(['/hook']);
    const [row] = await deliveryRows();
    const listB = await call(api, adminToken, 'GET', '/admin/event-deliveries?status=pending', undefined, inB);
    expect(listB.json()).toMatchObject({ items: [], counts: { pending: 0, dead: 0 } });
    expect(
      (await call(api, adminToken, 'POST', `/admin/event-deliveries/${row?.id}/retry`, undefined, inB)).statusCode,
    ).toBe(404);
    respond = (_req, res) => res.writeHead(200).end();
  });
});
