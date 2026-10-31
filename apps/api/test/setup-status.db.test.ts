// docs/specs/setup-wizard.md AC-2, AC-5, AC-6, AC-8, AC-11..AC-16, AC-22, AC-26 with the full runtime (every module
// registered by ../src/modules.ts): each step is driven from todo to done by changing real data, skips are recorded
// through the ordinary PUT /meta/settings/setup.progress, only company-wide admins may read the status, and one company's
// records and members never show in another's. Dates are fixed through ctx.now (the company's business date); the HTTP
// cases avoid date-dependent steps.
import {
  activeCompanyMemberCount,
  COMPANY_PROFILE_KEY,
  companyProfileSchema,
  createCompany,
  deleteSetting,
  NotFound,
  PACKS_APPLIED_KEY,
  PermissionDenied,
  registry,
  runAction,
  setSetting,
  SETUP_PROGRESS_KEY,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, OWNER_URL, type TestDb } from '@daifuku/kernel/testing';
import {
  AUTO_ISSUE_ON_SALES_KEY,
  AUTO_RECEIPT_ON_PURCHASE_KEY,
  boolSettingSchema,
  DEFAULT_WAREHOUSE_KEY,
  warehouseCodeSchema,
} from '@daifuku/mod-inventory';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';
import { buildServer } from '../src/server.ts';
import { setupStatus, type SetupStatus } from '../src/setup-status.ts';

/** 2026-10-15 12:00 JST. */
const OCT = new Date('2026-10-15T03:00:00Z');
const DEC = new Date('2026-12-15T03:00:00Z');
const FEB_NEXT = new Date('2027-02-01T03:00:00Z');
const AT = '2026-10-15T03:00:00.000Z';

let db: TestDb;
let app: FastifyInstance;

const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}): Promise<T> =>
  db.run({ now: () => OCT, ...params }, fn);
const status = (params: Partial<ContextParams> = {}) => run((ctx) => setupStatus(ctx), params);
const step = (s: SetupStatus, id: string) => {
  const found = s.steps.find((x) => x.id === id);
  expect(found, id).toBeDefined();
  return found as NonNullable<typeof found>;
};
const stepStatus = async (id: string, params: Partial<ContextParams> = {}) => step(await status(params), id).status;
const owner = (query: string) => db.owner.sql.unsafe(query);
const put = (
  key: string,
  schema: Parameters<typeof setSetting>[2],
  value: unknown,
  params: Partial<ContextParams> = {},
) => run((ctx) => setSetting(ctx, key, schema, value), params);
const packsSchema = () => registry.setting(PACKS_APPLIED_KEY).schema;

async function token(email: string, password = 'password') {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ token: string }>().token;
}
const bearer = async (email = 'admin@example.com', password = 'password') => ({
  authorization: `Bearer ${await token(email, password)}`,
  'content-type': 'application/json',
});

/** A user with one membership in `companyId`, created through the admin API (the users step's real path). */
async function member(email: string, roles: string[], companyId = db.companyId, accessScope = 'all') {
  const headers = await bearer();
  const created = await app.inject({
    method: 'POST',
    url: '/admin/users',
    headers,
    payload: JSON.stringify({ email, name: email.split('@')[0], password: 'setup-member-pass' }),
  });
  expect(created.statusCode, created.body).toBe(200);
  const userId = created.json<{ id: string }>().id;
  const assign = await app.inject({
    method: 'PUT',
    url: `/admin/users/${userId}/companies/${companyId}`,
    headers,
    payload: JSON.stringify({ expectedVersion: 0, roles, accessScope, storeIds: [], siteIds: [] }),
  });
  expect(assign.statusCode, assign.body).toBe(200);
  return userId;
}

