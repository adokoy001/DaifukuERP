// docs/specs/company-admin.md AC-1..AC-6, AC-10: createCompany / updateCompany / listCompanies on the app-role
// connection (RLS enforced) with probe modules whose seeds record the Context they ran in.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLog,
  bootstrapTenant,
  COMPANY_PROFILE_KEY,
  companies,
  companyMemberships,
  companyProfileOf,
  companyProfileSchema,
  createCompany,
  defineEntity,
  defineModule,
  ensureCompanyProfileSetting,
  f,
  getCompanyProfile,
  hashPassword,
  label,
  listCompanies,
  newId,
  PermissionDenied,
  registry,
  repo,
  setSetting,
  settingShape,
  StateError,
  updateCompany,
  users,
  ValidationError,
  withContext,
  type Context,
  type ContextParams,
  type ModuleDef,
} from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

const Item = defineEntity({
  name: 'company_admin_item',
  label: label('初期データ', 'Seeded item'),
  fields: { code: f.text({ required: true }), note: f.text() },
  permissions: { roles: { viewer: ['read'] } },
});
const seedRuns: { companyId: string | null; actor: string; roles: readonly string[] }[] = [];
const probe = defineModule({
  name: 'company_admin_probe',
  label: label('検査', 'Probe'),
  depends: [],
  entities: [Item],
  // Idempotent like every module seed: one item per company.
  seed: async (ctx: Context) => {
    seedRuns.push({ companyId: ctx.companyId, actor: ctx.actor.type, roles: ctx.roles });
    if ((await repo(ctx, Item).count({ code: 'SEED' })) === 0) await repo(ctx, Item).create({ code: 'SEED' });
  },
});
const failing: ModuleDef = {
  kind: 'module',
  name: 'company_admin_failing',
  label: label('失敗', 'Failing'),
  depends: [],
  entities: [],
  seed: async () => {
    throw new Error('synthetic seed failure');
  },
};

let db: TestDb;
let plainAdmin: string;
let inactiveAdmin: string;
let otherTenant: { tenantId: string; companyId: string; userId: string };

async function addUser(email: string, opts: { tenantAdmin: boolean; active?: boolean }): Promise<string> {
  const id = newId();
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: db.tenantId,
    email,
    name: email,
    passwordHash: await hashPassword('password'),
    tenantAdmin: opts.tenantAdmin,
    active: opts.active ?? true,
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, userId: id, companyId: db.companyId, roles: ['admin'] });
  return id;
}
const asUser = (userId: string, extra: Partial<ContextParams> = {}): Partial<ContextParams> => ({
  actor: { type: 'user', id: userId },
  ...extra,
});
async function companyCount(tenantId = db.tenantId): Promise<number> {
  return (await db.owner.drizzle.select().from(companies).where(eq(companies.tenantId, tenantId))).length;
}

beforeAll(async () => {
  db = await freshDb();
  ensureCompanyProfileSetting();
  plainAdmin = await addUser('company-admin-plain@example.com', { tenantAdmin: false });
  inactiveAdmin = await addUser('company-admin-inactive@example.com', { tenantAdmin: true, active: false });
  otherTenant = await bootstrapTenant(db.owner, {
    tenantName: 'Other tenant',
    companyCode: 'OTHER',
    companyName: '別テナント株式会社',
    adminEmail: 'other-admin@example.com',
    adminName: 'Other',
    adminPassword: 'password',
  });
});
afterAll(async () => {
  await db?.close();
});

