import { type Database } from '@daifuku/kernel';

export const DEMO_TENANT = {
  tenantName: 'Demo',
  companyCode: 'DEMO',
  companyName: 'デモ株式会社',
  adminEmail: 'admin@example.com',
  adminName: 'Admin',
  adminPassword: 'password',
} as const;

export interface DemoIdentity {
  tenantId: string;
  companyId: string;
  userId: string;
}

/** A global email or a user's mutable default company never identifies the demo company. */
export async function findDemoIdentity(owner: Database): Promise<DemoIdentity | null> {
  const rows = await owner.sql<{ tenant_id: string; company_id: string; user_id: string }[]>`
    select t.id as tenant_id, c.id as company_id, u.id as user_id from tenants t
    join companies c on c.tenant_id = t.id join users u on u.tenant_id = t.id
    where t.name = ${DEMO_TENANT.tenantName} and c.code = ${DEMO_TENANT.companyCode}
      and u.email = ${DEMO_TENANT.adminEmail}`;
  if (rows.length > 1) throw new Error('Multiple demo identities match. Use explicit tenant/company identifiers.');
  const row = rows[0];
  return row ? { tenantId: row.tenant_id, companyId: row.company_id, userId: row.user_id } : null;
}
