// Historical 0016 flags and related security facts; current DSL defaults must not synthesize the source data.
import { createHash } from 'node:crypto';
import { newId, type Database } from '@daifuku/kernel';
import { expectedBooleanUserFacts } from './legacy-fixture.ts';

export interface BooleanTenantFixture {
  tenant: string;
  company: string;
  users: string[];
  gateway: string;
  site: string;
  credentials: string[];
  fields: string[];
}

export const syntheticRelaySecret = (id: string) => id.replaceAll('-', '').padEnd(43, 'A');

export async function seedBooleanHistory(owner: Database): Promise<BooleanTenantFixture[]> {
  const fixtures: BooleanTenantFixture[] = [];
  for (const name of ['First', 'Second']) {
    const fixture = {
      tenant: newId(),
      company: newId(),
      users: [newId(), newId()],
      gateway: newId(),
      site: newId(),
      credentials: [newId(), newId()],
      fields: [newId(), newId()],
    };
    const { tenant, company, site, gateway } = fixture;
    await owner.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenant}, true)`;
      await tx`insert into tenants(id,name) values(${tenant},${name})`;
      await tx`insert into companies(id,tenant_id,code,name,settings) values(${company},${tenant},'KEEP',${name},'{"preserve":true}')`;
      await tx`insert into workforce_site(id,tenant_id,company_id,code,name) values(${site},${tenant},${company},'KEEP',${name})`;
      await tx`insert into edge_gateway(id,tenant_id,company_id,site_id,code,name) values(${gateway},${tenant},${company},${site},'KEEP',${name})`;
      for (const [index, id] of fixture.users.entries()) {
        const flag = index === 0 ? 1 : 0;
        await tx`insert into users(id,tenant_id,email,name,password_hash,default_company_id,roles,active,tenant_admin,mfa_enabled,version,session_version)
          values(${id},${tenant},${`${id}@example.invalid`},${`Existing ${index}`},'synthetic-preserved-hash',${company},'["legacy"]',${flag},${flag},${flag},8,13)`;
        await tx`insert into user_company_memberships(tenant_id,user_id,company_id,roles,version)
          values(${tenant},${id},${company},'["edge_manager"]',4)`;
        if (flag === 1)
          await tx`insert into identity_factors(user_id,tenant_id,secret_cipher,recovery_hashes,last_step)
            values(${id},${tenant},'synthetic-sealed-factor','["synthetic-recovery"]',123)`;
      }
      for (const [index, id] of fixture.credentials.entries()) {
        const secretHash = createHash('sha256').update(syntheticRelaySecret(id)).digest('hex');
        await tx`insert into relay_credentials(id,tenant_id,company_id,gateway_id,site_id,secret_hash,credential_version,active,expires_at,revoked_at)
          values(${id},${tenant},${company},${gateway},${site},${secretHash},${index + 1},${index === 0 ? 1 : 0},'2036-01-01T00:00:00Z',${index === 0 ? null : '2026-01-01T00:00:00Z'})`;
      }
      for (const [index, id] of fixture.fields.entries())
        await tx`insert into ext_field_definitions(id,tenant_id,entity,key,kind,label,owner,required,options)
          values(${id},${tenant},'product',${`legacy_${index}`},'text','{"ja":"既存","en":"Existing"}','synthetic',${index},'{"preserve":[1,2,3]}')`;
      await tx`insert into product(id,tenant_id,company_id,code,name,ext,version)
        values(${newId()},${tenant},${company},'KEEP','Existing product','{"jan":"0001234567890","preserve":true}',9)`;
    });
    fixtures.push(fixture);
  }
  return fixtures;
}

export async function booleanHistoryFacts(owner: Database) {
  return {
    users: await owner.sql`select * from users order by id`,
    fields: await owner.sql`select * from ext_field_definitions order by id`,
    credentials: await owner.sql`select * from relay_credentials order by id`,
    factors: await owner.sql`select * from identity_factors order by user_id`,
    memberships: await owner.sql`select * from user_company_memberships order by user_id,company_id`,
    companies: await owner.sql`select * from companies order by id`,
    products: await owner.sql`select * from product order by id`,
    gateways: await owner.sql`select * from edge_gateway order by id`,
    constraints:
      await owner.sql`select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition
      from pg_constraint where connamespace='public'::regnamespace order by relation,conname`,
  };
}

export function expectedBooleanHistory(before: Awaited<ReturnType<typeof booleanHistoryFacts>>) {
  return {
    ...before,
    users: expectedBooleanUserFacts(before.users),
    fields: before.fields.map((row) => ({ ...row, required: row.required === 1 })),
    credentials: before.credentials.map((row) => ({ ...row, active: row.active === 1 })),
  };
}
