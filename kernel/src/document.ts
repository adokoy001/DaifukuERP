// Document lifecycle (ADR-0006): submit / cancel / amend, dependency check, no-gap numbering.
import { and, eq } from 'drizzle-orm';
import type { Context } from './context.ts';
import type { EntityDef, Infer } from './dsl/entity.ts';
import { DOCSTATUS } from './dsl/types.ts';
import { Conflict, DependencyError, StateError, ValidationError } from './errors.ts';
import { isLocalDate, type LocalDate } from './ids.ts';
import { nextNumber } from './numbering.ts';
import { assertOp } from './permissions.ts';
import { registry } from './registry.ts';
import { getLines, lineSpecs, saveLines } from './lines.ts';
import { repo, type Repository } from './repository/repository.ts';
import { snapshot } from './repository/rows.ts';
import { DOCUMENT_WRITE } from './repository/authority.ts';
import { scopeCondition } from './repository/scope.ts';
import { assertAggregateLimit, duringLifecycle } from './repository/integrity.ts';

type Raw = Record<string, unknown>;
const STRIP_ON_COPY = new Set([
  'id',
  'tenantId',
  'companyId',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'version',
]);

/** Submitted documents in other entities that reference this record via a ref field. */
export async function findDependents(
  ctx: Context,
  entity: EntityDef,
  id: string,
): Promise<Array<{ entity: string; id: string }>> {
  const out: Array<{ entity: string; id: string }> = [];
  for (const other of registry.allEntities()) {
    if (other.kind !== 'document') continue;
    for (const [fname, fd] of Object.entries(other.config.fields)) {
      if (fd.kind !== 'ref' || fd.ref !== entity.name) continue;
      const rows = await ctx.db
        .select({ id: other.col('id') })
        .from(other.table)
        .where(
          and(scopeCondition(ctx, other), eq(other.col(fname), id), eq(other.col('docstatus'), DOCSTATUS.submitted)),
        )
        .limit(50);
      for (const r of rows) out.push({ entity: other.name, id: r.id as string });
    }
  }
  return out;
}

