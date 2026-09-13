import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditTrail } from '../src/audit.ts';
import { bootstrapTenant } from '../src/auth.ts';
import { withContext } from '../src/db/client.ts';
import { Decimal } from '../src/decimal.ts';
import { Conflict, NotFound, PermissionDenied, ValidationError } from '../src/errors.ts';
import { newId } from '../src/ids.ts';
import { repo } from '../src/repository/repository.ts';
import { TPartner } from './fixtures/entities.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

let db: TestDb;

/** Drizzle wraps PostgreSQL errors; the useful message is on `cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'no error';
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return `${err.message} ${err.cause?.message ?? ''}`;
  }
}

beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

describe('Repository (ADR-0007) — CRUD, validation, audit', () => {
  it('AC-1 creates with defaults, system fields and Decimal conversion; audit row written', async () => {
    const created = await db.run({}, async (ctx) => repo(ctx, TPartner).create({ name: '  ACME  ', creditLimit: '1000.5', code: 'A001' }));
    expect(created.name).toBe('ACME'); // before_validate hook trimmed it
    expect(created.kind).toBe('customer');
    expect(created.isActive).toBe(true);
    expect(created.creditLimit).toBeInstanceOf(Decimal);
    expect(created.creditLimit?.toString()).toBe('1000.5');
    expect(created.version).toBe(1);
    expect(created.companyId).toBe(db.companyId);
    expect(created.createdBy).toBe(db.adminUserId);
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'test_partner', created.id));
    expect(trail).toHaveLength(1);
    expect(trail[0]?.op).toBe('create');
    expect(trail[0]?.actorId).toBe(db.adminUserId);
  });

  it('AC-2 rejects invalid input with field-level issues', async () => {
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'x'.repeat(101) }))).rejects.toBeInstanceOf(ValidationError);
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'ok', kind: 'nope' as never }))).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('AC-3 update bumps version, records only changed fields, enforces optimistic lock and immutability', async () => {
    const p = await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Beta', code: 'B001' }));
    const u = await db.run({}, (ctx) => repo(ctx, TPartner).update(p.id, { creditLimit: '5' }, { expectedVersion: 1 }));
    expect(u.version).toBe(2);
    expect(u.creditLimit?.toString()).toBe('5');
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).update(p.id, { name: 'Gamma' }, { expectedVersion: 1 }))).rejects.toBeInstanceOf(Conflict);
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).update(p.id, { code: 'B002' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'code' }] } });
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'test_partner', p.id));
    const upd = trail.find((t) => t.op === 'update');
    expect(upd?.before).toEqual({ creditLimit: null });
    expect(upd?.after).toEqual({ creditLimit: '5.000000' });
  });

  it('AC-4 list supports where/search/orderBy/paging and total', async () => {
    await db.run({}, async (ctx) => {
      const r = repo(ctx, TPartner);
      await r.create({ name: 'Delta Supplies', kind: 'supplier', nameKana: 'デルタ' });
      await r.create({ name: 'Epsilon', kind: 'both' });
    });
    const suppliers = await db.run({}, (ctx) => repo(ctx, TPartner).list({ where: { kind: { $in: ['supplier', 'both'] } }, orderBy: [{ field: 'name', dir: 'asc' }] }));
    expect(suppliers.items.map((i) => i.name)).toEqual(['Delta Supplies', 'Epsilon']);
    expect(suppliers.total).toBe(2);
    const searched = await db.run({}, (ctx) => repo(ctx, TPartner).list({ search: 'ﾃﾞﾙﾀ' }));
    expect(searched.items.map((i) => i.name)).toEqual(['Delta Supplies']);
    const page = await db.run({}, (ctx) => repo(ctx, TPartner).list({ limit: 1, offset: 1, orderBy: [{ field: 'name', dir: 'asc' }] }));
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(4);
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).list({ where: { nope: 1 } }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-5 delete removes and audits; get on missing id -> NotFound', async () => {
    const p = await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Temp' }));
    await db.run({}, (ctx) => repo(ctx, TPartner).delete(p.id));
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).get(p.id))).rejects.toBeInstanceOf(NotFound);
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'test_partner', p.id));
    expect(trail.map((t) => t.op)).toEqual(['delete', 'create']);
  });

  it('breaks tied sort values with id so successive pages equal the full ordered result', async () => {
    const fixed = new Date('2026-09-01T00:00:00Z');
    await db.run({ now: () => fixed }, async (ctx) => {
      for (let index = 0; index < 12; index++) await repo(ctx, TPartner).create({ name: 'Paging ties', code: `TIE-${index}` });
    });
    for (const orderBy of [undefined, [{ field: 'name', dir: 'asc' as const }], [{ field: 'id', dir: 'desc' as const }]]) {
      await db.run({}, async (ctx) => {
        const query = { where: { name: 'Paging ties' }, ...(orderBy ? { orderBy } : {}) };
        const full = await repo(ctx, TPartner).list({ ...query, limit: 12 });
        const first = await repo(ctx, TPartner).list({ ...query, limit: 5 });
        const second = await repo(ctx, TPartner).list({ ...query, limit: 5, offset: 5 });
        const third = await repo(ctx, TPartner).list({ ...query, limit: 5, offset: 10 });
        const ids = full.items.map((row) => row.id);
        expect([...first.items, ...second.items, ...third.items].map((row) => row.id)).toEqual(ids);
        expect(ids).toEqual(orderBy?.[0]?.field === 'id' ? [...ids].sort().reverse() : [...ids].sort());
      });
    }
  });
});

describe('Permissions (ADR-0007) — default deny, row rules, field groups', () => {
  const salesUser = newId();
  const otherUser = newId();
  let mine: string;
  let theirs: string;
  let unowned: string;

  beforeAll(async () => {
    const rows = await db.run({}, async (ctx) => {
      const r = repo(ctx, TPartner);
      return Promise.all([
        r.create({ name: 'Mine', ownerId: salesUser, secretNote: 'top secret' }),
        r.create({ name: 'Theirs', ownerId: otherUser }),
        r.create({ name: 'Unowned' }),
      ]);
    });
    [mine, theirs, unowned] = rows.map((r) => r.id) as [string, string, string];
  });

  it('AC-6 a role without the op is denied; unknown role is denied', async () => {
    await expect(db.run({ roles: ['viewer'], actor: { type: 'user', id: salesUser } }, (ctx) => repo(ctx, TPartner).create({ name: 'x' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run({ roles: ['nobody'], actor: { type: 'user', id: salesUser } }, (ctx) => repo(ctx, TPartner).list())).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-7 row rules restrict sales to own/unowned rows; NotFound (not Forbidden) for invisible rows', async () => {
    const names = await db.run({ roles: ['sales'], actor: { type: 'user', id: salesUser } }, async (ctx) => (await repo(ctx, TPartner).list({ where: { name: { $in: ['Mine', 'Theirs', 'Unowned'] } } })).items.map((i) => i.name).sort());
    expect(names).toEqual(['Mine', 'Unowned']);
    await expect(db.run({ roles: ['sales'], actor: { type: 'user', id: salesUser } }, (ctx) => repo(ctx, TPartner).get(theirs))).rejects.toBeInstanceOf(NotFound);
    await expect(db.run({ roles: ['sales'], actor: { type: 'user', id: salesUser } }, (ctx) => repo(ctx, TPartner).update(theirs, { name: 'hijack' }))).rejects.toBeInstanceOf(NotFound);
    // a user holding an unrestricted role is not filtered
    const all = await db.run({ roles: ['sales', 'viewer'], actor: { type: 'user', id: salesUser } }, async (ctx) => (await repo(ctx, TPartner).list({ where: { name: { $in: ['Mine', 'Theirs', 'Unowned'] } } })).total);
    expect(all).toBe(3);
    expect(unowned).toBeTruthy();
  });

  it('AC-8 field groups mask reads and block writes for roles outside the group', async () => {
    const row = await db.run({ roles: ['sales'], actor: { type: 'user', id: salesUser } }, (ctx) => repo(ctx, TPartner).get(mine));
    expect('secretNote' in row).toBe(false);
    await expect(db.run({ roles: ['sales'], actor: { type: 'user', id: salesUser } }, (ctx) => repo(ctx, TPartner).update(mine, { secretNote: 'x' }))).rejects.toBeInstanceOf(PermissionDenied);
    const asManager = await db.run({ roles: ['manager'] }, (ctx) => repo(ctx, TPartner).get(mine));
    expect(asManager.secretNote).toBe('top secret');
  });

  it('AC-9 agent actor acts on behalf of a user for row rules and audit', async () => {
    const created = await db.run({ roles: ['sales'], actor: { type: 'agent', id: 'claude-1', onBehalfOf: salesUser } }, (ctx) => repo(ctx, TPartner).create({ name: 'ByAgent', ownerId: salesUser }));
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'test_partner', created.id));
    expect(trail[0]).toMatchObject({ actorType: 'agent', actorId: 'claude-1', onBehalfOf: salesUser });
    expect(created.createdBy).toBe(salesUser);
  });
});

describe('Tenant isolation (ADR-0004) — RLS with the app role', () => {
  it('AC-10 a second tenant cannot see or update the first tenant’s rows, even with admin role', async () => {
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Other',
      companyCode: 'O1',
      companyName: 'Other Co',
      adminEmail: 'other@example.com',
      adminName: 'Other',
      adminPassword: 'pw',
    });
    const mineCount = await db.run({}, (ctx) => repo(ctx, TPartner).count());
    expect(mineCount).toBeGreaterThan(0);
    const otherCount = await withContext(db.app, { tenantId: other.tenantId, companyId: other.companyId, actor: { type: 'user', id: other.userId }, roles: ['admin'] }, (ctx) => repo(ctx, TPartner).count());
    expect(otherCount).toBe(0);
    // Raw SQL through the app connection is also filtered by RLS (defence in depth beyond the repository).
    const raw = await withContext(db.app, { tenantId: other.tenantId, companyId: other.companyId, actor: { type: 'user', id: other.userId }, roles: ['admin'] }, async (ctx) => {
      const rows = await ctx.db.execute(sql`select count(*)::int as n from test_partner`);
      return (rows as unknown as Array<{ n: number }>)[0]?.n ?? (rows as { rows?: Array<{ n: number }> }).rows?.[0]?.n;
    });
    expect(raw).toBe(0);
    // Inserting a row for another tenant is rejected by the policy's WITH CHECK.
    const smuggle = withContext(db.app, { tenantId: other.tenantId, companyId: other.companyId, actor: { type: 'user', id: other.userId }, roles: ['admin'] }, (ctx) =>
      ctx.db.execute(sql`insert into test_partner (id, tenant_id, company_id, name, kind, is_active) values (${newId()}, ${db.tenantId}, ${db.companyId}, 'smuggled', 'customer', true)`),
    );
    expect(await pgError(smuggle)).toMatch(/row-level security/);
  });

  it('AC-11 audit_log is append-only even for the owner role', async () => {
    expect(await pgError(db.owner.drizzle.execute(sql`delete from audit_log`))).toMatch(/append-only/);
  });
});