describe('company-admin AC-1: createCompany', () => {
  it('AC-1: a tenant administrator creates the company, an admin membership, the seeds and the audit in one call', async () => {
    seedRuns.length = 0;
    const created = await db.run({}, (ctx) =>
      createCompany(ctx, { code: 'NEW-1', name: '新会社株式会社' }, { modules: [probe] }),
    );
    expect(created).toMatchObject({ code: 'NEW-1', name: '新会社株式会社', country: 'JP', currency: 'JPY' });
    expect(created.seededModules).toEqual(['company_admin_probe']);
    // The seed ran once, for the new company, in a system Context with the admin role.
    expect(seedRuns).toEqual([{ companyId: created.id, actor: 'system', roles: ['admin'] }]);
    const [membership] = await db.owner.drizzle
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, created.id), eq(companyMemberships.userId, db.adminUserId)));
    expect(membership).toMatchObject({ tenantId: db.tenantId, roles: ['admin'], accessScope: 'all' });
    const seeded = await db.run({ companyId: created.id }, (ctx) => repo(ctx, Item).list());
    expect(seeded.items.map((i) => i.code)).toEqual(['SEED']);
    const audit = await db.owner.drizzle.select().from(auditLog).where(eq(auditLog.companyId, created.id));
    const companyAudit = audit.find((a) => a.entity === 'company');
    expect(companyAudit).toMatchObject({ op: 'create', actorType: 'user', actorId: db.adminUserId, before: null });
    expect(companyAudit?.after).toMatchObject({ code: 'NEW-1', name: '新会社株式会社' });
    expect(audit.find((a) => a.entity === 'company_membership')).toMatchObject({
      op: 'create',
      recordId: db.adminUserId,
    });
    // The seed's own writes are audited as the system actor of the new company.
    expect(audit.some((a) => a.entity === Item.name && a.actorType === 'system')).toBe(true);
  });

  it('AC-1: country and currency can be given; the default seed list is every registered module', async () => {
    seedRuns.length = 0;
    const created = await db.run({}, (ctx) =>
      createCompany(ctx, { code: 'US_1', name: 'US Branch', country: 'US', currency: 'USD' }),
    );
    expect(created).toMatchObject({ country: 'US', currency: 'USD' });
    expect(created.seededModules).toEqual(
      registry
        .allModules()
        .filter((m) => m.seed)
        .map((m) => m.name),
    );
    expect(seedRuns.map((r) => r.companyId)).toEqual([created.id]);
  });
});

