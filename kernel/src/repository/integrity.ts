// Storage/aggregate invariants shared by every repository entry point (ADR-0016).
import { and, count, eq } from 'drizzle-orm';
import type { Context } from '../context.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { DOCSTATUS, type Op } from '../dsl/types.ts';
import { Conflict, NotFound, StateError, ValidationError } from '../errors.ts';
import { registry } from '../registry.ts';
import { contextRoot, hasWriteCapability, ownsField } from '../write-capability.ts';
import { scopeCondition } from './scope.ts';
import { assertOp, rowFilter } from '../permissions.ts';
import { writeAudit } from '../audit.ts';
import { snapshot } from './rows.ts';

type Raw = Record<string, unknown>;
export const MAX_LINES = 500;
const saving = new WeakMap<Context, Set<string>>();
const lifecycles = new WeakMap<Context, Map<string, Op>>();
export async function duringLifecycle<T>(ctx: Context, entity: string, id: string, op: Op, work: () => Promise<T>): Promise<T> {
  const root = contextRoot(ctx);
  const active = lifecycles.get(root) ?? new Map<string, Op>();
  const key = aggregateKey(entity, id);
  active.set(key, op);
  lifecycles.set(root, active);
  try { return await work(); } finally { active.delete(key); }
}
export const aggregateKey = (entity: string, id: string) => `${entity}:${id}`;
export function isReplacing(ctx: Context, entity: string, id: string): boolean {
  return saving.get(contextRoot(ctx))?.has(aggregateKey(entity, id)) ?? false;
}
export function markReplacing(ctx: Context, entity: string, id: string, active: boolean): void {
  const root = contextRoot(ctx);
  const set = saving.get(root) ?? new Set<string>();
  if (active) set.add(aggregateKey(entity, id));
  else set.delete(aggregateKey(entity, id));
  saving.set(root, set);
}

/** Integrity checks intentionally use scope, not read row rules: invisible refs must not silently become valid. */
export async function validateReferences(ctx: Context, entity: EntityDef, row: Raw): Promise<void> {
  const ext = row.ext && typeof row.ext === 'object' ? row.ext as Raw : {};
  const refs = [...Object.entries(entity.config.fields).map(([field, fd]) => ({ field, fd, value: row[field] })),
    ...registry.extFields(entity.name).filter((d) => !d.source.startsWith('pack:') || ctx.appliedPacks?.includes(d.source.slice(5))).map((d) => ({ field: `ext.${d.key}`, fd: d.field, value: ext[d.key] }))];
  for (const { field, fd, value } of refs) {
    if (fd.kind !== 'ref' || !fd.ref || value === null || value === undefined) continue;
    const target = registry.entity(fd.ref);
    const found = await ctx.db.select({ id: target.col('id') }).from(target.table)
      .where(and(scopeCondition(ctx, target), eq(target.col('id'), value as string))).limit(1).for('key share');
    if (!found.length) throw new ValidationError(`${entity.name}.${field}: reference is outside the current scope or missing`, [{ path: field, message: 'reference must exist in the same tenant and company' }]);
  }
}

export interface ParentLock { entity: EntityDef; id: string; version: number; op: Op }

async function lockedParent(ctx: Context, entity: EntityDef, id: string, op: Op): Promise<Raw> {
  assertOp(ctx, entity, op);
  const rows = await ctx.db.select().from(entity.table).where(and(scopeCondition(ctx, entity), rowFilter(ctx, entity, op), eq(entity.col('id'), id))).limit(1).for('update');
  if (!rows[0]) throw new NotFound(entity.name, id);
  return rows[0] as Raw;
}

