// docs/specs/access-insight.md AC-9, AC-10, AC-12..AC-17 against Postgres with entities of this file: keyset pages
// across equal and microsecond-apart timestamps (no duplicates or gaps, a newer row added mid-search does not shift the
// pages), company / tenant / other-tenant isolation, an old row whose fields became outputHidden after it was written,
// rows of an unapplied pack entity excluded in SQL (full pages) and refused as a filter, an export_rows audit found
// with op=export and its masked criteria kept masked, the 409 without a company, nothing written by a search, and a
// former member offered as a user option and searchable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  auditLog,
  auditSearchOptions,
  companies,
  companyMemberships,
  defineEntity,
  definePack,
  f,
  label,
  newId,
  PermissionDenied,
  putCompanyMembership,
  registerCrudActions,
  registry,
  removeCompanyMembership,
  repo,
  runAction,
  searchAudit,
  users,
  type AuditSearchResult,
  type ContextParams,
} from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

const AsdItem = defineEntity({
  name: 'asd_item',
  label: label('監査検索の品目', 'Audit search item'),
  displayField: 'name',
  fields: {
    name: f.text({ required: true }),
    secret: f.text(),
    storageKey: f.text({ outputHidden: true }),
    legacyNote: f.text(),
  },
  permissions: {
    roles: { asd_clerk: ['read', 'create', 'update', 'export'] },
    fieldGroups: { restricted: { fields: ['secret'], roles: ['asd_hr'] } },
  },
});
// `legacyNote` became outputHidden after old rows were written: modelled by an ext key registered as hidden and a field
// whose old rows are inserted directly (the definition above is the "current" one for storageKey).
registry.registerExt(AsdItem.name, { token: f.text({ outputHidden: true }), tag: f.text() });
const AsdCrate = defineEntity({
  name: 'asd_crate',
  label: label('監査検索の箱', 'Audit search crate'),
  fields: { code: f.text({ required: true }) },
  permissions: { roles: { asd_clerk: ['read'] } },
});
definePack({
  name: 'asd_pack',
  label: label('監査検索パック', 'Audit search pack'),
  depends: [],
  entities: [AsdCrate],
});
registerCrudActions();

let db: TestDb;
let companyB: string;
let otherTenant: string;
let salesUser: string;
let companyAdmin: string;
let tenantAdmin2: string;
const OCT = (day: number, hour = 3) => new Date(Date.UTC(2026, 9, day, hour));
const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

const admin = (params: Partial<ContextParams> = {}) => ({ now: () => OCT(20), ...params });
const search = (query: Record<string, unknown>, params: Partial<ContextParams> = {}) =>
  db.run(admin(params), (ctx) => searchAudit(ctx, { ...PERIOD, ...query }));
async function allPages(query: Record<string, unknown>, params: Partial<ContextParams> = {}) {
  const pages: AuditSearchResult[] = [];
  let cursor: string | null = null;
  do {
    const page: AuditSearchResult = await search({ ...query, ...(cursor ? { cursor } : {}) }, params);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor && pages.length < 50);
  return pages;
}
const ownerAudit = (rows: Record<string, unknown>[]) =>
  db.owner.drizzle.insert(auditLog).values(
    rows.map((r) => ({
      id: newId(),
      tenantId: db.tenantId,
      companyId: db.companyId,
      entity: 'asd_item',
      recordId: newId(),
      op: 'update',
      actorType: 'user',
      actorId: db.adminUserId,
      at: OCT(10),
      ...r,
    })) as never,
  );
const count = async (table: string) =>
  Number((await db.owner.sql.unsafe(`select count(*)::int as n from ${table}`))[0]?.n ?? 0);

