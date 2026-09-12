// Tenant/company scoping shared by repository reads and aggregates (ADR-0004).
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Context } from '../context.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { StateError } from '../errors.ts';
import { storeCondition } from '../store-access.ts';

export function scopeCondition(ctx: Context, e: EntityDef): SQL {
  const relay = ctx.actor.type === 'relay' ? e.config.relayAccess && ctx.relay?.gatewayId === ctx.actor.id ? eq(e.col(e.config.relayAccess.field), ctx.actor.id) : sql`false` : undefined;
  const tenant = and(eq(e.col('tenantId'), ctx.tenantId), relay);
  if (e.scope === 'tenant') return and(tenant, storeCondition(ctx, e)) as SQL;
  if (!ctx.companyId) throw new StateError(`${e.name} is company-scoped but the context has no company`, 'Select a company (companyId) in the context.');
  return and(tenant, eq(e.col('companyId'), ctx.companyId), storeCondition(ctx, e)) as SQL;
}

export function assertRelayWrite(ctx: Context, e: EntityDef, row: Record<string, unknown>): void {
  if (ctx.actor.type !== 'relay') return;
  if (!e.config.relayAccess || !ctx.relay || ctx.relay.gatewayId !== ctx.actor.id || row[e.config.relayAccess.field] !== ctx.actor.id) throw new StateError('Relay write is outside its gateway.', 'Use the bound gateway workflow.');
}
