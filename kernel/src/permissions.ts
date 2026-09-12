// Permission engine (ADR-0007): role x operation, row rules compiled to SQL, field groups. Default deny.
import { and, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { isAdmin, type Context } from './context.ts';
import type { EntityDef } from './dsl/entity.ts';
import type { Domain, DomainCondition, DomainScalar, Op } from './dsl/types.ts';
import { PermissionDenied, ValidationError } from './errors.ts';
import { compileExtCondition, isExtPath } from './repository/ext-query.ts';
import { conditionEntries, isTimestampColumn, queryScalar, type QueryScalar } from './repository/query-values.ts';
import { registry } from './registry.ts';
import { storeAllows, effectiveSitePolicy } from './store-access.ts';
import { outputHiddenFields } from './public-output.ts';

/** Roles of the context that are granted `op` on the entity. */
export function grantedRoles(ctx: Pick<Context, 'roles'>, entity: EntityDef, op: Op): string[] {
  const roles = entity.config.permissions.roles;
  return ctx.roles.filter((r) => roles[r]?.includes(op));
}

export function can(ctx: Pick<Context, 'roles' | 'appliedPacks' | 'accessScope'> & Partial<Pick<Context, 'actor'>>, entity: EntityDef, op: Op): boolean {
  if (ctx.actor?.type === 'relay' && (!entity.config.relayAccess?.operations.includes(op) || !grantedRoles(ctx, entity, op).includes('relay'))) return false;
  if (entity.module && registry.hasPack(entity.module) && !(ctx.appliedPacks ?? []).includes(entity.module)) return false;
  if (!storeAllows(ctx, entity, op)) return false;
  if (ctx.accessScope && ctx.accessScope !== 'all' && effectiveSitePolicy(ctx, entity)?.kind === 'sharedRead' && op === 'read') return true;
  return isAdmin(ctx) || grantedRoles(ctx, entity, op).length > 0;
}

export function assertOp(ctx: Pick<Context, 'roles' | 'appliedPacks' | 'accessScope'> & Partial<Pick<Context, 'actor'>>, entity: EntityDef, op: Op): void {
  if (!can(ctx, entity, op)) throw new PermissionDenied(entity.name, op, ctx.roles);
}

/** Operations the context may perform on the entity (for UI/meta). */
export function allowedOps(ctx: Pick<Context, 'roles' | 'appliedPacks' | 'accessScope'> & Partial<Pick<Context, 'actor'>>, entity: EntityDef): Op[] {
  const all: Op[] = ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'];
  return all.filter((op) => can(ctx, entity, op));
}

function substitute(ctx: Context, v: DomainScalar): DomainScalar {
  if (typeof v !== 'string' || !v.startsWith('$ctx.')) return v;
  switch (v) {
    case '$ctx.actorId':
      return ctx.actor.id;
    case '$ctx.userId':
      return ctx.actor.type === 'agent' ? (ctx.actor.onBehalfOf ?? ctx.actor.id) : ctx.actor.id;
    case '$ctx.companyId':
      return ctx.companyId;
    case '$ctx.tenantId':
      return ctx.tenantId;
    default:
      throw new ValidationError(`unknown context token ${v}`, [{ path: 'where', message: `unknown token ${v}` }]);
  }
}

/**
 * `$in` with SQL's meaning (phase15-cleanup AC-3): an empty list matches no row (`false`), and a null element (literal or a
 * `$ctx.*` token resolving to null) adds `col IS NULL` — `col IN (NULL)` alone never matches.
 */
function compileIn(ctx: Context, col: PgColumn, field: string, list: readonly DomainScalar[]): SQL {
  if (!Array.isArray(list)) throw new ValidationError('Invalid search membership', [{ path: `where.${field}.$in`, message: 'array required' }]);
  const vals = list.map((v, index) => queryScalar(col, substitute(ctx, v), `where.${field}.$in.${index}`));
  const nonNull = vals.filter((v): v is Exclude<QueryScalar, null> => v !== null);
  const withNull = nonNull.length < vals.length;
  if (nonNull.length === 0) return withNull ? isNull(col) : sql`false`;
  const matched = inArray(col, nonNull);
  return withNull ? (or(matched, isNull(col)) ?? matched) : matched;
}

function compileSingleCondition(ctx: Context, entity: EntityDef, field: string, cond: DomainCondition): SQL {
  if (isExtPath(field)) return compileExtCondition(entity, field, cond, (v) => substitute(ctx, v));
  const col = entity.col(field);
  const value = (operand: DomainScalar, op?: string) => queryScalar(col, substitute(ctx, operand), `where.${field}${op ? `.${op}` : ''}`);
  if (cond === null) return isNull(col);
  if (typeof cond !== 'object') return eq(col, value(cond));
  if ('$in' in cond) return compileIn(ctx, col, field, cond.$in);
  if ('$ne' in cond) {
    const v = value(cond.$ne, '$ne');
    return v === null ? isNotNull(col) : ne(col, v);
  }
  if ('$gt' in cond) return gt(col, value(cond.$gt, '$gt'));
  if ('$gte' in cond) return gte(col, value(cond.$gte, '$gte'));
  if ('$lt' in cond) return lt(col, value(cond.$lt, '$lt'));
  if ('$lte' in cond) return lte(col, value(cond.$lte, '$lte'));
  if ('$like' in cond) {
    if (isTimestampColumn(col)) throw new ValidationError('Pattern searches do not support timestamps', [{ path: `where.${field}.$like`, message: 'Use equality or a timestamp range.' }]);
    return like(col, cond.$like);
  }
  throw new ValidationError(`unsupported condition on ${field}`, [{ path: field, message: 'unsupported operator' }]);
}

function compileCondition(ctx: Context, entity: EntityDef, field: string, condition: DomainCondition): SQL {
  if (condition === null || typeof condition !== 'object') return compileSingleCondition(ctx, entity, field, condition);
  const entries = conditionEntries(field, condition);
  const parts = entries.map(([op, operand]) => compileSingleCondition(ctx, entity, field, { [op]: operand } as DomainCondition));
  // conditionEntries rejects empty objects; single-operator SQL remains byte-for-byte unchanged.
  return parts.length === 1 ? parts[0] as SQL : and(...parts) as SQL;
}

/** Compiles a domain expression into a Drizzle SQL condition. */
export function compileDomain(ctx: Context, entity: EntityDef, domain: Domain): SQL | undefined {
  const parts: SQL[] = [];
  for (const [key, value] of Object.entries(domain)) {
    if (value === undefined) continue;
    if (key === '$or' || key === '$and') {
      if (!Array.isArray(value)) throw new ValidationError('invalid domain group', [{ path: key, message: 'array required' }]);
      const subs = (value as Domain[]).map((d) => compileDomain(ctx, entity, d) ?? sql`true`);
      if (subs.length === 0) { parts.push(key === '$or' ? sql`false` : sql`true`); continue; }
      const combined = key === '$or' ? or(...subs) : and(...subs);
      if (combined) parts.push(combined);
      continue;
    }
    if (Array.isArray(value)) throw new ValidationError(`field ${key} cannot take an array`, [{ path: key, message: 'use $in' }]);
    parts.push(compileCondition(ctx, entity, key, value as DomainCondition));
  }
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : and(...parts);
}

/**
 * Row filter for the context. `undefined` means unrestricted. A user is restricted only when every
 * granted role is restricted; the filter is the OR of those roles' rules.
 */
export function rowFilter(ctx: Context, entity: EntityDef, op: Op): SQL | undefined {
  if (isAdmin(ctx) && ctx.actor.type !== 'relay') return undefined;
  const granted = grantedRoles(ctx, entity, op);
  const rules = entity.config.permissions.rowRules ?? [];
  const restrictedRoles = new Set(rules.flatMap((r) => [...r.roles]));
  if (granted.some((r) => !restrictedRoles.has(r))) return undefined;
  const applicable = rules.filter((r) => r.roles.some((role) => granted.includes(role)));
  const compiled = applicable.map((r) => compileDomain(ctx, entity, r.where)).filter((s): s is SQL => s !== undefined);
  if (compiled.length === 0) return undefined;
  return compiled.length === 1 ? compiled[0] : or(...compiled);
}

/** Fields the context may NOT read (masked to undefined in results). */
export function maskedFields(ctx: Pick<Context, 'roles'>, entity: EntityDef): Set<string> {
  const masked = new Set<string>();
  if (isAdmin(ctx)) return masked;
  for (const group of Object.values(entity.config.permissions.fieldGroups ?? {})) {
    if (!group.roles.some((r) => ctx.roles.includes(r))) for (const f of group.fields) masked.add(f);
  }
  return masked;
}

export function assertWritableFields(ctx: Pick<Context, 'roles'>, entity: EntityDef, keys: readonly string[]): void {
  const masked = maskedFields(ctx, entity);
  const blocked = keys.filter((k) => masked.has(k));
  if (blocked.length > 0) {
    throw new PermissionDenied(entity.name, `write:${blocked.join(',')}`, ctx.roles);
  }
}

export function assertReadableFields(ctx: Pick<Context, 'roles'>, entity: EntityDef, keys: readonly string[]): void {
  const masked = maskedFields(ctx, entity);
  const hidden = outputHiddenFields(entity);
  const hiddenExt = [...hidden].some((key) => key.startsWith('ext.'));
  const blocked = keys.filter((k) => masked.has(k) || hidden.has(k) || (k === 'ext' && hiddenExt) || (k.startsWith('ext.') && masked.has('ext')));
  if (blocked.length) throw new PermissionDenied(entity.name, `read:${blocked.join(',')}`, ctx.roles);
}