function businessDate(row: Raw): string {
  for (const key of ['date', 'postingDate', 'documentDate', 'transactionDate']) {
    const v = row[key];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  return new Date().toISOString().slice(0, 10);
}

async function runHooks(
  r: Repository<EntityDef>,
  phase: 'before_submit' | 'after_submit' | 'before_cancel' | 'after_cancel',
  row: Raw,
  previous: Raw,
  correctionDate?: LocalDate,
): Promise<void> {
  for (const h of registry.hooksFor(r.entity.name, phase))
    await h(r.ctx, { entity: r.entity.name, row, previous, ...(correctionDate ? { correctionDate } : {}) });
}

export async function submitDocument<E extends EntityDef>(
  ctx: Context,
  entity: E,
  id: string,
  opts: { expectedVersion?: number | undefined } = {},
): Promise<Infer<E>> {
  const named = Object.entries(entity.doc?.transitions ?? {}).filter(([, t]) => t.to === DOCSTATUS.submitted);
  if (named.length === 1) return transitionDocument(ctx, entity, id, named[0]?.[0] ?? '', opts);
  if (named.length)
    throw new StateError(
      `${entity.name} requires a named submission transition`,
      `Use one of: ${named.map(([name]) => name).join(', ')}`,
    );
  return performSubmit(ctx, entity, id, opts.expectedVersion);
}

async function performSubmit<E extends EntityDef>(
  ctx: Context,
  entity: E,
  id: string,
  expectedVersion?: number,
): Promise<Infer<E>> {
  const r = repo(ctx, entity);
  const before = await r.rawGet(id, 'submit', true);
  if (expectedVersion !== undefined && before.version !== expectedVersion)
    throw new Conflict('Document was modified before submission', 'Reload and retry.');
  if (before.docstatus !== DOCSTATUS.draft)
    throw new StateError(`${entity.name} ${id} is not a draft`, 'Only drafts can be submitted.', {
      docstatus: before.docstatus,
    });
  const cfg = entity.doc;
  if (!cfg) throw new StateError(`${entity.name} is not a document`, 'Only defineDocument entities can be submitted.');
  await assertAggregateLimit(ctx, entity, id);
  return duringLifecycle(ctx, entity.name, id, 'submit', async () => {
    const row: Raw = { ...before };
    await runHooks(r as Repository<EntityDef>, 'before_submit', row, before);
    const numbering = registry.override('document.numbering', nextNumber);
    const amended = typeof row.amendedFrom === 'string' ? await amendedNumber(ctx, entity, row.amendedFrom) : null;
    const number =
      amended ??
      (cfg.naming.type === 'field'
        ? String(row[cfg.naming.field] ?? '')
        : await numbering(ctx, { naming: cfg.naming, date: businessDate(row), entityName: entity.name }));
    if (!number)
      throw new StateError(`${entity.name} ${id}: number field is empty`, 'Set the number field before submit.');
    const updated = await r.rawUpdate(
      id,
      { ...row, docstatus: DOCSTATUS.submitted, number },
      'submit',
      before,
      DOCUMENT_WRITE,
    );
    await runHooks(r as Repository<EntityDef>, 'after_submit', updated, before);
    await ctx.emit(`${entity.name}.submitted`, { id, number });
    return r.get(id);
  });
}

export async function cancelDocument<E extends EntityDef>(
  ctx: Context,
  entity: E,
  id: string,
  opts: { expectedVersion?: number | undefined; correctionDate?: LocalDate | undefined } = {},
): Promise<Infer<E>> {
  const r = repo(ctx, entity);
  const before = await r.rawGet(id, 'cancel', true);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== before.version)
    throw new Conflict('Document was modified before cancellation', 'Reload and retry.');
  if (opts.correctionDate !== undefined && !isLocalDate(opts.correctionDate))
    throw new ValidationError('Invalid correction date', [{ path: 'correctionDate', message: 'must be YYYY-MM-DD' }]);
  if (before.docstatus !== DOCSTATUS.submitted)
    throw new StateError(`${entity.name} ${id} is not submitted`, 'Only submitted documents can be cancelled.', {
      docstatus: before.docstatus,
    });
  const dependents = await findDependents(ctx, entity, id);
  if (dependents.length > 0) throw new DependencyError(entity.name, id, dependents);
  const row: Raw = { ...before };
  await runHooks(r as Repository<EntityDef>, 'before_cancel', row, before, opts.correctionDate);
  const updated = await r.rawUpdate(id, { ...row, docstatus: DOCSTATUS.cancelled }, 'cancel', before, DOCUMENT_WRITE);
  await runHooks(r as Repository<EntityDef>, 'after_cancel', updated, before, opts.correctionDate);
  await ctx.emit(`${entity.name}.cancelled`, {
    id,
    number: before.number,
    ...(opts.correctionDate ? { correctionDate: opts.correctionDate } : {}),
  });
  return r.get(id);
}

/** ADR-0006: an amended document is numbered `<root>-<n>` where root is the original number and n counts amendments. */
async function amendedNumber(ctx: Context, entity: EntityDef, amendedFrom: string): Promise<string | null> {
  const r = repo(ctx, entity);
  // walk to the root of the amendment chain; its number is the root number
  let current = await r.rawGet(amendedFrom, 'read');
  for (let hops = 0; typeof current.amendedFrom === 'string' && hops < 100; hops++)
    current = await r.rawGet(current.amendedFrom, 'read');
  const root = typeof current.number === 'string' ? current.number : null;
  if (!root) return null;
  const siblings = await r.count({ number: { $like: `${root}-%` } });
  return `${root}-${siblings + 1}`;
}

