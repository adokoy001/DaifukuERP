import { bootstrapTenant, newId } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_TENANT, findDemoIdentity } from '../src/db/demo-identity.ts';
import { resolvePackCompany } from '../src/db/pack-options.ts';
import { seedAll } from '../src/db/reset.ts';

let db: TestDb;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

describe('foundation-refresh exact demo identity', () => {
  it('never selects another tenant solely because the administrator email matches', async () => {
    expect(await findDemoIdentity(db.owner)).toBeNull();
    await expect(resolvePackCompany(db.owner, undefined)).rejects.toThrow('Demo company not found');
    expect(await resolvePackCompany(db.owner, db.companyId)).toEqual({ tenantId: db.tenantId, companyId: db.companyId });
    await expect(resolvePackCompany(db.owner, newId())).rejects.toThrow('not found');
  });

  it('uses DEMO even after the demo administrator changes their default company; reset uses the same identity', async () => {
    const demo = await bootstrapTenant(db.owner, DEMO_TENANT);
    const otherCompany = newId();
    await db.owner.sql`insert into companies (id,tenant_id,code,name,created_at) values (${otherCompany},${demo.tenantId},'AAA','Another company','2000-01-01')`;
    await db.owner.sql`update users set default_company_id=${otherCompany} where id=${demo.userId}`;
    expect(await findDemoIdentity(db.owner)).toEqual(demo);
    expect(await resolvePackCompany(db.owner, undefined)).toEqual({ tenantId: demo.tenantId, companyId: demo.companyId });
    const seeded = await seedAll(db.owner);
    expect(seeded).toMatchObject(demo);
    expect(await seedAll(db.owner)).toEqual(seeded);
    const rows = await db.owner.sql`select company_id,count(*)::int n from partner group by company_id`;
    expect(rows.find((row) => row.company_id === demo.companyId)?.n).toBe(3);
    expect(rows.find((row) => row.company_id === otherCompany)).toBeUndefined();
    expect(rows.find((row) => row.company_id === db.companyId)).toBeUndefined();
  });

  it('rejects duplicate demo identities before applying or seeding; explicit target still works', async () => {
    const first = await bootstrapTenant(db.owner, DEMO_TENANT);
    await bootstrapTenant(db.owner, DEMO_TENANT);
    await expect(findDemoIdentity(db.owner)).rejects.toThrow('Multiple demo identities');
    await expect(resolvePackCompany(db.owner, undefined)).rejects.toThrow('Multiple demo identities');
    await expect(seedAll(db.owner)).rejects.toThrow('Multiple demo identities');
    expect(await resolvePackCompany(db.owner, first.companyId)).toEqual({ tenantId: first.tenantId, companyId: first.companyId });
    const [rows] = await db.owner.sql`select count(*)::int n from partner`;
    expect(rows?.n).toBe(0);
  });
});
