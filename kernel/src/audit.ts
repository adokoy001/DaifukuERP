// Append-only audit trail (ADR-0007). The app role has INSERT only on audit_log (see migration hooks).
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Context } from './context.ts';
import { auditLog } from './db/system-tables.ts';
import { newId } from './ids.ts';
import { isAdmin } from './context.ts';
import { PermissionDenied } from './errors.ts';
import { assertOp, maskedFields, rowFilter } from './permissions.ts';
import { registry } from './registry.ts';
import { scopeCondition } from './repository/scope.ts';
import { publicOutput } from './public-output.ts';

export type AuditOp = 'create' | 'update' | 'delete' | 'submit' | 'cancel' | 'amend' | (string & {});

export async function writeAudit(
  ctx: Context,
  entity: string,
  recordId: string,
  op: AuditOp,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  action?: string,
): Promise<void> {
  const def = registry.hasEntity(entity) ? registry.entity(entity) : undefined;
  const publicSnapshot = (row: Record<string, unknown> | null) => (row && def ? publicOutput(def, row) : row);
  await ctx.db.insert(auditLog).values({
    id: newId(),
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    entity,
    recordId,
    op,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    onBehalfOf: ctx.actor.onBehalfOf ?? null,
    action: action ?? null,
    requestId: ctx.requestId,
    at: ctx.now(),
    before: publicSnapshot(before),
    after: publicSnapshot(after),
  });
}

export interface AuditEntry {
  id: string;
  op: string;
  actorType: string;
  actorId: string;
  onBehalfOf: string | null;
  action: string | null;
  requestId: string | null;
  at: Date;
  before: unknown;
  after: unknown;
}

export async function auditTrail(ctx: Context, entity: string, recordId: string, limit = 100): Promise<AuditEntry[]> {
  const def = registry.hasEntity(entity) ? registry.entity(entity) : undefined;
  if (def) {
    assertOp(ctx, def, 'read');
    const visible = await ctx.db
      .select({ id: def.col('id') })
      .from(def.table)
      .where(and(scopeCondition(ctx, def), rowFilter(ctx, def, 'read'), eq(def.col('id'), recordId)))
      .limit(1);
    if (!visible.length && (!isAdmin(ctx) || (ctx.accessScope && ctx.accessScope !== 'all')))
      throw new PermissionDenied(entity, 'audit', ctx.roles);
  } else if (
    (ctx.accessScope && ctx.accessScope !== 'all') ||
    (!isAdmin(ctx) && !(entity === 'company_settings' && recordId === ctx.companyId && ctx.roles.includes('settings')))
  ) {
    throw new PermissionDenied(entity, 'audit', ctx.roles);
  }
  const mask = def ? maskedFields(ctx, def) : new Set<string>();
  const filtered = (row: unknown) => {
    if (row === null || typeof row !== 'object') return null;
    const visible = Object.fromEntries(Object.entries(row).filter(([key]) => !mask.has(key)));
    return def ? publicOutput(def, visible) : visible;
  };
  const rows = await ctx.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, ctx.tenantId),
        def?.scope === 'tenant'
          ? undefined
          : ctx.companyId
            ? eq(auditLog.companyId, ctx.companyId)
            : isNull(auditLog.companyId),
        eq(auditLog.entity, entity),
        eq(auditLog.recordId, recordId),
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(Math.max(1, Math.min(limit, 500)));
  return rows.map((r) => ({
    id: r.id,
    op: r.op,
    actorType: r.actorType,
    actorId: r.actorId,
    onBehalfOf: r.onBehalfOf,
    action: r.action,
    requestId: r.requestId,
    at: r.at,
    before: filtered(r.before),
    after: filtered(r.after),
  }));
}