beforeAll(async () => {
  db = await freshDb();
  companyB = newId();
  otherTenant = newId();
  salesUser = newId();
  companyAdmin = newId();
  tenantAdmin2 = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'ASD-B', name: 'B 社' });
  await db.owner.drizzle.insert(users).values([
    { id: salesUser, tenantId: db.tenantId, email: 'asd-sales@example.com', name: '営業 花子' },
    { id: companyAdmin, tenantId: db.tenantId, email: 'asd-admin@example.com', name: '会社管理 太郎' },
    {
      id: tenantAdmin2,
      tenantId: db.tenantId,
      email: 'asd-tenant@example.com',
      name: 'テナント管理 次郎',
      tenantAdmin: true,
    },
  ]);
  await db.owner.drizzle.insert(companyMemberships).values({
    tenantId: db.tenantId,
    userId: companyAdmin,
    companyId: db.companyId,
    roles: ['admin'],
  });
  // The sales user joins company A, works there (also through an AI agent), then the membership is removed.
  await db.run(admin({ now: () => OCT(2) }), (ctx) =>
    putCompanyMembership(ctx, salesUser, db.companyId, {
      expectedVersion: 0,
      roles: ['asd_clerk'],
      accessScope: 'all',
      storeIds: [],
      siteIds: [],
    }),
  );
  await db.run({ actor: { type: 'user', id: salesUser }, roles: ['asd_clerk'], now: () => OCT(3) }, async (ctx) => {
    const item = await repo(ctx, AsdItem).create({ name: 'by sales' });
    await repo(ctx, AsdItem).update(item.id as string, { name: 'by sales (edited)' });
  });
  await db.run(
    { actor: { type: 'agent', id: 'claude-agent', onBehalfOf: salesUser }, roles: ['asd_clerk'], now: () => OCT(4) },
    (ctx) => repo(ctx, AsdItem).create({ name: 'by agent for sales' }),
  );
  await db.run(admin({ now: () => OCT(5) }), (ctx) =>
    removeCompanyMembership(ctx, salesUser, db.companyId, { expectedVersion: 1 }),
  );
  // Company B, the tenant scope and another tenant.
  await db.run(admin({ companyId: companyB, now: () => OCT(6) }), (ctx) => repo(ctx, AsdItem).create({ name: 'in B' }));
  await ownerAudit([
    { companyId: null, entity: 'access_user', recordId: salesUser, op: 'update', at: OCT(7) },
    { tenantId: otherTenant, entity: 'asd_item', op: 'create', at: OCT(7) },
  ]);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe('audit search scope and isolation (access-insight AC-10, AC-12)', () => {
  it('AC-12: the company scope returns only the current company rows of the tenant, never B or another tenant', async () => {
    const items = (await allPages({ limit: 100 })).flatMap((p) => p.items);
    expect(items.some((i) => i.after && (i.after as { name?: string }).name === 'in B')).toBe(false);
    expect(items.some((i) => i.entity === 'access_user')).toBe(false);
    expect(items.map((i) => i.entity)).toEqual(expect.arrayContaining(['asd_item', 'company_membership']));
    const inB = (await search({}, { companyId: companyB })).items;
    expect(inB.map((i) => (i.after as { name?: string }).name)).toEqual(['in B']);
    const rows = await db.owner.sql`select count(*)::int as n from audit_log where tenant_id = ${otherTenant}`;
    expect(rows[0]?.n).toBe(1);
  });

  it('AC-10: scope=tenant returns only company-less rows to a tenant administrator, also without a company', async () => {
    for (const companyId of [db.companyId, null]) {
      const { items } = await search({ scope: 'tenant' }, { companyId });
      expect(items.map((i) => [i.entity, i.recordId])).toEqual([['access_user', salesUser]]);
    }
  });

  it('AC-11/AC-12: a company administrator sees the company but is refused the tenant scope', async () => {
    const asCompanyAdmin = { actor: { type: 'user' as const, id: companyAdmin }, roles: ['admin'] };
    expect((await search({}, asCompanyAdmin)).items.length).toBeGreaterThan(0);
    await expect(search({ scope: 'tenant' }, asCompanyAdmin)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-15: the company scope without a company is a 409', async () => {
    await expect(search({}, { companyId: null })).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('audit search filters and users (access-insight AC-8, AC-17)', () => {
  it('AC-8: the user filter matches the actor or the person an agent acted for; names are resolved', async () => {
    const { items } = await search({ userId: salesUser });
    expect(items.map((i) => [i.op, i.actorType]).sort()).toEqual(
      [
        ['create', 'agent'],
        ['create', 'user'],
        ['update', 'user'],
      ].sort(),
    );
    const agent = items.find((i) => i.actorType === 'agent');
    expect(agent).toMatchObject({
      actorId: 'claude-agent',
      actorName: null,
      onBehalfOf: salesUser,
      onBehalfOfName: '営業 花子',
    });
    expect(items.find((i) => i.actorType === 'user')?.actorName).toBe('営業 花子');
    expect((await search({ userId: 'claude-agent' })).items).toHaveLength(1);
  });

  it('AC-8: entity, op, record id and the period narrow the result; newest first', async () => {
    const memberships = (await search({ entity: 'company_membership' })).items;
    expect(memberships.map((i) => i.op)).toEqual(['delete', 'create']);
    const recordId = memberships[0]?.recordId;
    expect((await search({ entity: 'company_membership', recordId, op: 'delete' })).items).toHaveLength(1);
    expect((await search({ from: '2026-10-03', to: '2026-10-03' })).items.map((i) => i.op).sort()).toEqual([
      'create',
      'update',
    ]);
  });

  it('AC-17: a removed member is offered as a former member (no e-mail in company scope) and can be searched', async () => {
    const options = await db.run(admin(), (ctx) => auditSearchOptions(ctx, { scope: 'company' }));
    expect(options.users.find((u) => u.id === salesUser)).toEqual({
      id: salesUser,
      name: '営業 花子',
      active: true,
      kind: 'former',
    });
    expect(options.users.find((u) => u.id === companyAdmin)?.kind).toBe('member');
    // A member who is also a tenant administrator is listed once, as a member.
    expect(options.users.find((u) => u.id === db.adminUserId)?.kind).toBe('member');
    expect(options.users.find((u) => u.id === tenantAdmin2)?.kind).toBe('tenant_admin');
    expect(new Set(options.users.map((u) => u.id)).size).toBe(options.users.length);
    expect(options.users.every((u) => !('email' in u))).toBe(true);
    expect(options.subjects.map((s) => s.name)).toEqual(expect.arrayContaining(['asd_item', 'company_settings']));
    expect(options.subjects.map((s) => s.name)).not.toContain('asd_crate');
    expect(options.subjects.map((s) => s.name)).not.toContain('access_user');
    const tenant = await db.run(admin(), (ctx) => auditSearchOptions(ctx, { scope: 'tenant' }));
    expect(tenant.users.find((u) => u.id === salesUser)).toMatchObject({
      email: 'asd-sales@example.com',
      kind: 'user',
    });
    expect(tenant.subjects.map((s) => s.name)).toEqual(['access_user', 'identity']);
  });
});

describe('audit search pages (access-insight AC-9, AC-13)', () => {
  it('AC-9: microsecond-apart and equal timestamps across page boundaries give no duplicates or gaps', async () => {
    const base = '2026-10-15 01:00:00.000';
    const rows = ['001', '002', '002', '002', '003', '000'].map((us, i) => ({
      entity: 'asd_page',
      recordId: newId(),
      at: sql`${`${base}${us}+00`}::timestamptz` as never,
      op: `page_${i}`,
    }));
    await ownerAudit(rows);
    const expected = (
      await db.owner.sql`select id from audit_log where entity = 'asd_page' order by at desc, id desc`
    ).map((r) => r.id as string);
    for (const limit of [1, 2, 4]) {
      const pages = await allPages({ entity: 'asd_page', limit });
      expect(
        pages.flatMap((p) => p.items.map((i) => i.id)),
        `limit ${limit}`,
      ).toEqual(expected);
      expect(pages.at(-1)?.nextCursor).toBeNull();
    }
    // A newer row appended between pages does not shift the pages already being read.
    const first = await search({ entity: 'asd_page', limit: 3 });
    await ownerAudit([{ entity: 'asd_page', recordId: newId(), at: OCT(16), op: 'page_late' }]);
    const second = await search({ entity: 'asd_page', limit: 3, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(expected);
  });

  it('AC-13: unreadable registry entities are excluded in SQL, so every page but the last is full, and refused as a filter', async () => {
    await ownerAudit(
      Array.from({ length: 5 }, (_, i) => ({ entity: 'asd_crate', op: 'create', at: OCT(18, i), recordId: newId() })),
    );
    await ownerAudit(
      Array.from({ length: 3 }, (_, i) => ({ entity: 'asd_item', op: 'mixed', at: OCT(18, i), recordId: newId() })),
    );
    const pages = await allPages({ from: '2026-10-18', to: '2026-10-18', limit: 2 });
    expect(pages.map((p) => p.items.length)).toEqual([2, 1]);
    expect(pages.flatMap((p) => p.items).every((i) => i.entity !== 'asd_crate')).toBe(true);
    await expect(search({ entity: 'asd_crate' })).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-13: an old row keeps no outputHidden field (ext included); unknown names are returned as stored', async () => {
    await ownerAudit([
      {
        op: 'legacy',
        at: OCT(19),
        before: { name: 'old', storageKey: 'sk-before', ext: { token: 't-before', tag: 'kept' } },
        after: { name: 'new', storageKey: 'sk-after', secret: 'admin-visible', ext: { token: 't-after' } },
      },
      { entity: 'not_in_registry', op: 'legacy', at: OCT(19), after: { storageKey: 'kept-as-stored' } },
    ]);
    const { items } = await search({ op: 'legacy' });
    const item = items.find((i) => i.entity === 'asd_item');
    expect(item?.before).toEqual({ name: 'old', ext: { tag: 'kept' } });
    // admin has no field-group mask (maskedFields is empty for admin), outputHidden is removed for everyone.
    expect(item?.after).toEqual({ name: 'new', secret: 'admin-visible', ext: {} });
    expect(JSON.stringify(items)).not.toMatch(/sk-before|sk-after|t-before|t-after/);
    expect(items.find((i) => i.entity === 'not_in_registry')?.after).toEqual({ storageKey: 'kept-as-stored' });
  });
});

describe('audit search exports and read-only use (access-insight AC-14, AC-16)', () => {
  it('AC-14: an export_rows audit is found with op=export and keeps the masked criteria', async () => {
    await db.run(admin({ now: () => OCT(21) }), (ctx) =>
      runAction(ctx, 'asd_item.export_rows', { where: { secret: 'needle' }, columns: ['name'] }),
    );
    const { items } = await search({ op: 'export' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ entity: 'asd_item', action: 'asd_item.export_rows', op: 'export' });
    const exported = (items[0]?.after as { export: Record<string, unknown> }).export;
    expect(exported).toMatchObject({ where: { secret: '[masked]' }, columns: ['name'], truncated: false });
    expect(JSON.stringify(items[0])).not.toContain('needle');
  });

  it('AC-16: a search writes nothing to the audit log or business tables', async () => {
    const before = [await count('audit_log'), await count('asd_item')];
    await search({ limit: 100 });
    await search({ scope: 'tenant' });
    await db.run(admin(), (ctx) => auditSearchOptions(ctx, {}));
    expect([await count('audit_log'), await count('asd_item')]).toEqual(before);
  });
});
