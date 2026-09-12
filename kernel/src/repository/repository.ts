// Generic repository: the single path for reads and writes (ADR-0007). Applies scope, permissions,
// validation, hooks, optimistic locking, audit and document-state rules.
import { and, count, eq, type SQL } from 'drizzle-orm';
import { writeAudit } from '../audit.ts';
import type { Context } from '../context.ts';
import type { EntityDef, Infer, InsertInput, UpdateInput } from '../dsl/entity.ts';
import { DOCSTATUS, type Op } from '../dsl/types.ts';
import { Conflict, NotFound, StateError, ValidationError } from '../errors.ts';
import { validateExt } from '../ext.ts';
import { newId, todayLocal } from '../ids.ts';
import { assertOp, assertWritableFields, maskedFields, rowFilter } from '../permissions.ts';
import { registry, type HookPhase } from '../registry.ts';
import { aggregate, type AggregateQuery, type AggregateRow } from './aggregate.ts';
import { combine, DEFAULT_LIMIT, MAX_LIMIT, orderClauses, searchCondition, whereCondition, type ListQuery } from './query.ts';
import { changedKeys, fromDb, snapshot, toDb } from './rows.ts';
import { scopeCondition } from './scope.ts';
import { assertOwnedInput } from './ownership.ts';
import { lockParents, touchParents, validateReferences } from './integrity.ts';
import { DOCUMENT_WRITE } from './authority.ts';
import { assertStoreWrite } from '../store-access.ts';

export interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

type Raw = Record<string, unknown>;
const BOOKKEEPING = new Set(['updatedAt', 'updatedBy', 'version']);

export class Repository<E extends EntityDef> {
  constructor(
    readonly ctx: Context,
    readonly entity: E,
  ) {}

  // ---- reads ---------------------------------------------------------------------------------

  private visibility(op: Op): SQL {
    return combine(scopeCondition(this.ctx, this.entity), rowFilter(this.ctx, this.entity, op)) as SQL;
  }

  private async rawById(id: string, op: Op, lock = false): Promise<Raw | null> {
    const query = this.ctx.db
      .select()
      .from(this.entity.table)
      .where(combine(this.visibility(op), eq(this.entity.col('id'), id)))
      .limit(1);
    const rows = await (lock ? query.for('update') : query);
    return (rows[0] as Raw | undefined) ?? null;
  }

  private toDomain(raw: Raw): Infer<E> {
    return fromDb(this.entity, raw, maskedFields(this.ctx, this.entity)) as Infer<E>;
  }

  async find(id: string): Promise<Infer<E> | null> {
    assertOp(this.ctx, this.entity, 'read');
    const raw = await this.rawById(id, 'read');
    return raw ? this.toDomain(raw) : null;
  }

  async get(id: string): Promise<Infer<E>> {
    const row = await this.find(id);
    if (!row) throw new NotFound(this.entity.name, id);
    return row;
  }

  /** Latest row locked until transaction end; caller must read business inputs only after this call. */
  async lock(id: string, op: Op = 'update'): Promise<Infer<E>> {
    return this.toDomain(await this.rawGet(id, op, true));
  }

  /** Increment an aggregate version without running business recalculation recursively. */
  async touch(id: string, expectedVersion?: number): Promise<void> {
    const before = await this.rawGet(id, 'update', true);
    this.assertVersion(id, before, expectedVersion);
    await this.rawUpdate(id, {}, 'update', before, DOCUMENT_WRITE);
  }

  async list(q: ListQuery = {}): Promise<ListResult<Infer<E>>> {
    assertOp(this.ctx, this.entity, 'read');
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = q.offset ?? 0;
    const cond = combine(this.visibility('read'), whereCondition(this.ctx, this.entity, q.where), searchCondition(this.ctx, this.entity, q.search));
    const rows = await this.ctx.db
      .select()
      .from(this.entity.table)
      .where(cond)
      .orderBy(...orderClauses(this.entity, q.orderBy, this.ctx))
      .limit(limit)
      .offset(offset);
    const totalRows = await this.ctx.db.select({ n: count() }).from(this.entity.table).where(cond);
    return { items: (rows as Raw[]).map((r) => this.toDomain(r)), total: totalRows[0]?.n ?? 0, limit, offset };
  }

