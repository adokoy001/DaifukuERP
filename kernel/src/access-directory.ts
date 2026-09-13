import { and, desc, eq, inArray } from 'drizzle-orm';
import { assertAccessAdmin, availableRoles, directoryStores, publicManagedUser } from './access-admin-common.ts';
import { publicMembership } from './access-memberships.ts';
import type { Context } from './context.ts';
import { auditLog, companies, companyMemberships, users } from './db/system-tables.ts';
import { managedUser } from './access-admin-common.ts';

export async function accessDirectory(ctx: Context) {
  await assertAccessAdmin(ctx);
  const people = await ctx.db.select().from(users).where(eq(users.tenantId, ctx.tenantId)).orderBy(users.email);
  const companyList = await ctx.db
    .select({ id: companies.id, code: companies.code, name: companies.name, currency: companies.currency })
    .from(companies)
    .where(eq(companies.tenantId, ctx.tenantId))
    .orderBy(companies.code);
  const memberships = await ctx.db
    .select()
    .from(companyMemberships)
    .where(eq(companyMemberships.tenantId, ctx.tenantId));
  return {
    users: people.map(publicManagedUser),
    companies: companyList,
    memberships: memberships.map(publicMembership),
    roles: availableRoles(),
    stores: await directoryStores(ctx),
    sites: await directoryStores(ctx, undefined, 'sites'),
  };
}

export async function accessAudit(ctx: Context, userId: string) {
  await assertAccessAdmin(ctx);
  await managedUser(ctx, userId);
  const rows = await ctx.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, ctx.tenantId),
        eq(auditLog.recordId, userId),
        inArray(auditLog.entity, ['access_user', 'company_membership']),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(100);
  return {
    items: rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      op: r.op,
      actorType: r.actorType,
      actorId: r.actorId,
      onBehalfOf: r.onBehalfOf,
      action: r.action,
      requestId: r.requestId,
      at: r.at,
      before: r.before,
      after: r.after,
    })),
  };
}
