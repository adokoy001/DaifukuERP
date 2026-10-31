// docs/specs/setup-health.md AC-1..AC-8 with the full runtime (every module registered by ../src/modules.ts): each
// item is driven to ok and to warn / fail by changing data (closing a period, ending a tax rate, clearing the issuer,
// breaking the warehouse code), a throwing provider becomes `warn` without hiding the others, and nothing in the report
// carries a connection string, secret or file path. Dates are fixed through ctx.now (the company's business date).
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMPANY_PROFILE_KEY,
  companyProfileSchema,
  isHealthHref,
  label,
  PermissionDenied,
  runHealthChecks,
  setSetting,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
  type HealthCheckDef,
  type HealthReport,
} from '@daifuku/kernel';
import { freshDb, OWNER_URL, type TestDb } from '@daifuku/kernel/testing';
import {
  AUTO_ISSUE_ON_SALES_KEY,
  AUTO_RECEIPT_ON_PURCHASE_KEY,
  boolSettingSchema,
  DEFAULT_WAREHOUSE_KEY,
  warehouseCodeSchema,
} from '@daifuku/mod-inventory';
import { SALES_ISSUER_KEY, salesIssuerSchema } from '@daifuku/mod-sales';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appliedMigrationsReader } from '../src/deployment/readiness.ts';
import { platformHealthChecks, type PlatformHealthOptions } from '../src/health.ts';
import { modules } from '../src/modules.ts';
import { buildServer } from '../src/server.ts';

/** 2026-10-15 12:00 JST. */
const OCT = new Date('2026-10-15T03:00:00Z');
const DEC = new Date('2026-12-15T03:00:00Z');
const FEB_NEXT = new Date('2027-02-01T03:00:00Z');
const STABLE_IDS = [
  'accounting.fiscal_period',
  'tax.standard_rate',
  'company.profile',
  'sales.issuer',
  'inventory.stock_settings',
  'expense.accounts',
  'fixed_assets.depreciation_rules',
  'system.mail',
  'system.oidc',
  'system.migrations',
  'system.storage',
  'system.outbox',
];
/** The items of the kernel and the modules (the API adds the four platform items). */
const MODULE_IDS = STABLE_IDS.filter(
  (id) => !['system.mail', 'system.oidc', 'system.migrations', 'system.storage'].includes(id),
);
const KNOWN_HREFS = new Set([
  '/a/accounting.open_fiscal_year',
  '/finance/close',
  '/e/fiscal_period',
  '/e/tax_rate',
  '/e/warehouse',
  '/settings?tab=company',
  '/settings?tab=sales',
  '/settings?tab=inventory',
  '/settings?tab=accounting',
  '/settings?tab=purchase',
  '/finance/depreciation',
]);
const SECRET = 'oidc-client-secret-must-not-leak';
const ENCRYPTION = 'a'.repeat(64);

let db: TestDb;
let app: FastifyInstance;
let dir: string;
let storage: string;
let migrations: string;

const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}): Promise<T> =>
  db.run({ now: () => OCT, ...params }, fn);
const report = (params: Partial<ContextParams> = {}, extra: readonly HealthCheckDef[] = []) =>
  run((ctx) => runHealthChecks(ctx, extra), params);
const item = (r: HealthReport, id: string) => {
  const found = r.items.find((i) => i.id === id);
  expect(found, id).toBeDefined();
  return found as NonNullable<typeof found>;
};
const status = async (id: string, params: Partial<ContextParams> = {}, extra: readonly HealthCheckDef[] = []) =>
  item(await report(params, extra), id).status;
const owner = (query: string) => db.owner.sql.unsafe(query);
const platform = (opts: Partial<PlatformHealthOptions> = {}) =>
  platformHealthChecks({
    appliedMigrations: appliedMigrationsReader(db.owner),
    storageDirectory: storage,
    migrationsDirectory: migrations,
    ...opts,
  });