/** Lock parent before child. Every direct line mutation shares the document's serialization boundary. */
export async function lockParents(ctx: Context, entity: EntityDef, row: Raw, previous: Raw | undefined, operation: 'create' | 'update' | 'delete', input: Raw): Promise<ParentLock[]> {
  const owners = registry.allEntities().flatMap((doc) => (doc.doc?.lines ?? []).filter((l) => l.entity === entity.name).map((l) => ({ doc, field: l.parentField })));
  const locks: ParentLock[] = [];
  for (const { doc, field } of owners) {
    const ids = [...new Set([row[field], previous?.[field]].filter((v): v is string => typeof v === 'string'))].sort();
    for (const id of ids) {
      if (previous && row[field] !== previous[field]) throw new ValidationError('A line cannot be moved to another document', [{ path: field, message: 'create a new line under the other parent' }]);
      const lifecycle = lifecycles.get(contextRoot(ctx))?.get(aggregateKey(doc.name, id));
      const op = lifecycle ?? (operation === 'create' ? 'create' : 'update');
      const parent = await lockedParent(ctx, doc, id, op);
      const same = operation === 'update' && Object.keys(input).every((key) => JSON.stringify(input[key]) === JSON.stringify(previous?.[key]));
      const internal = parent.docstatus === DOCSTATUS.submitted && hasWriteCapability(ctx, entity.name, operation) && Object.keys(input).every((key) => ownsField(ctx, entity.name, key));
      if (parent.docstatus !== DOCSTATUS.draft && !same && !internal) throw new StateError(`${doc.name} ${id}: submitted/cancelled lines are frozen`, 'Use the owning module operation, or cancel and amend.');
      if (operation === 'create') {
        const total = await ctx.db.select({ n: count() }).from(entity.table).where(and(scopeCondition(ctx, entity), eq(entity.col(field), id)));
        if ((total[0]?.n ?? 0) >= MAX_LINES) throw new ValidationError(`${doc.name} exceeds ${MAX_LINES} lines`, [{ path: 'lines', message: `maximum ${MAX_LINES} lines` }]);
      }
      else if (await lineCount(ctx, entity, field, id) > MAX_LINES) throw new StateError(`${doc.name} exceeds ${MAX_LINES} lines`, 'Repair the oversized document before changing it.');
      locks.push({ entity: doc, id, version: parent.version as number, op });
    }
  }
  return locks;
}

export async function lineCount(ctx: Context, entity: EntityDef, parentField: string, id: string): Promise<number> {
  const rows = await ctx.db.select({ n: count() }).from(entity.table).where(and(scopeCondition(ctx, entity), eq(entity.col(parentField), id)));
  return rows[0]?.n ?? 0;
}

export async function assertAggregateLimit(ctx: Context, doc: EntityDef, id: string): Promise<void> {
  for (const spec of doc.doc?.lines ?? []) {
    if (await lineCount(ctx, registry.entity(spec.entity), spec.parentField, id) > MAX_LINES) throw new StateError(`${doc.name} exceeds ${MAX_LINES} lines`, 'Repair the oversized document before changing it.');
  }
}

/** If a module hook already recalculated the parent, do not increment again. */
export async function touchParents(ctx: Context, parents: ParentLock[]): Promise<void> {
  for (const parent of parents) {
    if (isReplacing(ctx, parent.entity.name, parent.id) || lifecycles.get(contextRoot(ctx))?.has(aggregateKey(parent.entity.name, parent.id))) continue;
    const entity = parent.entity;
    const latest = await lockedParent(ctx, entity, parent.id, parent.op);
    if (latest.version !== parent.version) continue;
    const updatedBy = ctx.actor.type === 'user' ? ctx.actor.id : ctx.actor.onBehalfOf ?? null;
    const rows = await ctx.db.update(entity.table).set({ version: parent.version + 1, updatedAt: ctx.now(), updatedBy })
      .where(and(scopeCondition(ctx, entity), eq(entity.col('id'), parent.id), eq(entity.col('version'), parent.version))).returning();
    if (!rows[0]) throw new Conflict('Aggregate was modified concurrently', 'Reload the parent document.');
    if (entity.audit === 'full') await writeAudit(ctx, entity.name, parent.id, 'update', snapshot(latest), snapshot(rows[0] as Raw));
  }
}