  /** Grouped sums/counts with the same visibility as list() (the `report` port). */
  aggregate(q: AggregateQuery): Promise<AggregateRow[]> {
    return aggregate(this.ctx, this.entity, q);
  }

  async count(where?: ListQuery['where']): Promise<number> {
    assertOp(this.ctx, this.entity, 'read');
    const cond = combine(this.visibility('read'), whereCondition(this.ctx, this.entity, where));
    const rows = await this.ctx.db.select({ n: count() }).from(this.entity.table).where(cond);
    return rows[0]?.n ?? 0;
  }

  // ---- writes ----------------------------------------------------------------------------------

  private async runHooks(phase: HookPhase, row: Raw, previous?: Raw): Promise<void> {
    for (const h of registry.hooksFor(this.entity.name, phase)) await h(this.ctx, previous ? { entity: this.entity.name, row, previous } : { entity: this.entity.name, row });
  }

  /** Entity schema first (definition-time), then registered ext fields (ADR-0014; registered later by packs). */
  private parse(schema: 'insert' | 'update', input: unknown): Raw {
    const result = this.entity.schemas[schema].safeParse(input);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
      throw new ValidationError(`${this.entity.name}: invalid ${schema} input`, issues);
    }
    const values = result.data as Raw;
    const ext = validateExt(this.entity, values.ext, schema, this.ctx.appliedPacks ?? []);
    if (ext !== undefined) values.ext = ext;
    return values;
  }

  async create(input: InsertInput<E>): Promise<Infer<E>> {
    const e = this.entity;
    assertOp(this.ctx, e, 'create');
    const draft: Raw = { ...(input as Raw) };
    assertOwnedInput(this.ctx, e, draft, 'create');
    await this.runHooks('before_validate', draft);
    const values = this.parse('insert', draft);
    assertWritableFields(this.ctx, e, Object.keys(values));
    this.applyDefaults(values);
    const now = this.ctx.now();
    const row: Raw = {
      ...values,
      id: newId(),
      tenantId: this.ctx.tenantId,
      ...(e.scope === 'company' ? { companyId: this.ctx.companyId } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: this.actorUserId(),
      updatedBy: this.actorUserId(),
      version: 1,
      ...(e.kind === 'document' ? { docstatus: DOCSTATUS.draft, number: null, amendedFrom: null } : {}),
    };
    if (e.scope === 'company' && !this.ctx.companyId) throw new StateError(`${e.name} requires a company context`, 'Select a company (companyId) in the context.');
    await this.runHooks('before_create', row);
    await assertStoreWrite(this.ctx, e, row);
    const parents = await lockParents(this.ctx, e, row, undefined, 'create', draft);
    await validateReferences(this.ctx, e, row);
    const inserted = await this.withConstraintErrors(() => this.ctx.db.insert(e.table).values(toDb(row) as never).returning());
    const created = inserted[0] as Raw;
    await this.runHooks('after_create', created);
    await touchParents(this.ctx, parents);
    if (e.audit === 'full') await writeAudit(this.ctx, e.name, created.id as string, 'create', null, snapshot(created));
    return this.toDomain(created);
  }

  async update(id: string, patch: UpdateInput<E>, opts: { expectedVersion?: number } = {}): Promise<Infer<E>> {
    const e = this.entity;
    assertOp(this.ctx, e, 'update');
    const initial = await this.rawById(id, 'update');
    if (!initial) throw new NotFound(e.name, id);
    assertOwnedInput(this.ctx, e, patch as Raw, 'update', initial);
    const parents = await lockParents(this.ctx, e, { ...initial, ...patch }, initial, 'update', patch as Raw);
    const before = await this.rawById(id, 'update', true);
    if (!before) throw new NotFound(e.name, id);
    this.assertVersion(id, before, opts.expectedVersion);
    const draft: Raw = { ...(patch as Raw) };
    await this.runHooks('before_validate', draft, before);
    const values = this.parse('update', draft);
    const keys = Object.keys(values);
    assertWritableFields(this.ctx, e, keys);
    this.assertUpdatable(before, values);
    const merged: Raw = { ...before, ...values, updatedAt: this.ctx.now(), updatedBy: this.actorUserId(), version: (before.version as number) + 1 };
    await this.runHooks('before_update', merged, before);
    await assertStoreWrite(this.ctx, e, merged);
    await validateReferences(this.ctx, e, merged);
    const rows = await this.withConstraintErrors(() =>
      this.ctx.db
        .update(e.table)
        .set(toDb(merged) as never)
        .where(and(eq(e.col('id'), id), eq(e.col('version'), before.version as number)))
        .returning(),
    );
    const updated = rows[0] as Raw | undefined;
    if (!updated) throw new Conflict(`${e.name} ${id} was modified concurrently`, 'Reload the record and reapply your change.');
    await this.runHooks('after_update', updated, before);
    await touchParents(this.ctx, parents);
    if (e.audit === 'full') {
      const changed = changedKeys(fromDb(e, before, new Set()), fromDb(e, updated, new Set())).filter((k) => !BOOKKEEPING.has(k));
      const pick = (r: Raw) => Object.fromEntries(changed.map((k) => [k, r[k]]));
      await writeAudit(this.ctx, e.name, id, 'update', snapshot(pick(before)), snapshot(pick(updated)));
    }
    return this.toDomain(updated);
  }

  async delete(id: string, opts: { expectedVersion?: number | undefined } = {}): Promise<void> {
    const e = this.entity;
    assertOp(this.ctx, e, 'delete');
    const initial = await this.rawById(id, 'delete');
    if (!initial) throw new NotFound(e.name, id);
    const parents = await lockParents(this.ctx, e, initial, initial, 'delete', {});
    const before = await this.rawById(id, 'delete', true);
    if (!before) throw new NotFound(e.name, id);
    this.assertVersion(id, before, opts.expectedVersion);
    if (e.kind === 'document' && before.docstatus !== DOCSTATUS.draft) {
      throw new StateError(`${e.name} ${id} is not a draft and cannot be deleted`, 'Cancel the document instead (ADR-0006).', { docstatus: before.docstatus });
    }
    await this.runHooks('before_delete', before);
    await this.withConstraintErrors(() => this.ctx.db.delete(e.table).where(and(this.visibility('delete'), eq(e.col('id'), id), eq(e.col('version'), before.version as number))));
    await this.runHooks('after_delete', before);
    await touchParents(this.ctx, parents);
    if (e.audit === 'full') await writeAudit(this.ctx, e.name, id, 'delete', snapshot(before), null);
  }

  /** Internal: used by document operations after their own checks. */
  async rawUpdate(id: string, values: Raw, op: string, before: Raw, authority?: symbol): Promise<Raw> {
    const e = this.entity;
    if (authority !== DOCUMENT_WRITE) throw new StateError('rawUpdate is reserved for kernel lifecycle operations', 'Use Repository.update with explicit field ownership.');
    await validateReferences(this.ctx, e, values);
    const merged: Raw = { ...values, updatedAt: this.ctx.now(), updatedBy: this.actorUserId(), version: (before.version as number) + 1 };
    const rows = await this.ctx.db
      .update(e.table)
      .set(toDb(merged) as never)
      .where(and(scopeCondition(this.ctx, e), eq(e.col('id'), id), eq(e.col('version'), before.version as number)))
      .returning();
    const updated = rows[0] as Raw | undefined;
    if (!updated) throw new Conflict(`${e.name} ${id} was modified concurrently`, 'Reload the record and retry.');
    if (e.audit === 'full') await writeAudit(this.ctx, e.name, id, op, snapshot(before), snapshot(updated));
    return updated;
  }

  async rawGet(id: string, op: Op, lock = false): Promise<Raw> {
    assertOp(this.ctx, this.entity, op);
    const raw = await this.rawById(id, op, lock);
    if (!raw) throw new NotFound(this.entity.name, id);
    return raw;
  }

  toDomainRow(raw: Raw): Infer<E> {
    return this.toDomain(raw);
  }

  // ---- helpers ---------------------------------------------------------------------------------

  private assertVersion(id: string, before: Raw, version: number | undefined): void {
    if (version !== undefined && (!Number.isInteger(version) || version < 1 || before.version !== version)) {
      throw new Conflict(`${this.entity.name} ${id} was modified (version ${before.version}, expected ${version})`, 'Reload the record and reapply your change.', { version: before.version });
    }
  }

  /** Maps PostgreSQL constraint violations to Conflict / ValidationError (docs/conventions/errors.md). */
  private async withConstraintErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const pg = (err as { cause?: { code?: string; constraint_name?: string; detail?: string } }).cause ?? (err as { code?: string; constraint_name?: string; detail?: string });
      if (pg?.code === '23505') {
        throw new Conflict(`${this.entity.name}: duplicate value violates unique constraint ${pg.constraint_name ?? ''}`.trim(), 'A record with the same unique value already exists. Change the value or update the existing record.', { constraint: pg.constraint_name, detail: pg.detail });
      }
      if (pg?.code === '23503') {
        throw new ValidationError(`${this.entity.name}: referenced record does not exist or is still referenced (${pg.constraint_name ?? ''})`.trim(), [{ path: pg.constraint_name ?? 'ref', message: 'foreign key violation' }], 'Check that referenced ids exist and that no submitted document still references this record.');
      }
      throw err;
    }
  }

  private actorUserId(): string | null {
    const a = this.ctx.actor;
    if (a.type === 'user') return a.id;
    if (a.type === 'agent') return a.onBehalfOf ?? null;
    return null;
  }

  private applyDefaults(values: Raw): void {
    for (const [name, fd] of Object.entries(this.entity.config.fields)) {
      if (values[name] !== undefined) continue;
      const d = (fd.opts as { default?: unknown }).default;
      if (d === undefined) continue;
      if (fd.kind === 'timestamp' && d === 'now') values[name] = this.ctx.now();
      else if (fd.kind === 'date' && d === 'today') values[name] = todayLocal(this.ctx.now());
      else if (fd.kind === 'uuid' && d === 'new') values[name] = newId();
      else values[name] = d;
    }
  }

  private assertUpdatable(before: Raw, values: Raw): void {
    const e = this.entity;
    const keys = Object.keys(values);
    for (const k of keys) {
      const fd = e.config.fields[k];
      if (fd?.opts.immutable && k in before) {
        throw new ValidationError(`${e.name}.${k} is immutable`, [{ path: k, message: 'immutable field' }], 'Create a new record instead of changing this field.');
      }
    }
    if (e.kind !== 'document') return;
    const status = before.docstatus as number;
    if (status === DOCSTATUS.cancelled) throw new StateError(`${e.name} is cancelled and read-only`, 'Amend it to create an editable new version (ADR-0006).');
    if (status === DOCSTATUS.submitted) {
      const allowed = new Set<string>(e.doc?.allowOnSubmit ?? []);
      if (values.ext && typeof values.ext === 'object') {
        const prior = (before.ext ?? {}) as Raw;
        const next = values.ext as Raw;
        const changed = [...new Set([...Object.keys(prior), ...Object.keys(next)])].filter((key) => JSON.stringify(prior[key]) !== JSON.stringify(next[key]));
        if (changed.every((key) => allowed.has(`ext.${key}`))) allowed.add('ext');
      }
      const blocked = keys.filter((k) => !allowed.has(k));
      if (blocked.length > 0) {
        throw new StateError(`${e.name} is submitted; fields [${blocked.join(', ')}] cannot change`, 'Cancel and amend the document, or declare the field in allowOnSubmit.', { blocked });
      }
    }
  }
}

export function repo<E extends EntityDef>(ctx: Context, entity: E): Repository<E> {
  return new Repository(ctx, entity);
}