async function writeMigrations(tags: string[]): Promise<{ hash: string; when: string }[]> {
  await mkdir(join(migrations, 'meta'), { recursive: true });
  const entries = tags.map((tag, idx) => ({ idx, when: 1_700_000_000_000 + idx, tag }));
  await writeFile(join(migrations, 'meta/_journal.json'), JSON.stringify({ entries }));
  const out: { hash: string; when: string }[] = [];
  for (const entry of entries) {
    const body = `-- ${entry.tag}\nselect 1;\n`;
    await writeFile(join(migrations, `${entry.tag}.sql`), body);
    out.push({ hash: createHash('sha256').update(body).digest('hex'), when: String(entry.when) });
  }
  return out;
}

beforeAll(async () => {
  db = await freshDb();
  for (const m of modules)
    if (m.seed)
      await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now: () => OCT }), async (ctx) =>
        m.seed?.(ctx),
      );
  dir = await mkdtemp(join(tmpdir(), 'daifuku-health-'));
  storage = join(dir, 'storage');
  await mkdir(storage, { mode: 0o700 });
  migrations = join(dir, 'migrations');
  await writeMigrations(['0000_first', '0001_second']);
  app = await buildServer({
    owner: db.owner,
    app: db.app,
    jwtSecret: 'setup-health-test',
    logger: false,
    storageDirectory: storage,
    migrationsDirectory: migrations,
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('setup-health AC-1: GET /meta/health', () => {
  async function token(email: string, password = 'password') {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json<{ token: string }>().token;
  }

  it('AC-1: returns checkedAt and every item with a stable id, status, ja/en label and detail', async () => {
    const admin = await token('admin@example.com');
    const r = await app.inject({ method: 'GET', url: '/meta/health', headers: { authorization: `Bearer ${admin}` } });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json<HealthReport>();
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect(body.items.map((i) => i.id)).toEqual(STABLE_IDS);
    for (const i of body.items) {
      expect(['ok', 'warn', 'fail']).toContain(i.status);
      expect(i.label.ja && i.label.en && i.detail.ja && i.detail.en, i.id).toBeTruthy();
    }
    expect(r.body).not.toContain(storage);
    expect(r.body).not.toContain(migrations);
  });

  it('AC-1: a user without admin or settings gets 403; anonymous gets 401', async () => {
    const admin = await token('admin@example.com');
    const headers = { authorization: `Bearer ${admin}`, 'content-type': 'application/json' };
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: JSON.stringify({ email: 'health-sales@example.com', name: 'Sales', password: 'health-sales-pass' }),
    });
    expect(created.statusCode, created.body).toBe(200);
    const userId = created.json<{ id: string }>().id;
    const assign = await app.inject({
      method: 'PUT',
      url: `/admin/users/${userId}/companies/${db.companyId}`,
      headers,
      payload: JSON.stringify({ expectedVersion: 0, roles: ['sales'], accessScope: 'all', storeIds: [] }),
    });
    expect(assign.statusCode, assign.body).toBe(200);
    const sales = await token('health-sales@example.com', 'health-sales-pass');
    expect(
      (await app.inject({ method: 'GET', url: '/meta/health', headers: { authorization: `Bearer ${sales}` } }))
        .statusCode,
    ).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/meta/health' })).statusCode).toBe(401);
  });

  it('AC-1: the settings role may read; sales and store/site-scoped memberships are refused', async () => {
    expect((await report({ roles: ['settings'] })).items.map((i) => i.id)).toEqual(MODULE_IDS);
    await expect(report({ roles: ['sales'] })).rejects.toBeInstanceOf(PermissionDenied);
    await expect(report({ accessScope: 'stores', storeIds: [] })).rejects.toBeInstanceOf(PermissionDenied);
    await expect(report({ roles: ['settings'], accessScope: 'sites', siteIds: [] })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});

describe('setup-health AC-2: fiscal period', () => {
  it('AC-2: ok inside an open period, warn within 30 days of the last period, fail with none or a closed one', async () => {
    const ok = item(await report(), 'accounting.fiscal_period');
    expect(ok).toMatchObject({ status: 'ok', href: '/e/fiscal_period' });
    expect(ok.detail.ja).toContain('2026-10');
    expect(await status('accounting.fiscal_period', { now: () => DEC })).toBe('warn');
    const none = item(await report({ now: () => FEB_NEXT }), 'accounting.fiscal_period');
    expect(none).toMatchObject({ status: 'fail', href: '/a/accounting.open_fiscal_year' });
    await owner(`update fiscal_period set is_closed = true where code = '2026-10'`);
    try {
      expect(item(await report(), 'accounting.fiscal_period')).toMatchObject({
        status: 'fail',
        href: '/finance/close',
      });
    } finally {
      await owner(`update fiscal_period set is_closed = false where code = '2026-10'`);
    }
  });
});

describe('setup-health AC-3: standard tax rate', () => {
  it('AC-3: ok with a standard rate valid today, fail when it ended', async () => {
    expect(await status('tax.standard_rate')).toBe('ok');
    await owner(`update tax_rate set valid_to = '2026-09-30' where code = 'STD10'`);
    try {
      expect(item(await report(), 'tax.standard_rate')).toMatchObject({ status: 'fail', href: '/e/tax_rate' });
    } finally {
      await owner(`update tax_rate set valid_to = null where code = 'STD10'`);
    }
    expect(await status('tax.standard_rate')).toBe('ok');
  });
});

describe('setup-health AC-4: company profile and invoice issuer', () => {
  const profile = (value: unknown) => run((ctx) => setSetting(ctx, COMPANY_PROFILE_KEY, companyProfileSchema, value));
  const resetSettings = () =>
    owner(`update companies set settings = settings - 'company.profile' - 'sales.issuer' where id = '${db.companyId}'`);

  it('AC-4: nothing set -> profile and issuer warn (only the company name is printed)', async () => {
    await resetSettings();
    const r = await report();
    expect(item(r, 'company.profile')).toMatchObject({ status: 'warn', href: '/settings?tab=company' });
    expect(item(r, 'sales.issuer')).toMatchObject({ status: 'warn', href: '/settings?tab=company' });
  });

  it('AC-4: a legal name and registration number make both ok; a missing number warns unless exempt', async () => {
    await profile({ legalName: '点検株式会社', invoiceRegistrationNo: 'T1234567890123' });
    let r = await report();
    expect(item(r, 'company.profile').status).toBe('ok');
    expect(item(r, 'sales.issuer').status).toBe('ok');
    await profile({ legalName: '点検株式会社' });
    r = await report();
    expect(item(r, 'sales.issuer')).toMatchObject({ status: 'warn' });
    expect(item(r, 'sales.issuer').detail.ja).toContain('登録番号');
    await profile({ legalName: '点検株式会社', taxStatus: 'exempt' });
    expect(await status('sales.issuer')).toBe('ok');
  });

  it('AC-4: a stored value that no longer matches the definition warns', async () => {
    await owner(
      `update companies set settings = settings || '{"company.profile":{"invoiceRegistrationNo":"BAD"},"sales.issuer":{"name":""}}'::jsonb where id = '${db.companyId}'`,
    );
    const r = await report();
    expect(item(r, 'company.profile').status).toBe('warn');
    expect(item(r, 'sales.issuer')).toMatchObject({ status: 'warn', href: '/settings?tab=sales' });
    await resetSettings();
    await run((ctx) =>
      setSetting(ctx, SALES_ISSUER_KEY, salesIssuerSchema, {
        name: '請求名義',
        invoiceRegistrationNo: 'T9999999999999',
      }),
    );
    expect(item(await report(), 'sales.issuer')).toMatchObject({ status: 'ok', href: '/settings?tab=sales' });
    await resetSettings();
  });
});

describe('setup-health AC-5: inventory settings', () => {
  const put = (key: string, schema: Parameters<typeof setSetting>[2], value: unknown) =>
    run((ctx) => setSetting(ctx, key, schema, value));

  it('AC-5: ok with the seeded MAIN warehouse and goods; fail without a usable warehouse; warn without goods', async () => {
    expect(await status('inventory.stock_settings')).toBe('ok');
    await put(DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, 'NOPE');
    try {
      // MAIN is still marked default, which invoices fall back to.
      expect(await status('inventory.stock_settings')).toBe('warn');
      await owner(`update warehouse set is_default = false where code = 'MAIN'`);
      expect(item(await report(), 'inventory.stock_settings')).toMatchObject({ status: 'fail', href: '/e/warehouse' });
    } finally {
      await owner(`update warehouse set is_default = true where code = 'MAIN'`);
      await put(DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, 'MAIN');
    }
    await owner(`update product set is_active = false where kind = 'goods'`);
    try {
      const noGoods = item(await report(), 'inventory.stock_settings');
      expect(noGoods).toMatchObject({ status: 'warn', href: '/settings?tab=inventory' });
      await put(AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema, false);
      await put(AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, false);
      expect(await status('inventory.stock_settings')).toBe('ok');
    } finally {
      await owner(`update product set is_active = true where kind = 'goods'`);
      await put(AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema, true);
      await put(AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, true);
    }
  });
});

describe('setup-health AC-6: operations (booleans and counts only)', () => {
  it('AC-6 (event-delivery AC-24): retrying rows are a count; dead events and dead deliveries warn', async () => {
    const before = item(await report(), 'system.outbox');
    expect(before.status).toBe('ok');
    expect(before.href).toBeUndefined();
    // A row that failed once and waits for its retry is not a warning any more (event-delivery AC-24).
    await owner(
      `insert into outbox (id, tenant_id, company_id, topic, payload, attempts, last_error, next_attempt_at) values (gen_random_uuid(), '${db.tenantId}', '${db.companyId}', 'health.probe', '{}', 1, 'connect ECONNREFUSED 10.0.0.1:5432', now() + interval '1 minute')`,
    );
    const retrying = item(await report(), 'system.outbox');
    expect(retrying.status).toBe('ok');
    expect(retrying.detail.en).toContain('Undelivered events: 1');
    // The same row at the retry limit (dead) warns; an administrator gets the link to the delivery screen.
    await owner(`update outbox set dead_at = now(), attempts = 8 where topic = 'health.probe'`);
    const failed = item(await report(), 'system.outbox');
    expect(failed.status).toBe('warn');
    expect(failed.href).toBe('/admin/event-deliveries?status=dead');
    expect(JSON.stringify(failed)).not.toContain('ECONNREFUSED');
    expect(item(await report({ roles: ['settings'] }), 'system.outbox')).toMatchObject({ status: 'warn' });
    expect(item(await report({ roles: ['settings'] }), 'system.outbox').href).toBeUndefined();
    await owner(`delete from outbox where topic = 'health.probe'`);
    expect(item(await report(), 'system.outbox').status).toBe('ok');
    // A dead webhook delivery row warns too; a pending one is only counted.
    const event = '0190d0a8-0000-7000-8000-00000000a024';
    await owner(
      `insert into event_deliveries (id, tenant_id, company_id, event_id, topic, channel, target, payload, event_created_at, status, attempts, next_attempt_at, created_at, last_error, dead_at) values (gen_random_uuid(), '${db.tenantId}', '${db.companyId}', '${event}', 'health.probe', 'webhook', 'probe', '{}', now(), 'pending', 1, now(), now(), 'http_status', null)`,
    );
    const waiting = item(await report(), 'system.outbox');
    expect(waiting.status).toBe('ok');
    expect(waiting.detail.en).toContain('deliveries waiting to be sent: 1');
    await owner(`update event_deliveries set status = 'dead', dead_at = now() where event_id = '${event}'`);
    const dead = item(await report(), 'system.outbox');
    expect(dead.status).toBe('warn');
    expect(dead.detail.en).toContain('1 event deliveries failed');
    expect(JSON.stringify(dead)).not.toContain('probe');
    await owner(`delete from event_deliveries where event_id = '${event}'`);
  });

  it('AC-6: mail and SSO report only whether they are configured; no secret, URL or key appears', async () => {
    const bare = await report({}, platform());
    expect(item(bare, 'system.mail').status).toBe('warn');
    expect(item(bare, 'system.oidc').status).toBe('ok');
    const identity = {
      encryptionKey: ENCRYPTION,
      webUrl: 'https://erp.example.com',
      providers: [
        {
          id: 'corp',
          label: 'Corp SSO',
          tenantId: db.tenantId,
          issuer: 'https://idp.example.com',
          clientId: 'client-id-xyz',
          clientSecret: SECRET,
          authorizationEndpoint: 'https://idp.example.com/authorize',
          tokenEndpoint: 'https://idp.example.com/token',
          jwksUri: 'https://idp.example.com/jwks',
        },
      ],
      mailTransport: { send: async () => undefined },
    };
    const configured = await report({}, platform({ identity }));
    expect(item(configured, 'system.mail').status).toBe('ok');
    expect(item(configured, 'system.oidc').detail.ja).toContain('設定済み');
    const text = JSON.stringify(configured);
    for (const secret of [SECRET, ENCRYPTION, 'idp.example.com', 'client-id-xyz', OWNER_URL, storage, migrations, dir])
      expect(text).not.toContain(secret);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('AC-6: migrations are counted against the release catalog (no record -> warn, pending or unknown -> fail)', async () => {
    const catalog = await writeMigrations(['0000_first', '0001_second']);
    expect(await status('system.migrations', {}, platform())).toBe('warn');
    await owner(`create schema if not exists drizzle`);
    await owner(
      `create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
    );
    try {
      await owner(
        `insert into drizzle.__drizzle_migrations (hash, created_at) values ('${catalog[0]?.hash}', ${catalog[0]?.when})`,
      );
      const pending = item(await report({}, platform()), 'system.migrations');
      expect(pending.status).toBe('fail');
      expect(pending.detail.en).toContain('1 pending');
      await owner(
        `insert into drizzle.__drizzle_migrations (hash, created_at) values ('${catalog[1]?.hash}', ${catalog[1]?.when})`,
      );
      expect(await status('system.migrations', {}, platform())).toBe('ok');
      await owner(`insert into drizzle.__drizzle_migrations (hash, created_at) values ('bogus', 1800000000000)`);
      const unknown = item(await report({}, platform()), 'system.migrations');
      expect(unknown.status).toBe('fail');
      expect(unknown.detail.en).toContain('1 unknown');
    } finally {
      await owner(`drop schema drizzle cascade`);
    }
  });

  it('AC-6: storage is ok when writable or not created yet, fail when not a writable directory, warn when unset', async () => {
    expect(await status('system.storage', {}, platform())).toBe('ok');
    expect(await status('system.storage', {}, platform({ storageDirectory: join(dir, 'later') }))).toBe('ok');
    const file = join(dir, 'a-file');
    await writeFile(file, 'x');
    const broken = item(await report({}, platform({ storageDirectory: file })), 'system.storage');
    expect(broken.status).toBe('fail');
    expect(JSON.stringify(broken)).not.toContain(dir);
    const { storageDirectory: _unset, ...withoutStorage } = {
      appliedMigrations: appliedMigrationsReader(db.owner),
      storageDirectory: storage,
    };
    expect(await status('system.storage', {}, platformHealthChecks(withoutStorage))).toBe('warn');
  });
});

describe('setup-health AC-7/AC-8: providers', () => {
  const probe = (id: string, run: HealthCheckDef['run']): HealthCheckDef => ({
    id,
    label: label(`検査 ${id}`, `Probe ${id}`),
    run,
  });

  it('AC-7: a throwing provider becomes warn ("could not be checked") and the others still answer', async () => {
    const r = await report({}, [
      probe('probe.throws', async () => {
        throw new Error('internal detail /var/lib/secret');
      }),
      probe('probe.sql', async (ctx) => {
        await ctx.db.execute(sql`select * from no_such_table`);
        return { status: 'ok', detail: label('x', 'x') };
      }),
      probe('probe.after', async () => ({ status: 'ok', detail: label('動く', 'Works') })),
    ]);
    expect(item(r, 'probe.throws')).toMatchObject({
      status: 'warn',
      detail: { en: expect.stringContaining('could not be checked') },
    });
    expect(JSON.stringify(r)).not.toContain('/var/lib/secret');
    // The failed SQL is rolled back to its savepoint, so the next check still runs in a usable transaction.
    expect(item(r, 'probe.sql').status).toBe('warn');
    expect(item(r, 'probe.after').status).toBe('ok');
    expect(r.items.map((i) => i.id).slice(0, MODULE_IDS.length)).toEqual(MODULE_IDS);
  });

  it('AC-7: the log of a failing check carries the SQLSTATE only, never the SQL text or its bound values', async () => {
    const logged: unknown[] = [];
    const log = {
      info: () => undefined,
      warn: (msg: string, data?: Record<string, unknown>) => logged.push({ msg, ...data }),
      error: (msg: string, data?: Record<string, unknown>) => logged.push({ msg, ...data }),
    };
    const email = 'health-person@example.com';
    const r = await report({ log }, [
      probe('probe.sql_value', async (ctx) => {
        await ctx.db.execute(sql`select ${email}::text as who, 1 / 0 as boom`);
        return { status: 'ok', detail: label('x', 'x') };
      }),
    ]);
    expect(item(r, 'probe.sql_value').status).toBe('warn');
    expect(logged).toEqual([
      expect.objectContaining({
        msg: 'health check failed',
        id: 'probe.sql_value',
        code: 'INTERNAL',
        sqlState: '22012',
      }),
    ]);
    const text = JSON.stringify(logged);
    for (const leak of ['Failed query', email, '1 / 0']) expect(text).not.toContain(leak);
    expect(JSON.stringify(r)).not.toContain(email);
  });

  it('AC-7: in the read-only transaction of GET /meta/health a check that writes fails alone (warn)', async () => {
    const params: ContextParams = {
      tenantId: db.tenantId,
      companyId: db.companyId,
      actor: { type: 'user', id: db.adminUserId },
      roles: ['admin'],
      now: () => OCT,
    };
    const r = await withContext(
      db.app,
      params,
      (ctx) =>
        runHealthChecks(ctx, [
          probe('probe.writes', async (ctx) => {
            await ctx.db.execute(sql`update companies set name = name where id = ${ctx.companyId}`);
            return { status: 'ok', detail: label('書いた', 'Wrote') };
          }),
          probe('probe.after_write', async () => ({ status: 'ok', detail: label('動く', 'Works') })),
        ]),
      { readOnlySnapshot: true },
    );
    expect(item(r, 'probe.writes').status).toBe('warn');
    expect(item(r, 'probe.after_write').status).toBe('ok');
    expect(item(r, 'tax.standard_rate').status).toBe('ok');
  });

  it('AC-7: a check the caller may not read says so (settings role on fiscal periods)', async () => {
    const r = await report({ roles: ['settings'] });
    expect(item(r, 'accounting.fiscal_period')).toMatchObject({
      status: 'warn',
      detail: { en: expect.stringContaining('permission') },
    });
    expect(item(r, 'tax.standard_rate').status).toBe('ok'); // settings may read tax rates
  });

  it('AC-7: an invalid outcome is warn; AC-8: an outside href is dropped', async () => {
    const r = await report({}, [
      probe('probe.invalid', async () => ({ status: 'great', detail: label('x', 'x') }) as never),
      probe('probe.outside', async () => ({ status: 'ok', detail: label('x', 'x'), href: 'https://evil.example.com' })),
      probe('probe.relative', async () => ({ status: 'ok', detail: label('x', 'x'), href: '//evil.example.com/x' })),
    ]);
    expect(item(r, 'probe.invalid').status).toBe('warn');
    expect(item(r, 'probe.outside')).not.toHaveProperty('href');
    expect(item(r, 'probe.relative')).not.toHaveProperty('href');
  });

  it('AC-8: every href of the real report is a known in-app path', async () => {
    const hrefs = new Set<string>();
    for (const now of [OCT, DEC, FEB_NEXT])
      for (const i of (await report({ now: () => now }, platform())).items) if (i.href) hrefs.add(i.href);
    for (const href of hrefs) {
      expect(isHealthHref(href), href).toBe(true);
      expect(KNOWN_HREFS.has(href), href).toBe(true);
    }
  });
});
