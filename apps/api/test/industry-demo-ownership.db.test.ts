import { bootstrapTenant, newId } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_TENANT } from '../src/db/demo-identity.ts';
import { INDUSTRY_DEMOS, INDUSTRY_DEMO_MARKER, prepareIndustryDemoCompanies } from '../src/db/industry-demos.ts';

let db: TestDb;
let demo: Awaited<ReturnType<typeof bootstrapTenant>>;
beforeEach(async () => { db = await freshDb(); demo = await bootstrapTenant(db.owner, DEMO_TENANT); });
afterEach(async () => { await db?.close(); });

describe('industry demo company ownership', () => {
  it('refuses an unmarked code collision before any company is created or seeded', async () => {
    const id = newId();
    await db.owner.sql`insert into companies (id,tenant_id,code,name,settings) values (${id},${demo.tenantId},'DEMO_FARM','Existing business','{"keep":"original"}'::jsonb)`;
    const before = await db.owner.sql`select id,name,settings from companies order by id`;
    await expect(prepareIndustryDemoCompanies(db.owner)).rejects.toThrow('not an owned farm demo');
    expect(await db.owner.sql`select id,name,settings from companies order by id`).toEqual(before);
    const [partners] = await db.owner.sql`select count(*)::int n from partner`;
    expect(partners?.n).toBe(0);
  });

  it('refuses an ownership marker for another pack without replacing settings', async () => {
    const id = newId();
    await db.owner.sql`insert into companies (id,tenant_id,code,name,settings) values (${id},${demo.tenantId},'DEMO_APPLIANCE','Wrong marked company','{"demo.industry":"farm","keep":"original"}'::jsonb)`;
    await expect(prepareIndustryDemoCompanies(db.owner)).rejects.toThrow('not an owned appliance_store demo');
    const [company] = await db.owner.sql`select settings from companies where id=${id}`;
    expect(company?.settings).toEqual({ 'demo.industry': 'farm', keep: 'original' });
    const [partners] = await db.owner.sql`select count(*)::int n from partner`;
    expect(partners?.n).toBe(0);
  });

  it('marks new demo companies, reuses only their identities, and preserves renamed display names', async () => {
    const created = await prepareIndustryDemoCompanies(db.owner);
    expect(created).toHaveLength(3);
    for (const item of created) {
      const [company] = await db.owner.sql`select settings from companies where id=${item.companyId}`;
      expect(company?.settings[INDUSTRY_DEMO_MARKER]).toBe(item.pack);
      expect(item.companyId).not.toBe(demo.companyId);
    }
    const first = created[0];
    if (!first) throw new Error('No demo company');
    await db.owner.sql`update companies set name='My renamed practice shop' where id=${first.companyId}`;
    const before = await db.owner.sql`select id,name,settings from companies order by id`;
    const repeated = await prepareIndustryDemoCompanies(db.owner);
    expect(repeated.map((item) => item.companyId)).toEqual(created.map((item) => item.companyId));
    expect(repeated[0]?.name).toBe('My renamed practice shop');
    expect(await db.owner.sql`select id,name,settings from companies order by id`).toEqual(before);
    const [admin] = await db.owner.sql`select default_company_id from users where id=${demo.userId}`;
    expect(admin?.default_company_id).toBe(demo.companyId);
    expect(repeated.map((item) => item.pack)).toEqual(INDUSTRY_DEMOS.map((item) => item.pack));
  });
});
