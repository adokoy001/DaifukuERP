// Same-tenant company work with live authorization; ADR-0021.
import { and, eq } from 'drizzle-orm';
import type { Context } from './context.ts';
import { makeContext } from './db/client.ts';
import { companies, companyMemberships, users } from './db/system-tables.ts';
import { PermissionDenied } from './errors.ts';
import { isUuid } from './ids.ts';
import { appliedPackNames } from './pack-scope.ts';

export interface AuthorizedCompany { id: string; code: string; name: string; currency: string }

function denied(ctx: Context): never { throw new PermissionDenied('company', 'cross-company', ctx.roles); }

async function liveUser(ctx: Context) {
  if (ctx.accessScope !== 'all') denied(ctx);
  const userId = ctx.actor.type === 'user' ? ctx.actor.id : ctx.actor.type === 'agent' ? ctx.actor.onBehalfOf : undefined;
  if (!userId || !isUuid(userId)) denied(ctx);
  const [user] = await ctx.db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, userId), eq(users.active, 1))).for('share').limit(1);
  if (!user || (user.mfaEnabled === 1 && ctx.mfaVerified !== true) || (ctx.sessionVersion !== undefined && ctx.sessionVersion !== user.sessionVersion)) denied(ctx);
  return user;
}

function fullMembership(row: typeof companyMemberships.$inferSelect): boolean {
  return row.accessScope === 'all' && Array.isArray(row.roles) && row.roles.length > 0 && row.roles.every((role) => typeof role === 'string') && Array.isArray(row.storeIds) && row.storeIds.length === 0 && Array.isArray(row.siteIds) && row.siteIds.length === 0;
}

/** Names only. Domain modules must still check their entity permissions in each child Context. */
export async function authorizedCompanies(ctx: Context): Promise<AuthorizedCompany[]> {
  const user = await liveUser(ctx);
  const columns = { id: companies.id, code: companies.code, name: companies.name, currency: companies.currency };
  if (user.tenantAdmin === 1) return ctx.db.select(columns).from(companies).where(eq(companies.tenantId, ctx.tenantId)).orderBy(companies.code);
  const memberships = await ctx.db.select().from(companyMemberships).where(and(eq(companyMemberships.tenantId, ctx.tenantId), eq(companyMemberships.userId, user.id))).for('share');
  const permitted = new Set(memberships.filter(fullMembership).map((row) => row.companyId));
  const rows = await ctx.db.select(columns).from(companies).where(eq(companies.tenantId, ctx.tenantId)).orderBy(companies.code);
  return rows.filter((row) => permitted.has(row.id));
}

/** Preserves transaction, audit actor and tenant; never inherits the parent roles or write capabilities. */
export async function withAuthorizedCompany<T>(ctx: Context, companyId: string, work: (company: Context) => Promise<T>): Promise<T> {
  const user = await liveUser(ctx);
  if (!isUuid(companyId)) denied(ctx);
  const [company] = await ctx.db.select().from(companies).where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, companyId))).limit(1);
  if (!company) denied(ctx);
  let roles: string[] = ['admin'];
  if (user.tenantAdmin !== 1) {
    const [membership] = await ctx.db.select().from(companyMemberships).where(and(eq(companyMemberships.tenantId, ctx.tenantId), eq(companyMemberships.userId, user.id), eq(companyMemberships.companyId, companyId))).for('share').limit(1);
    if (!membership || !fullMembership(membership)) denied(ctx);
    roles = membership.roles;
  }
  return work(makeContext(ctx.db, {
    tenantId: ctx.tenantId, companyId, actor: ctx.actor, roles, sessionVersion: user.sessionVersion, mfaVerified: ctx.mfaVerified === true,
    tenantAdmin: user.tenantAdmin === 1, accessScope: 'all', storeIds: [], siteIds: [],
    appliedPacks: appliedPackNames(company.settings), requestId: ctx.requestId, locale: ctx.locale, log: ctx.log, now: ctx.now,
  }));
}
