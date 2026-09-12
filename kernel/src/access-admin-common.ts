import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from './context.ts';
import { companies, users } from './db/system-tables.ts';
import { Conflict, NotFound, PermissionDenied, ValidationError } from './errors.ts';
import { registry } from './registry.ts';
import { storePolicy } from './store-access.ts';
import { writeAudit } from './audit.ts';

export const createUserSchema = z.object({ email: z.email().max(200), name: z.string().trim().min(1).max(200), password: z.string().min(12).max(200), tenantAdmin: z.boolean().default(false) }).strict();
export const updateUserSchema = z.object({ expectedVersion: z.number().int().min(1), name: z.string().trim().min(1).max(200).optional(), active: z.boolean().optional(), tenantAdmin: z.boolean().optional(), password: z.string().min(12).max(200).optional() }).strict();
export const membershipSchema = z.object({ expectedVersion: z.number().int().min(0), roles: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1).max(50), accessScope: z.enum(['all', 'stores', 'sites']), storeIds: z.array(z.uuid()).max(500), siteIds: z.array(z.uuid()).max(500).default([]) }).strict();
export const removeMembershipSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

export function publicManagedUser(user: typeof users.$inferSelect) {
  return { id: user.id, email: user.email, name: user.name, active: user.active === 1, tenantAdmin: user.tenantAdmin === 1, defaultCompanyId: user.defaultCompanyId, version: user.version };
}
export function actorUser(ctx: Context): string { return ctx.actor.type === 'agent' ? ctx.actor.onBehalfOf ?? '' : ctx.actor.id; }

/** Recheck after lock: concurrent administrator demotions are serialized, including caller revocation. */
export async function assertAccessAdmin(ctx: Context, lock = false): Promise<void> {
  if (lock) await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`access-admin:${ctx.tenantId}`}, 0))`);
  const [actor] = await ctx.db.select({ active: users.active, admin: users.tenantAdmin }).from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, actorUser(ctx)))).limit(1);
  if (!actor || actor.active !== 1 || actor.admin !== 1 || (ctx.accessScope && ctx.accessScope !== 'all')) throw new PermissionDenied('access_admin', 'manage', ctx.roles);
}
export async function managedUser(ctx: Context, id: string) {
  const [user] = await ctx.db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, id))).limit(1);
  if (!user) throw new NotFound('user', id);
  return user;
}
export function assertAccessVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new Conflict('Access settings were changed concurrently', 'Reload the user and company assignments before saving.');
}
export async function managedCompany(ctx: Context, id: string) {
  const [company] = await ctx.db.select().from(companies).where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, id))).limit(1);
  if (!company) throw new NotFound('company', id);
  return company;
}
export function availableRoles(): string[] {
  const roles = new Set(['admin', 'viewer', 'settings']);
  for (const e of registry.allEntities()) for (const role of Object.keys(e.config.permissions.roles)) roles.add(role);
  for (const a of registry.allActions()) if (a.permission !== 'authenticated' && 'roles' in a.permission) for (const role of a.permission.roles) roles.add(role);
  return [...roles].sort();
}
export async function directoryStores(ctx: Context, companyId?: string, kind: 'stores' | 'sites' = 'stores') {
  const items: { id: string; companyId: string; name: string }[] = [];
  for (const e of registry.allEntities()) {
    const p = kind === 'sites' ? e.config.siteAccess : storePolicy(e);
    if (p?.kind !== 'store' || p.field !== 'id' || e.scope !== 'company') continue;
    const rows = await ctx.db.select({ id: e.col('id'), companyId: e.col('companyId'), name: e.col(e.displayField ?? 'id') }).from(e.table).where(and(eq(e.col('tenantId'), ctx.tenantId), companyId ? eq(e.col('companyId'), companyId) : undefined));
    for (const row of rows) items.push({ id: String(row.id), companyId: String(row.companyId), name: String(row.name) });
  }
  return items;
}
export function parseAccess<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid access settings', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return parsed.data;
}

/** User changes are tenant-level; membership changes are attributed to the actual target company. */
export async function writeAccessAudit(ctx: Context, companyId: string | null, entity: string, id: string, op: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): Promise<void> {
  const auditContext = Object.create(ctx) as Context;
  Object.defineProperty(auditContext, 'companyId', { value: companyId });
  await writeAudit(auditContext, entity, id, op, before, after);
}