describe('company-admin AC-2: only an active tenant administrator', () => {
  it.each([
    ['a company admin who is not a tenant administrator', () => asUser(plainAdmin)],
    ['an inactive tenant administrator', () => asUser(inactiveAdmin)],
    ['a store-scoped context of the tenant administrator', () => ({ accessScope: 'stores' as const, storeIds: [] })],
  ])('AC-2: %s cannot create, edit or list companies', async (_name, params) => {
    const before = await companyCount();
    await expect(
      db.run(params(), (ctx) => createCompany(ctx, { code: 'DENIED', name: 'x' }, { modules: [probe] })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run(params(), (ctx) => updateCompany(ctx, db.companyId, { name: 'x' }))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(db.run(params(), (ctx) => listCompanies(ctx))).rejects.toBeInstanceOf(PermissionDenied);
    expect(await companyCount()).toBe(before);
  });
});

describe('company-admin AC-3: code validation', () => {
  it.each([
    [{ code: 'T1', name: 'dup' }, 'code'],
    [{ code: 'lower', name: 'x' }, 'code'],
    [{ code: 'A'.repeat(21), name: 'x' }, 'code'],
    [{ code: 'SP ACE', name: 'x' }, 'code'],
    [{ code: 'OK', name: '  ' }, 'name'],
    [{ code: 'OK', name: 'x', country: 'jpn' }, 'country'],
    [{ code: 'OK', name: 'x', currency: 'yen' }, 'currency'],
    [{ code: 'OK', name: 'x', extra: true }, ''],
  ])('AC-3: %j is refused with a validation issue on %j and nothing is created', async (input, path) => {
    const before = await companyCount();
    const error = await db.run({}, (ctx) => createCompany(ctx, input, { modules: [probe] })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    const issues = (error as ValidationError).details?.issues as { path: string }[];
    expect(issues.map((i) => i.path)).toContain(path);
    expect(await companyCount()).toBe(before);
  });
});

describe('company-admin AC-4: updateCompany', () => {
  it('AC-4: renames and changes the country with the before / after audit', async () => {
    const created = await db.run({}, (ctx) => createCompany(ctx, { code: 'REN', name: '旧名' }, { modules: [] }));
    const updated = await db.run({}, (ctx) => updateCompany(ctx, created.id, { name: '新名', country: 'US' }));
    expect(updated).toMatchObject({ id: created.id, code: 'REN', name: '新名', country: 'US', currency: 'JPY' });
    const [audit] = await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.recordId, created.id), eq(auditLog.entity, 'company'), eq(auditLog.op, 'update')));
    expect(audit?.before).toMatchObject({ name: '旧名', country: 'JP' });
    expect(audit?.after).toMatchObject({ name: '新名', country: 'US' });
  });

  it('AC-4: code and currency are immutable after creation', async () => {
    for (const body of [{ code: 'NEWCODE' }, { currency: 'USD' }, { name: 'x', code: 'T1' }]) {
      const error = await db.run({}, (ctx) => updateCompany(ctx, db.companyId, body)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
    }
    const [row] = await db.owner.drizzle.select().from(companies).where(eq(companies.id, db.companyId));
    expect(row).toMatchObject({ code: 'T1', currency: 'JPY', name: 'テスト株式会社' });
  });
});

describe('company-admin AC-5: listCompanies', () => {
  it('AC-5: lists every company of the tenant with whether the caller is a member', async () => {
    const list = await db.run({}, listCompanies);
    const codes = list.items.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
    expect(codes).toEqual(expect.arrayContaining(['T1', 'NEW-1', 'US_1', 'REN']));
    expect(codes).not.toContain('OTHER');
    expect(list.items.every((c) => c.member)).toBe(true);
    // A company created through the owner (like setup's industry demos) has no membership for the caller.
    await db.owner.drizzle
      .insert(companies)
      .values({ id: newId(), tenantId: db.tenantId, code: 'NOMEMBER', name: '所属なし' });
    const again = await db.run({}, listCompanies);
    expect(again.items.find((c) => c.code === 'NOMEMBER')).toMatchObject({ member: false, currency: 'JPY' });
    expect(again.items[0]).toHaveProperty('createdAt');
  });
});

describe('company-admin AC-10: a failing seed rolls everything back', () => {
  it('AC-10: no company, membership, audit or earlier seed data remains, and the cause names the module', async () => {
    const before = await companyCount();
    const auditBefore = (await db.owner.drizzle.select().from(auditLog)).length;
    const itemsBefore = (await db.owner.sql`select count(*)::int as n from company_admin_item`)[0]?.n as number;
    const error = await db
      .run({}, (ctx) => createCompany(ctx, { code: 'ROLLBACK', name: '失敗' }, { modules: [probe, failing] }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toContain('company_admin_failing');
    expect((error as StateError).message).toContain('synthetic seed failure');
    expect((error as StateError).details).toMatchObject({ module: 'company_admin_failing' });
    expect(await companyCount()).toBe(before);
    expect((await db.owner.drizzle.select().from(auditLog)).length).toBe(auditBefore);
    expect((await db.owner.sql`select count(*)::int as n from company_admin_item`)[0]?.n).toBe(itemsBefore);
    const rows = await db.owner.drizzle.select().from(companies).where(eq(companies.code, 'ROLLBACK'));
    expect(rows).toEqual([]);
  });
});

describe('company-admin: RLS and tenant isolation', () => {
  it('the app-role insert stays in the caller tenant; another tenant neither sees nor edits the company', async () => {
    const created = await db.run({}, (ctx) => createCompany(ctx, { code: 'ISO', name: '分離' }, { modules: [probe] }));
    const other = (p: Partial<ContextParams>, fn: (ctx: Context) => Promise<unknown>) =>
      withContext(
        db.app,
        {
          tenantId: otherTenant.tenantId,
          companyId: otherTenant.companyId,
          actor: { type: 'user', id: otherTenant.userId },
          roles: ['admin'],
          ...p,
        },
        fn,
      );
    const theirs = (await other({}, listCompanies)) as { items: { code: string }[] };
    expect(theirs.items.map((c) => c.code)).toEqual(['OTHER']);
    await expect(other({}, (ctx) => updateCompany(ctx, created.id, { name: '乗っ取り' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Same code in another tenant is allowed (codes are unique per tenant).
    const same = (await other({}, (ctx) =>
      createCompany(ctx, { code: 'ISO', name: '同じコード' }, { modules: [] }),
    )) as {
      id: string;
    };
    const [row] = await db.owner.drizzle.select().from(companies).where(eq(companies.id, same.id));
    expect(row?.tenantId).toBe(otherTenant.tenantId);
    // RLS itself: with the other tenant set, the app role cannot read or insert a row of this tenant.
    await expect(
      other({}, (ctx) =>
        ctx.db.insert(companies).values({ id: newId(), tenantId: db.tenantId, code: 'SNEAK', name: 'x' }),
      ),
    ).rejects.toThrow();
    const visible = (await other({}, (ctx) =>
      ctx.db.select().from(companies).where(eq(companies.id, created.id)),
    )) as unknown[];
    expect(visible).toEqual([]);
  });
});

describe('company-admin AC-6: company.profile', () => {
  it('AC-6: is a company-category setting with ja/en labels for every property', () => {
    const def = registry.setting(COMPANY_PROFILE_KEY);
    expect(def.category).toBe('company');
    const shape = settingShape(def.schema);
    expect(shape.kind).toBe('object');
    const names = shape.kind === 'object' ? Object.keys(shape.properties) : [];
    expect(names).toEqual([
      'legalName',
      'postalCode',
      'address',
      'phone',
      'email',
      'invoiceRegistrationNo',
      'taxStatus',
      'fiscalYearEndMonth',
      'representative',
    ]);
    for (const name of names) {
      expect(def.fields?.[name]?.label.ja, name).toBeTruthy();
      expect(def.fields?.[name]?.label.en, name).toBeTruthy();
    }
    expect(Object.keys(def.fields?.taxStatus?.valueLabels ?? {})).toEqual(['taxable', 'exempt']);
  });

  it.each([
    [{ invoiceRegistrationNo: 'T1234567890123' }, true],
    [{ invoiceRegistrationNo: '1234567890123' }, false],
    [{ invoiceRegistrationNo: 'T123456789012' }, false],
    [{ invoiceRegistrationNo: 'T12345678901234' }, false],
    [{ taxStatus: 'exempt', invoiceRegistrationNo: 'T1234567890123' }, false],
    [{ taxStatus: 'exempt' }, true],
    [{ fiscalYearEndMonth: 3 }, true],
    [{ fiscalYearEndMonth: 13 }, false],
    [{ fiscalYearEndMonth: 0 }, false],
    [{ email: 'not-an-email' }, false],
  ])('AC-6: %j valid=%s', (value, valid) => {
    expect(companyProfileSchema.safeParse(value).success).toBe(valid);
  });

  it('AC-6: saved through setSetting with the registration number checked; read back by getCompanyProfile', async () => {
    const profile = {
      legalName: '株式会社テスト',
      invoiceRegistrationNo: 'T1234567890123',
      taxStatus: 'taxable',
      fiscalYearEndMonth: 3,
      representative: '代表 太郎',
    };
    await db.run({}, (ctx) => setSetting(ctx, COMPANY_PROFILE_KEY, companyProfileSchema, profile));
    expect(await db.run({}, getCompanyProfile)).toEqual(profile);
    await expect(
      db.run({}, (ctx) =>
        setSetting(ctx, COMPANY_PROFILE_KEY, companyProfileSchema, { invoiceRegistrationNo: 'X1234567890123' }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(companyProfileOf({ [COMPANY_PROFILE_KEY]: { fiscalYearEndMonth: 99 } })).toEqual({});
    expect(companyProfileOf({})).toEqual({});
  });
});
