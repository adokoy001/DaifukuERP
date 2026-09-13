import { and, eq } from 'drizzle-orm';
import {
  actorUser,
  assertAccessAdmin,
  assertAccessVersion,
  availableRoles,
  directoryStores,
  managedCompany,
  managedUser,
  membershipSchema,
  parseAccess,
  removeMembershipSchema,
  writeAccessAudit,
} from './access-admin-common.ts';
import type { Context } from './context.ts';
import { companyMemberships, users } from './db/system-tables.ts';
import { NotFound, PermissionDenied, ValidationError } from './errors.ts';

function membershipWhere(ctx: Context, userId: string, companyId: string) {
  return and(
    eq(companyMemberships.tenantId, ctx.tenantId),
    eq(companyMemberships.userId, userId),
    eq(companyMemberships.companyId, companyId),
  );
}
export function publicMembership(row: typeof companyMemberships.$inferSelect) {
  return {
    userId: row.userId,
    companyId: row.companyId,
    roles: row.roles,
    accessScope: row.accessScope,
    storeIds: row.storeIds,
    siteIds: row.siteIds,
    version: row.version,
  };
}

export async function putCompanyMembership(ctx: Context, userId: string, companyId: string, raw: unknown) {
  await assertAccessAdmin(ctx, true);
  if (actorUser(ctx) === userId) throw new PermissionDenied('company_membership', 'self-access-change', ctx.roles);
  const input = parseAccess(membershipSchema, raw);
  const user = await managedUser(ctx, userId);
  await managedCompany(ctx, companyId);
  const roles = [...new Set(input.roles)].sort();
  if (roles.some((r) => !availableRoles().includes(r)))
    throw new ValidationError('Unknown role', [{ path: 'roles', message: 'Choose registered roles.' }]);
  const storeIds = [...new Set(input.storeIds)].sort();
  const siteIds = [...new Set(input.siteIds)].sort();
  if (input.accessScope === 'all' && (storeIds.length || siteIds.length))
    throw new ValidationError('Company-wide access must have no site/store list', [
      { path: 'accessScope', message: 'Use empty lists.' },
    ]);
  if (input.accessScope !== 'sites' && siteIds.length)
    throw new ValidationError('Generic site assignments require sites scope', [
      { path: 'siteIds', message: 'Select sites access.' },
    ]);
  if (input.accessScope === 'stores') {
    if (!storeIds.length || roles.some((r) => !['chain_staff', 'chain_manager'].includes(r)))
      throw new ValidationError('Store assignments need stores and store roles', [
        { path: 'roles', message: 'Use chain_staff or chain_manager and select at least one store.' },
      ]);
    const allowed = new Set((await directoryStores(ctx, companyId)).map((s) => s.id));
    if (storeIds.some((s) => !allowed.has(s)))
      throw new ValidationError('Store is outside the selected company', [
        { path: 'storeIds', message: 'Choose stores in this company.' },
      ]);
  }
  if (input.accessScope === 'sites') {
    if (
      !siteIds.length ||
      roles.some(
        (r) =>
          ![
            'workforce_employee',
            'workforce_manager',
            'chain_staff',
            'chain_manager',
            'edge_manager',
            'edge_operator',
          ].includes(r),
      )
    )
      throw new ValidationError('Site assignments need sites and limited staff roles', [
        { path: 'roles', message: 'Use workforce, chain staff, or edge device roles.' },
      ]);
    const allowed = new Set((await directoryStores(ctx, companyId, 'sites')).map((s) => s.id));
    if (siteIds.some((s) => !allowed.has(s)))
      throw new ValidationError('Site is outside the selected company', [
        { path: 'siteIds', message: 'Choose sites in this company.' },
      ]);
    const stores = new Set((await directoryStores(ctx, companyId)).map((s) => s.id));
    if (storeIds.some((s) => !stores.has(s)))
      throw new ValidationError('Store is outside the selected company', [
        { path: 'storeIds', message: 'Choose stores in this company.' },
      ]);
  }
  const [before] = await ctx.db
    .select()
    .from(companyMemberships)
    .where(membershipWhere(ctx, userId, companyId))
    .limit(1);
  assertAccessVersion(before?.version ?? 0, input.expectedVersion);
  const values = { roles, accessScope: input.accessScope, storeIds, siteIds, version: (before?.version ?? 0) + 1 };
  const [after] = before
    ? await ctx.db
        .update(companyMemberships)
        .set(values)
        .where(membershipWhere(ctx, userId, companyId))
        .returning()
    : await ctx.db
        .insert(companyMemberships)
        .values({ tenantId: ctx.tenantId, userId, companyId, ...values })
        .returning();
  if (!after) throw new NotFound('company_membership', userId);
  if (!user.defaultCompanyId)
    await ctx.db
      .update(users)
      .set({ defaultCompanyId: companyId, version: user.version + 1 })
      .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, userId)));
  const result = publicMembership(after);
  await writeAccessAudit(
    ctx,
    companyId,
    'company_membership',
    userId,
    before ? 'update' : 'create',
    before ? publicMembership(before) : null,
    result,
  );
  return result;
}

export async function removeCompanyMembership(ctx: Context, userId: string, companyId: string, raw: unknown) {
  await assertAccessAdmin(ctx, true);
  if (actorUser(ctx) === userId) throw new PermissionDenied('company_membership', 'self-access-change', ctx.roles);
  const input = parseAccess(removeMembershipSchema, raw);
  const user = await managedUser(ctx, userId);
  const [before] = await ctx.db
    .select()
    .from(companyMemberships)
    .where(membershipWhere(ctx, userId, companyId))
    .limit(1);
  if (!before) throw new NotFound('company_membership', userId);
  assertAccessVersion(before.version, input.expectedVersion);
  await ctx.db.delete(companyMemberships).where(membershipWhere(ctx, userId, companyId));
  if (user.defaultCompanyId === companyId) {
    const [next] = await ctx.db
      .select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .where(and(eq(companyMemberships.tenantId, ctx.tenantId), eq(companyMemberships.userId, userId)))
      .orderBy(companyMemberships.companyId)
      .limit(1);
    await ctx.db
      .update(users)
      .set({ defaultCompanyId: next?.companyId ?? null, version: user.version + 1 })
      .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, userId)));
  }
  await writeAccessAudit(ctx, companyId, 'company_membership', userId, 'delete', publicMembership(before), null);
  return { deleted: true as const };
}