beforeAll(async () => {
  db = await freshDb();
  for (const m of modules)
    if (m.seed)
      await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now: () => OCT }), async (ctx) =>
        m.seed?.(ctx),
      );
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'setup-status-test', logger: false });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('setup-wizard AC-5/AC-14: GET /meta/setup-status', () => {
  it('AC-5: returns checkedAt, nine steps with checks, the summary and the stored progress', async () => {
    const r = await app.inject({ method: 'GET', url: '/meta/setup-status', headers: await bearer() });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json<SetupStatus>();
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect(body.steps.map((s) => s.id)).toEqual([
      'company_profile',
      'fiscal_year',
      'chart_of_accounts',
      'tax',
      'invoice_issuer',
      'inventory',
      'industry_template',
      'users',
      'workforce',
    ]);
    for (const s of body.steps) {
      expect(['done', 'todo', 'skipped']).toContain(s.status);
      expect(s.checks.length).toBeGreaterThan(0);
      for (const c of s.checks) expect(c.label.ja && c.label.en && c.detail.ja && c.detail.en, c.id).toBeTruthy();
    }
    expect(body.summary.required).toBe(8);
    expect(body.progress).toEqual({});
  });

  it('AC-14: read-only — no audit row is written, and no email, connection string or user name is returned', async () => {
    const headers = await bearer();
    const before = await owner(`select count(*)::int as n from audit_log`);
    const r = await app.inject({ method: 'GET', url: '/meta/setup-status', headers });
    expect(r.statusCode, r.body).toBe(200);
    const after = await owner(`select count(*)::int as n from audit_log`);
    expect(after[0]?.n).toBe(before[0]?.n);
    expect(r.body).not.toContain('admin@example.com');
    expect(r.body).not.toContain(OWNER_URL);
    expect(r.body).not.toMatch(/postgres(ql)?:\/\//);
    expect(r.body).not.toContain('"Admin"');
  });

  it('AC-8: anonymous gets 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/meta/setup-status' })).statusCode).toBe(401);
  });
});

