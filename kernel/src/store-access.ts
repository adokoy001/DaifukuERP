// Store boundary is an AND constraint, independent of role unions and opaque write capabilities.
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Context } from './context.ts';
import type { EntityDef } from './dsl/defs.ts';
import type { Op, StoreAccessPolicy } from './dsl/types.ts';
import { PermissionDenied, StateError } from './errors.ts';
import { registry } from './registry.ts';

const additions = new WeakMap<EntityDef, StoreAccessPolicy>();
export function registerStoreAccess(entity: string, policy: StoreAccessPolicy): void {
  const def = registry.entity(entity);
  const existing = def.config.storeAccess ?? additions.get(def);
  if (existing && JSON.stringify(existing) !== JSON.stringify(policy))
    throw new StateError(
      `Conflicting store access policy for ${entity}`,
      'Declare exactly one store boundary per entity.',
    );
  additions.set(def, policy);
}
export function storePolicy(entity: EntityDef): StoreAccessPolicy | undefined {
  return entity.config.storeAccess ?? additions.get(entity);
}
export function effectiveSitePolicy(
  ctx: Pick<Context, 'accessScope'>,
  entity: EntityDef,
): StoreAccessPolicy | undefined {
  return ctx.accessScope === 'sites' ? (entity.config.siteAccess ?? storePolicy(entity)) : storePolicy(entity);
}
function scopeIds(ctx: Context, entity: EntityDef): readonly string[] {
  return ctx.accessScope === 'sites' && entity.config.siteAccess ? (ctx.siteIds ?? []) : (ctx.storeIds ?? []);
}
export function storeAllows(ctx: Pick<Context, 'accessScope'>, entity: EntityDef, op: Op): boolean {
  if (!ctx.accessScope || ctx.accessScope === 'all') return true;
  const p = effectiveSitePolicy(ctx, entity);
  if (!p) return false;
  if (p.kind === 'sharedRead') return op === 'read' || op === 'export';
  // Operational posting belongs to headquarters; a role or admin flag cannot widen this boundary.
  return !['submit', 'cancel', 'amend'].includes(op);
}

export function storeCondition(ctx: Context, entity: EntityDef, seen = new Set<string>()): SQL | undefined {
  if (!ctx.accessScope || ctx.accessScope === 'all') return undefined;
  const p = effectiveSitePolicy(ctx, entity);
  if (!p) return sql`false`;
  if (p.kind === 'sharedRead') return undefined;
  if (seen.has(entity.name)) throw new StateError('Cyclic store scope', 'Fix the entity storeAccess parent chain.');
  const next = new Set([...seen, entity.name]);
  if (p.kind === 'store')
    return scopeIds(ctx, entity).length ? inArray(entity.col(p.field), [...scopeIds(ctx, entity)]) : sql`false`;
  const parent = registry.entity(p.entity);
  const scope = and(
    eq(parent.col('tenantId'), ctx.tenantId),
    parent.scope === 'company' ? eq(parent.col('companyId'), ctx.companyId ?? '') : undefined,
    storeCondition(ctx, parent, next),
  );
  return sql`${entity.col(p.field)} in (select ${parent.col('id')} from ${parent.table} where ${scope})`;
}

/** Validate proposed values before insertion/update, preventing moves into invisible stores/parents. */
export async function assertStoreWrite(ctx: Context, entity: EntityDef, row: Record<string, unknown>): Promise<void> {
  if (!ctx.accessScope || ctx.accessScope === 'all') return;
  const p = effectiveSitePolicy(ctx, entity);
  if (!p || p.kind === 'sharedRead') throw new PermissionDenied(entity.name, 'store-write', ctx.roles);
  if (p.kind === 'store') {
    if (!scopeIds(ctx, entity).includes(String(row[p.field])))
      throw new PermissionDenied(entity.name, 'site-write', ctx.roles);
    return;
  }
  const parent = registry.entity(p.entity);
  const found = await ctx.db
    .select({ id: parent.col('id') })
    .from(parent.table)
    .where(
      and(
        eq(parent.col('tenantId'), ctx.tenantId),
        parent.scope === 'company' ? eq(parent.col('companyId'), ctx.companyId ?? '') : undefined,
        storeCondition(ctx, parent),
        eq(parent.col('id'), String(row[p.field])),
      ),
    )
    .limit(1);
  if (!found.length) throw new PermissionDenied(entity.name, 'store-parent', ctx.roles);
}