/** Creates a new draft copied from a cancelled document (header and lines), numbered `<original>-<n>` at submit. */
export async function amendDocument<E extends EntityDef>(
  ctx: Context,
  entity: E,
  id: string,
  opts: { expectedVersion?: number | undefined } = {},
): Promise<Infer<E>> {
  assertOp(ctx, entity, 'amend');
  const r = repo(ctx, entity);
  const source = await r.rawGet(id, 'amend', true);
  if (opts.expectedVersion !== undefined && source.version !== opts.expectedVersion)
    throw new Conflict('Document was modified before amendment', 'Reload and retry.');
  if (source.docstatus !== DOCSTATUS.cancelled)
    throw new StateError(`${entity.name} ${id} is not cancelled`, 'Only cancelled documents can be amended.', {
      docstatus: source.docstatus,
    });
  const copy: Raw = {};
  for (const name of entity.fieldNames) if (!entity.config.fields[name]?.opts.serverOwned) copy[name] = source[name];
  if (entity.hasExt && source.ext !== null && source.ext !== undefined) copy.ext = source.ext;
  const created = await r.create(copy as never);
  if (lineSpecs(entity).length > 0) {
    const lines = await getLines(ctx, entity, id);
    const stripped = Object.fromEntries(
      Object.entries(lines).map(([name, rows]) => [
        name,
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([k, v]) =>
                !STRIP_ON_COPY.has(k) &&
                !registry.entity(name).config.fields[k]?.opts.serverOwned &&
                !(k === 'ext' && v === null),
            ),
          ),
        ),
      ]),
    );
    await saveLines(ctx, entity, created.id, stripped);
  }
  const raw = await r.rawGet(created.id, 'read');
  const updated = await r.rawUpdate(created.id, { ...raw, amendedFrom: id }, 'amend', raw, DOCUMENT_WRITE);
  ctx.log.info('document amended', {
    entity: entity.name,
    from: id,
    to: created.id,
    snapshot: snapshot({ number: source.number }),
  });
  return r.toDomainRow(updated);
}

/** Runs a named transition declared in the document config (approval flows). */
export async function transitionDocument<E extends EntityDef>(
  ctx: Context,
  entity: E,
  id: string,
  transition: string,
  opts: { expectedVersion?: number | undefined } = {},
): Promise<Infer<E>> {
  const cfg = entity.doc;
  const t = cfg?.transitions?.[transition];
  if (!t)
    throw new StateError(
      `unknown transition "${transition}" on ${entity.name}`,
      `Declared transitions: ${Object.keys(cfg?.transitions ?? {}).join(', ') || 'none'}`,
    );
  if (t.roles && !t.roles.some((role) => ctx.roles.includes(role)) && !ctx.roles.includes('admin')) {
    throw new StateError(
      `transition "${transition}" requires roles [${t.roles.join(', ')}]`,
      'Use a context with one of those roles.',
    );
  }
  const r = repo(ctx, entity);
  const before = await r.rawGet(id, 'update', true);
  if (opts.expectedVersion !== undefined && before.version !== opts.expectedVersion)
    throw new Conflict('Document was modified before transition', 'Reload and retry.');
  if (before.docstatus !== t.from)
    throw new StateError(
      `${entity.name} ${id} is in docstatus ${before.docstatus}, transition expects ${t.from}`,
      'Check the document state.',
    );
  if (t.guard && !(await registry.guard(t.guard)(ctx, before)))
    throw new StateError(
      `guard "${t.guard}" rejected transition "${transition}"`,
      'The document does not satisfy the guard condition.',
    );
  if (t.to === DOCSTATUS.submitted) return performSubmit(ctx, entity, id);
  if (t.to === DOCSTATUS.cancelled) return cancelDocument(ctx, entity, id);
  throw new StateError(
    'Returning a document to draft requires amend',
    'Cancel and amend instead of changing its lifecycle backwards.',
  );
}