describe('setup-wizard AC-8: admin with company-wide access only', () => {
  it('AC-8: sales and settings roles get 403 over HTTP (the settings role may still edit settings)', async () => {
    await member('setup-sales@example.com', ['sales']);
    await member('setup-settings@example.com', ['settings']);
    for (const email of ['setup-sales@example.com', 'setup-settings@example.com']) {
      const r = await app.inject({
        method: 'GET',
        url: '/meta/setup-status',
        headers: await bearer(email, 'setup-member-pass'),
      });
      expect(r.statusCode, email).toBe(403);
      expect(r.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
    }
  });

  it('AC-8: store- and site-limited contexts are refused even with the admin role', async () => {
    await expect(status({ roles: ['settings'] })).rejects.toBeInstanceOf(PermissionDenied);
    await expect(status({ roles: ['admin'], accessScope: 'stores', storeIds: [] })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(status({ roles: ['admin'], accessScope: 'sites', siteIds: [] })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it('AC-13: a context without a company (tenant admin, none selected) is refused like GET /meta/settings', async () => {
    await expect(status({ companyId: null })).rejects.toBeInstanceOf(NotFound);
  });
});

describe('setup-wizard AC-5/AC-16: each step from todo to done with real data', () => {
  const resetCompanySettings = () =>
    owner(
      `update companies set settings = settings - 'company.profile' - 'sales.issuer' - 'setup.progress' where id = '${db.companyId}'`,
    );

  it('AC-5: company profile — todo without a legal name, done once it is saved', async () => {
    await resetCompanySettings();
    const before = step(await status(), 'company_profile');
    expect(before.status).toBe('todo');
    expect(before.checks[0]).toMatchObject({ id: 'company.profile', status: 'warn' });
    await put(COMPANY_PROFILE_KEY, companyProfileSchema, { legalName: '段階株式会社' });
    expect(await stepStatus('company_profile')).toBe('done');
  });

  it('AC-5: fiscal year — done inside the seeded year, todo within 30 days of its end and without a year', async () => {
    expect(await stepStatus('fiscal_year')).toBe('done');
    const dec = step(await status({ now: () => DEC }), 'fiscal_year');
    expect(dec).toMatchObject({ status: 'todo', checks: [{ id: 'accounting.fiscal_period', status: 'warn' }] });
    const feb = await status({ now: () => FEB_NEXT });
    expect(step(feb, 'fiscal_year').checks[0]?.status).toBe('fail');
    expect(feb.summary.attention).toContain('fiscal_year');
  });

  it('AC-5: chart of accounts — todo when no active output-tax account remains, done again when restored', async () => {
    expect(await stepStatus('chart_of_accounts')).toBe('done');
    await owner(`update account set is_active = false where tax_role = 'output_tax'`);
    try {
      const s = step(await status(), 'chart_of_accounts');
      expect(s).toMatchObject({ status: 'todo', checks: [{ id: 'setup.chart_of_accounts', status: 'warn' }] });
      expect(s.checks[0]?.detail.en).toContain('output 0');
    } finally {
      await owner(`update account set is_active = true where tax_role = 'output_tax'`);
    }
    expect(await stepStatus('chart_of_accounts')).toBe('done');
  });

  it('AC-5: tax — todo (fail, attention) when the standard rate ended, done when valid again', async () => {
    expect(await stepStatus('tax')).toBe('done');
    await owner(`update tax_rate set valid_to = '2026-09-30' where code = 'STD10'`);
    try {
      const s = await status();
      expect(step(s, 'tax').status).toBe('todo');
      expect(s.summary.attention).toContain('tax');
    } finally {
      await owner(`update tax_rate set valid_to = null where code = 'STD10'`);
    }
    expect(await stepStatus('tax')).toBe('done');
  });

  it('AC-5: invoice issuer — needs the registration number unless the business is exempt', async () => {
    await put(COMPANY_PROFILE_KEY, companyProfileSchema, { legalName: '段階株式会社' });
    expect(await stepStatus('invoice_issuer')).toBe('todo');
    await put(COMPANY_PROFILE_KEY, companyProfileSchema, {
      legalName: '段階株式会社',
      invoiceRegistrationNo: 'T1234567890123',
    });
    expect(await stepStatus('invoice_issuer')).toBe('done');
    await put(COMPANY_PROFILE_KEY, companyProfileSchema, { legalName: '段階株式会社', taxStatus: 'exempt' });
    expect(await stepStatus('invoice_issuer')).toBe('done');
  });

  it('AC-5: inventory — todo when automatic movements cannot find a warehouse, done when they are turned off', async () => {
    expect(await stepStatus('inventory')).toBe('done');
    await put(DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, 'NOPE');
    await owner(`update warehouse set is_default = false where code = 'MAIN'`);
    try {
      const s = await status();
      expect(step(s, 'inventory').status).toBe('todo');
      expect(s.summary.attention).toContain('inventory');
      await put(AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema, false);
      await put(AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, false);
      expect(await stepStatus('inventory')).toBe('done');
    } finally {
      await owner(`update warehouse set is_default = true where code = 'MAIN'`);
      await put(DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, 'MAIN');
      await put(AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema, true);
      await put(AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, true);
    }
  });

  it('AC-5: industry template — the example template alone does not count; an industry template does', async () => {
    expect(await stepStatus('industry_template')).toBe('todo');
    const applied = { at: AT, version: '1.0.0' };
    await put(PACKS_APPLIED_KEY, packsSchema(), { example: applied });
    expect(await stepStatus('industry_template')).toBe('todo');
    await put(PACKS_APPLIED_KEY, packsSchema(), { example: applied, retail: applied });
    const s = step(await status(), 'industry_template');
    expect(s.status).toBe('done');
    expect(s.checks[0]?.detail.en).toContain('retail');
    await put(PACKS_APPLIED_KEY, packsSchema(), {});
  });

  it('AC-5: users — one active member is todo, a second makes it done, deactivating it is todo again', async () => {
    // The AC-8 cases above added sales and settings members; start from the administrator alone.
    await owner(`update users set active = false where email like 'setup-%@example.com'`);
    expect(await run((ctx) => activeCompanyMemberCount(ctx))).toBe(1);
    const before = step(await status(), 'users');
    expect(before).toMatchObject({ status: 'todo', checks: [{ id: 'setup.users', status: 'warn' }] });
    expect(before.checks[0]?.detail.en).toContain('1 active user');
    await owner(`update users set active = true where email = 'setup-sales@example.com'`);
    expect(await stepStatus('users')).toBe('done');
    await owner(`update users set active = false where email = 'setup-sales@example.com'`);
    expect(await stepStatus('users')).toBe('todo');
    await owner(`update users set active = true where email like 'setup-%@example.com'`);
  });

  it('AC-5: work and pay — todo in a company without the workforce seed, done after workforce.initialize_policy', async () => {
    expect(await stepStatus('workforce')).toBe('done');
    const created = await run((ctx) =>
      createCompany(
        ctx,
        { code: 'NOWF', name: '勤怠なし株式会社', country: 'JP', currency: 'JPY' },
        { modules: registry.allModules().filter((m) => m.name !== 'workforce') },
      ),
    );
    const s = step(await status({ companyId: created.id }), 'workforce');
    expect(s).toMatchObject({ status: 'todo', optional: true, checks: [{ id: 'setup.workforce_policy' }] });
    await run((ctx) => runAction(ctx, 'workforce.initialize_policy', {}), { companyId: created.id });
    expect(await stepStatus('workforce', { companyId: created.id })).toBe('done');
  });

  it('AC-16: a condition that fails is "could not be checked" for its step only; the rest still answer', async () => {
    await owner(`alter table workforce_pay_policy rename to workforce_pay_policy_hidden`);
    let s: SetupStatus;
    try {
      s = await status();
    } finally {
      await owner(`alter table workforce_pay_policy_hidden rename to workforce_pay_policy`);
    }
    const workforce = step(s, 'workforce');
    expect(workforce).toMatchObject({ status: 'todo', checks: [{ id: 'setup.workforce_policy', status: 'warn' }] });
    expect(workforce.checks[0]?.detail.en).toContain('could not be checked');
    expect(JSON.stringify(workforce)).not.toContain('workforce_pay_policy_hidden');
    expect(step(s, 'tax').status).toBe('done');
    expect(step(s, 'chart_of_accounts').status).toBe('done');
  });
});

describe('setup-wizard AC-6/AC-11/AC-15/AC-26: skips through PUT /meta/settings/setup.progress', () => {
  const save = async (value: unknown) =>
    app.inject({
      method: 'PUT',
      url: `/meta/settings/${SETUP_PROGRESS_KEY}`,
      headers: await bearer(),
      payload: JSON.stringify({ value }),
    });

  it('AC-6: a skip with a reason makes a todo step skipped; meeting the condition later makes it done', async () => {
    await put(PACKS_APPLIED_KEY, packsSchema(), {});
    const r = await save({
      industry_template: { state: 'skipped', at: AT, reason: '  業界テンプレートは使わない  ' },
      updatedAt: AT,
    });
    expect(r.statusCode, r.body).toBe(200);
    let s = await status();
    expect(step(s, 'industry_template')).toMatchObject({
      status: 'skipped',
      reason: '業界テンプレートは使わない',
      skippedAt: AT,
    });
    expect(s.summary.skipped).toBeGreaterThanOrEqual(1);
    expect(s.progress.industry_template).toMatchObject({ state: 'skipped' });
    await put(PACKS_APPLIED_KEY, packsSchema(), { retail: { at: AT, version: '1.0.0' } });
    s = await status();
    expect(step(s, 'industry_template')).toMatchObject({ status: 'done', reason: '業界テンプレートは使わない' });
    await put(PACKS_APPLIED_KEY, packsSchema(), {});
  });

  it('AC-6: removing the record (undo skip) brings the step back to todo', async () => {
    expect((await save({ updatedAt: AT })).statusCode).toBe(200);
    expect(step(await status(), 'industry_template')).toMatchObject({ status: 'todo' });
    expect(step(await status(), 'industry_template').reason).toBeUndefined();
  });

  it('AC-26: a skip without a reason, or with more than 200 characters, is a 400 and the record is unchanged', async () => {
    const stored = await save({ users: { state: 'skipped', at: AT, reason: '一人で使う' } });
    expect(stored.statusCode).toBe(200);
    for (const reason of [undefined, '   ', 'x'.repeat(201)]) {
      const r = await save({ users: { state: 'skipped', at: AT, ...(reason === undefined ? {} : { reason }) } });
      expect(r.statusCode, String(reason)).toBe(400);
      expect(r.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
    }
    expect((await status()).progress.users).toEqual({ state: 'skipped', at: AT, reason: '一人で使う' });
  });

  it('AC-11: a completed record with a reason is refused (strict)', async () => {
    const r = await save({ tax: { state: 'completed', at: AT, reason: 'checked' } });
    expect(r.statusCode).toBe(400);
  });

  it('AC-15: a completed record keeps a met step done (completedAt) and marks it regressed once unmet', async () => {
    expect((await save({ tax: { state: 'completed', at: AT } })).statusCode).toBe(200);
    expect(step(await status(), 'tax')).toMatchObject({ status: 'done', completedAt: AT, regressed: false });
    await owner(`update tax_rate set valid_to = '2026-09-30' where code = 'STD10'`);
    try {
      expect(step(await status(), 'tax')).toMatchObject({ status: 'todo', completedAt: AT, regressed: true });
    } finally {
      await owner(`update tax_rate set valid_to = null where code = 'STD10'`);
    }
  });

  it('AC-11: a stored value that does not match the schema reads as no record; status still answers', async () => {
    await owner(
      `update companies set settings = settings || '{"setup.progress":{"tax":{"state":"bogus"}}}'::jsonb where id = '${db.companyId}'`,
    );
    const s = await status();
    expect(s.progress).toEqual({});
    expect(step(s, 'tax').completedAt).toBeUndefined();
    await owner(`update companies set settings = settings - 'setup.progress' where id = '${db.companyId}'`);
  });

  it('AC-12: GET /meta/settings lists setup.progress on the system tab with managedBy', async () => {
    const r = await app.inject({ method: 'GET', url: '/meta/settings', headers: await bearer() });
    expect(r.statusCode, r.body).toBe(200);
    const def = r
      .json<{ key: string; category: string; managedBy?: unknown }[]>()
      .find((s) => s.key === SETUP_PROGRESS_KEY);
    expect(def).toMatchObject({
      category: 'system',
      managedBy: { href: '/setup', label: { ja: 'セットアップ', en: 'Setup' } },
    });
  });

  it('AC-2/AC-8 (decision 5): only admins write setup.progress; the settings role gets 403 and changes nothing', async () => {
    const record = { users: { state: 'skipped', at: AT, reason: '一人で使う' }, updatedAt: AT };
    expect((await save(record)).statusCode).toBe(200);
    await member('setup-progress-settings@example.com', ['settings']);
    const headers = await bearer('setup-progress-settings@example.com', 'setup-member-pass');
    const skip = await app.inject({
      method: 'PUT',
      url: `/meta/settings/${SETUP_PROGRESS_KEY}`,
      headers,
      payload: JSON.stringify({ value: { company_profile: { state: 'skipped', at: AT, reason: '設定係が省略' } } }),
    });
    expect(skip.statusCode, skip.body).toBe(403);
    expect(skip.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
    const remove = await app.inject({
      method: 'DELETE',
      url: `/meta/settings/${SETUP_PROGRESS_KEY}`,
      headers: { authorization: headers.authorization },
    });
    expect(remove.statusCode, remove.body).toBe(403);
    expect((await status()).progress).toEqual(record);
    // The rule lives in the kernel port, so every adapter (MCP, actions) gets it, not only this route.
    const schema = registry.setting(SETUP_PROGRESS_KEY).schema;
    await expect(put(SETUP_PROGRESS_KEY, schema, {}, { roles: ['settings'] })).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run((ctx) => deleteSetting(ctx, SETUP_PROGRESS_KEY), { roles: ['settings'] })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    expect((await status()).progress).toEqual(record);
    // The same member still changes ordinary settings (admin or settings, ADR-0027): it saves the value in effect.
    const listed = await app.inject({ method: 'GET', url: '/meta/settings', headers });
    const pricing = listed
      .json<{ key: string; value: unknown; defaultValue?: unknown; isDefault: boolean }[]>()
      .find((x) => x.key === 'tax.price_includes_tax');
    expect(pricing).toBeDefined();
    const ordinary = await app.inject({
      method: 'PUT',
      url: '/meta/settings/tax.price_includes_tax',
      headers,
      payload: JSON.stringify({ value: pricing?.isDefault ? pricing.defaultValue : pricing?.value }),
    });
    expect(ordinary.statusCode, ordinary.body).toBe(200);
    // An admin may still remove the record (undo everything).
    expect(await run((ctx) => deleteSetting(ctx, SETUP_PROGRESS_KEY))).toBe(true);
    expect((await status()).progress).toEqual({});
  });
});

describe('setup-wizard AC-13/AC-22: company isolation and member counting', () => {
  let other: string;

  beforeAll(async () => {
    const created = await run((ctx) =>
      createCompany(ctx, { code: 'ISO2', name: '分離確認株式会社', country: 'JP', currency: 'JPY' }),
    );
    other = created.id;
  });

  it("AC-13: one company's skip records and members do not show in another company's status", async () => {
    await put(SETUP_PROGRESS_KEY, registry.setting(SETUP_PROGRESS_KEY).schema, {
      users: { state: 'skipped', at: AT, reason: 'A 社の理由' },
    });
    await member('setup-iso-a@example.com', ['accounting']);
    const a = await run((ctx) => activeCompanyMemberCount(ctx));
    const b = await run((ctx) => activeCompanyMemberCount(ctx), { companyId: other });
    expect(a).toBeGreaterThanOrEqual(2);
    // Only the creator (the tenant admin) belongs to the new company.
    expect(b).toBe(1);
    const sb = await status({ companyId: other });
    expect(sb.progress).toEqual({});
    expect(step(sb, 'users')).toMatchObject({ status: 'todo' });
    expect(step(sb, 'users').reason).toBeUndefined();
    const sa = await status();
    expect(step(sa, 'users').reason).toBe('A 社の理由');
    await owner(`update companies set settings = settings - 'setup.progress' where id = '${db.companyId}'`);
  });

  it('AC-13: a member who is not a tenant admin cannot select a company without a membership', async () => {
    await member('setup-iso-admin@example.com', ['admin']);
    const headers = { ...(await bearer('setup-iso-admin@example.com', 'setup-member-pass')), 'x-company-id': other };
    const r = await app.inject({ method: 'GET', url: '/meta/setup-status', headers });
    expect(r.statusCode).toBe(403);
  });

  it('AC-22: an inactive (invited, not accepted) user with a membership is not counted', async () => {
    const before = await run((ctx) => activeCompanyMemberCount(ctx), { companyId: other });
    const userId = await member('setup-invited@example.com', ['sales'], other);
    expect(await run((ctx) => activeCompanyMemberCount(ctx), { companyId: other })).toBe(before + 1);
    await owner(`update users set active = false, password_hash = null where id = '${userId}'`);
    expect(await run((ctx) => activeCompanyMemberCount(ctx), { companyId: other })).toBe(before);
  });

  it('AC-13: activeCompanyMemberCount refuses non-admin and store-limited contexts and needs a company', async () => {
    await expect(run((ctx) => activeCompanyMemberCount(ctx), { roles: ['settings'] })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(
      run((ctx) => activeCompanyMemberCount(ctx), { accessScope: 'stores', storeIds: [] }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run((ctx) => activeCompanyMemberCount(ctx), { companyId: null })).rejects.toBeInstanceOf(NotFound);
  });
});
