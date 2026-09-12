// Tenant/company scoping shared by repository reads and aggregates (ADR-0004).
import { and, eq, type SQL } from 'drizzle-orm';
import type { Context } from '../context.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { StateError } from '../errors.ts';
import { storeCondition } from '../store-access.ts';

export function scopeCondition(ctx: Context, e: EntityDef): SQL {
  const tenant = eq(e.col('tenantId'), ctx.tenantId);
  if (e.scope === 'tenant') return and(tenant, storeCondition(ctx, e)) as SQL;
  if (!ctx.companyId) throw new StateError(`${e.name} is company-scoped but the context has no company`, 'Select a company (companyId) in the context.');
  return and(tenant, eq(e.col('companyId'), ctx.companyId), storeCondition(ctx, e)) as SQL;
}
