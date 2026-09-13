import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authorizedCompanies,
  bootstrapTenant,
  defineEntity,
  defineWriteCapability,
  f,
  hasWriteCapability,
  label,
  newId,
  repo,
  withAuthorizedCompany,
  withWriteCapability,
} from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

const Record = defineEntity({
  name: 'group_port_record',
  label: label('資料', 'Record'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles: { reader: ['read'], writer: ['read', 'create'] } },
});
const capability = defineWriteCapability({ name: 'group-port-test', entity: Record.name, operations: ['create'] });
let db: TestDb;
let other: string;
let userId: string;
let foreign: string;
const asUser = () => ({ actor: { type: 'user' as const, id: userId }, roles: ['admin'], sessionVersion: 1 });
beforeAll(async () => {
  db = await freshDb();
  other = newId();
  userId = newId();
  await db.owner
    .sql`insert into companies (id, tenant_id, code, name) values (${other}, ${db.tenantId}, 'T2', 'Second company')`;
  await db.owner
    .sql`insert into users (id, tenant_id, name, email, tenant_admin) values (${userId}, ${db.tenantId}, 'Member', 'member@example.invalid', false)`;
  await db.owner
    .sql`insert into user_company_memberships (tenant_id, user_id, company_id, roles) values (${db.tenantId}, ${userId}, ${db.companyId}, '["writer"]'), (${db.tenantId}, ${userId}, ${other}, '["reader"]')`;
  foreign = (
    await bootstrapTenant(db.owner, {
      tenantName: 'Other',
      companyName: 'Other tenant',
      companyCode: 'X',
      adminEmail: 'x@example.invalid',
      adminName: 'X',
      adminPassword: 'test-only-password',
    })
  ).companyId;
  await db.run({ companyId: other }, (ctx) => repo(ctx, Record).create({ name: 'Other record' }));
});
afterAll(async () => {
  await db.close();
});

describe('company authorization port', () => {
  it('reloads target roles and keeps the transaction, actor, clock and audit request', async () => {
    await db.run(asUser(), async (ctx) => {
      expect((await authorizedCompanies(ctx)).map((row) => row.code)).toEqual(['T1', 'T2']);
      await withWriteCapability(ctx, capability, (granted) =>
        withAuthorizedCompany(granted, other, async (child) => {
          expect(hasWriteCapability(granted, Record.name, 'create')).toBe(true);
          expect(child.roles).toEqual(['reader']);
          expect(child.db).toBe(ctx.db);
          expect(child.actor).toEqual(ctx.actor);
          expect(child.requestId).toBe(ctx.requestId);
          expect(child.now).toBe(ctx.now);
          expect(child.sessionVersion).toBe(1);
          expect(hasWriteCapability(child, Record.name, 'create')).toBe(false);
          expect((await repo(child, Record).list()).items.map((row) => row.name)).toEqual(['Other record']);
          await expect(repo(child, Record).create({ name: 'Forbidden' })).rejects.toMatchObject({
            code: 'PERMISSION_DENIED',
          });
        }),
      );
    });
  });
  it('rejects other tenants, invalid identity, scoped callers and unbound system or agent actors', async () => {
    await expect(
      db.run(asUser(), (ctx) => withAuthorizedCompany(ctx, foreign, async () => true)),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run(asUser(), (ctx) => withAuthorizedCompany(ctx, 'invalid', async () => true)),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    for (const actor of [
      { type: 'system' as const, id: 'system' },
      { type: 'agent' as const, id: 'assistant' },
      { type: 'user' as const, id: newId() },
    ]) {
      await expect(db.run({ actor }, authorizedCompanies)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
    await expect(
      db.run({ ...asUser(), accessScope: 'sites', siteIds: [newId()] }, authorizedCompanies),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await db.run({ ...asUser(), actor: { type: 'agent', id: 'assistant', onBehalfOf: userId } }, (ctx) =>
      withAuthorizedCompany(ctx, other, async (child) => {
        expect(child.actor.onBehalfOf).toBe(userId);
        expect(child.roles).toEqual(['reader']);
      }),
    );
  });
  it('uses live membership and excludes limited company access', async () => {
    await db.owner
      .sql`update user_company_memberships set roles = '["writer"]' where user_id = ${userId} and company_id = ${other}`;
    await db.run(asUser(), (ctx) =>
      withAuthorizedCompany(ctx, other, async (child) => {
        expect(child.roles).toEqual(['writer']);
      }),
    );
    await db.owner
      .sql`update user_company_memberships set access_scope = 'stores', store_ids = ${JSON.stringify([newId()])}::jsonb where user_id = ${userId} and company_id = ${other}`;
    await db.run(asUser(), async (ctx) => {
      expect((await authorizedCompanies(ctx)).map((row) => row.id)).toEqual([db.companyId]);
    });
    await expect(db.run(asUser(), (ctx) => withAuthorizedCompany(ctx, other, async () => true))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await db.owner.sql`delete from user_company_memberships where user_id = ${userId} and company_id = ${other}`;
    await expect(db.run(asUser(), (ctx) => withAuthorizedCompany(ctx, other, async () => true))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
  it('requires the current MFA state even when a copied password-only Context has a valid session generation', async () => {
    await db.owner.sql`update users set mfa_enabled = true where id = ${userId}`;
    await expect(db.run(asUser(), authorizedCompanies)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await db.run({ ...asUser(), mfaVerified: true }, (ctx) =>
      withAuthorizedCompany(ctx, db.companyId, async (child) => {
        expect(child.mfaVerified).toBe(true);
      }),
    );
    await db.owner.sql`update users set mfa_enabled = false where id = ${userId}`;
  });
  it('rejects inactive users and stale sessions despite a copied admin role', async () => {
    await db.owner.sql`update users set session_version = 2 where id = ${userId}`;
    await expect(db.run(asUser(), authorizedCompanies)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await db.owner.sql`update users set session_version = 1, active = false where id = ${userId}`;
    await expect(db.run(asUser(), authorizedCompanies)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await db.owner.sql`update users set active = true where id = ${userId}`;
  });
  it('loads current tenant administrator and rolls child writes back with the parent', async () => {
    await db.run({ tenantAdmin: false, roles: [] }, async (ctx) => {
      expect((await authorizedCompanies(ctx)).map((row) => row.id)).toContain(other);
    });
    await expect(
      db.run({}, (ctx) =>
        withAuthorizedCompany(ctx, other, async (child) => {
          await repo(child, Record).create({ name: 'Rolled back' });
          throw new Error('rollback parent');
        }),
      ),
    ).rejects.toThrow('rollback parent');
    await db.run({ companyId: other }, async (ctx) => {
      expect((await repo(ctx, Record).list()).items.map((row) => row.name)).toEqual(['Other record']);
    });
  });
});
