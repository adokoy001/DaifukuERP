import { and, eq } from 'drizzle-orm';
import type { Principal } from './principal.ts';
import type { Database } from './db/client.ts';
import { companies, companyMemberships, users } from './db/system-tables.ts';
import { PermissionDenied } from './errors.ts';
import type { Context } from './context.ts';
import { assertOp } from './permissions.ts';
import { registry } from './registry.ts';

/** Identity validation only: reveals no company attributes or cross-tenant existence. */
export async function companyBelongsToTenant(owner: Database, tenantId: string, companyId: string): Promise<boolean> {
  const rows = await owner.drizzle
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)))
    .limit(1);
  return rows.length > 0;
}

/** Identity is reloaded by auth; this resolves current company membership without legacy role fallback. */
export async function resolveCompanyAccess(
  owner: Database,
  principal: Principal,
  companyId: string | null,
): Promise<Principal> {
  if (!companyId)
    return {
      ...principal,
      roles: principal.tenantAdmin ? ['admin'] : [],
      accessScope: 'all',
      storeIds: [],
      siteIds: [],
    };
  if (!(await companyBelongsToTenant(owner, principal.tenantId, companyId)))
    throw new PermissionDenied('company', 'select', principal.roles);
  if (principal.tenantAdmin) return { ...principal, roles: ['admin'], accessScope: 'all', storeIds: [], siteIds: [] };
  const [membership] = await owner.drizzle
    .select()
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.tenantId, principal.tenantId),
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.userId, principal.userId),
      ),
    )
    .limit(1);
  if (
    !membership ||
    !['all', 'stores', 'sites'].includes(membership.accessScope) ||
    !Array.isArray(membership.roles) ||
    !Array.isArray(membership.storeIds) ||
    !Array.isArray(membership.siteIds)
  )
    throw new PermissionDenied('company', 'select', principal.roles);
  return {
    ...principal,
    roles: membership.roles,
    accessScope: membership.accessScope,
    storeIds: membership.storeIds,
    siteIds: membership.siteIds,
  };
}

/** Identity-only port for module-owned employee links. Never returns a user's email or secret. */
export async function assertCompanyUser(ctx: Context, userId: string): Promise<void> {
  const rows = await ctx.db
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      companyMemberships,
      and(
        eq(companyMemberships.tenantId, users.tenantId),
        eq(companyMemberships.userId, users.id),
        eq(companyMemberships.companyId, ctx.companyId ?? ''),
      ),
    )
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, userId), eq(users.active, true)))
    .limit(1);
  if (!rows.length) throw new PermissionDenied('employee_user', 'company-membership', ctx.roles);
}

/** A module declares which entity's create permission authorizes linking company user identities. */
export async function companyMemberIdentities(ctx: Context, targetEntity: string) {
  assertOp(ctx, registry.entity(targetEntity), 'create');
  return ctx.db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(
      companyMemberships,
      and(
        eq(companyMemberships.tenantId, users.tenantId),
        eq(companyMemberships.userId, users.id),
        eq(companyMemberships.companyId, ctx.companyId ?? ''),
      ),
    )
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.active, true)))
    .orderBy(users.name, users.id);
}

export async function selectableCompanies(owner: Database, principal: Principal) {
  const columns = { id: companies.id, name: companies.name, code: companies.code, currency: companies.currency };
  if (principal.tenantAdmin)
    return owner.drizzle
      .select(columns)
      .from(companies)
      .where(eq(companies.tenantId, principal.tenantId))
      .orderBy(companies.code);
  return owner.drizzle
    .select(columns)
    .from(companies)
    .innerJoin(
      companyMemberships,
      and(
        eq(companyMemberships.tenantId, companies.tenantId),
        eq(companyMemberships.companyId, companies.id),
        eq(companyMemberships.userId, principal.userId),
      ),
    )
    .where(eq(companies.tenantId, principal.tenantId))
    .orderBy(companies.code);
}
