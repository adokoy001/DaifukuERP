// Document lines (伝票明細): child entities declared in `defineDocument({ lines })`. Lines are ordinary
// entities with a ref back to the parent; this module adds replace-all save semantics and parent-state rules.
import type { Context } from './context.ts';
import type { EntityDef } from './dsl/entity.ts';
import { DOCSTATUS } from './dsl/types.ts';
import { PermissionDenied, StateError, ValidationError } from './errors.ts';
import { registry } from './registry.ts';
import { repo } from './repository/repository.ts';
import { isReplacing, markReplacing, MAX_LINES, lineCount } from './repository/integrity.ts';
import { isUuid } from './ids.ts';

type Raw = Record<string, unknown>;
/** lineEntityName -> rows (each may carry `id` to update an existing line) */
export type LinesInput = Record<string, Raw[]>;
export type LinesResult = Record<string, Raw[]>;

export interface LineSpec {
  entity: EntityDef;
  parentField: string;
}

/** Bookkeeping columns a caller may echo back from a get; never written through a line payload. */
const SYSTEM_KEYS = ['tenantId', 'companyId', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'] as const;

export function lineSpecs(doc: EntityDef): LineSpec[] {
  return (doc.doc?.lines ?? []).map((l) => {
    const entity = registry.entity(l.entity);
    const fd = entity.config.fields[l.parentField];
    if (!fd || fd.kind !== 'ref' || fd.ref !== doc.name) {
      throw new Error(`document ${doc.name}: line entity ${l.entity}.${l.parentField} must be a ref to ${doc.name}`);
    }
    return { entity, parentField: l.parentField };
  });
}

function orderFor(line: EntityDef): { field: string; dir: 'asc' }[] {
  return 'seq' in line.config.fields ? [{ field: 'seq', dir: 'asc' }] : [{ field: 'createdAt', dir: 'asc' }];
}

/** All line sets of a document, ordered by `seq` when the line entity has one. */
export async function getLines(ctx: Context, doc: EntityDef, id: string): Promise<LinesResult> {
  await repo(ctx, doc).rawGet(id, 'read');
  const out: LinesResult = {};
  for (const { entity, parentField } of lineSpecs(doc)) {
    const res = await repo(ctx, entity).list({ where: { [parentField]: id }, orderBy: orderFor(entity), limit: 500 });
    if (res.total !== (await lineCount(ctx, entity, parentField, id)))
      throw new PermissionDenied(doc.name, 'read-all-lines', ctx.roles);
    if (res.total > MAX_LINES)
      throw new StateError(
        `${doc.name} has more than ${MAX_LINES} lines`,
        'Repair the oversized document before reading or changing it.',
      );
    out[entity.name] = res.items as Raw[];
  }
  return out;
}

// ---- saveLines in progress (ADR-0014) ---------------------------------------------------------------

/**
 * True while `saveLines` is replacing the lines of document `id` in this context. Line-level hooks that recalculate the
 * parent use it to skip per-line work: `after_lines_saved` recalculates once when the save ends. Direct line writes
 * (outside saveLines) still see false.
 */
export function isSavingLines(ctx: Context, document: string, id: string): boolean {
  return isReplacing(ctx, document, id);
}

async function replaceLineSet(ctx: Context, spec: LineSpec, id: string, incoming: Raw[]): Promise<Raw[]> {
  const { entity, parentField } = spec;
  const r = repo(ctx, entity);
  const listed = await r.list({ where: { [parentField]: id }, limit: MAX_LINES });
  if (listed.total !== (await lineCount(ctx, entity, parentField, id)))
    throw new PermissionDenied(entity.name, 'replace-all-lines', ctx.roles);
  if (listed.total > MAX_LINES)
    throw new StateError('Oversized line set cannot be replaced', 'Repair the existing document first.');
  const existing = listed.items as Raw[];
  const supplied = new Set(incoming.flatMap((row) => (typeof row.id === 'string' ? [row.id] : [])));
  if (supplied.size !== incoming.filter((row) => row.id !== undefined).length)
    throw new ValidationError('duplicate line id', [{ path: 'lines', message: 'each line id must be unique' }]);
  for (const lineId of supplied)
    if (!existing.some((e) => e.id === lineId))
      throw new ValidationError('line does not belong to this document', [
        { path: 'lines.id', message: 'unknown or foreign line id' },
      ]);
  // Remove absent rows first so a valid 500-row replacement never temporarily exceeds the invariant.
  for (const old of existing) if (!supplied.has(old.id as string)) await r.delete(old.id as string);
  const hasSeq = 'seq' in entity.config.fields;
  let i = 0;
  for (const row of incoming) {
    const { id: lineId, ...values } = row;
    const payload: Raw = {
      ...values,
      [parentField]: id,
      ...(hasSeq && values.seq === undefined ? { seq: i + 1 } : {}),
    };
    for (const k of SYSTEM_KEYS) delete payload[k];
    if (typeof lineId === 'string' && existing.some((e) => e.id === lineId)) {
      await r.update(lineId, payload as never);
    } else {
      await r.create(payload as never);
    }
    i++;
  }
  return (await r.list({ where: { [parentField]: id }, orderBy: orderFor(entity), limit: 500 })).items as Raw[];
}

/** AC-6: once per saveLines, with the parent re-read before each hook (an earlier hook may have updated it). */
async function fireLinesSaved(ctx: Context, doc: EntityDef, id: string): Promise<void> {
  const hooks = registry.hooksFor(doc.name, 'after_lines_saved');
  if (hooks.length === 0) return;
  const lines = await getLines(ctx, doc, id);
  const r = repo(ctx, doc);
  for (const h of hooks) await h(ctx, { entity: doc.name, row: await r.rawGet(id, 'update'), lines });
}

/**
 * Replace-all save: rows with an `id` are updated, rows without are created, existing rows not present are deleted.
 * Refuses when the parent is not a draft (ADR-0006). `seq` is assigned from array order when the entity has it.
 * Fires the document's `after_lines_saved` hooks once at the end (ADR-0014).
 */
export async function saveLines(ctx: Context, doc: EntityDef, id: string, lines: LinesInput): Promise<LinesResult> {
  if (!lines || typeof lines !== 'object' || Array.isArray(lines))
    throw new ValidationError('invalid lines', [{ path: 'lines', message: 'object required' }]);
  const specs = lineSpecs(doc);
  for (const key of Object.keys(lines)) {
    if (!specs.some((s) => s.entity.name === key)) {
      throw new ValidationError(
        `${doc.name} has no line entity "${key}"`,
        [{ path: `lines.${key}`, message: 'unknown line entity' }],
        `Declared line entities: ${specs.map((s) => s.entity.name).join(', ')}`,
      );
    }
    const rows = lines[key];
    if (
      !Array.isArray(rows) ||
      rows.length > MAX_LINES ||
      rows.some(
        (r) =>
          !r ||
          typeof r !== 'object' ||
          Array.isArray(r) ||
          (r.id !== undefined && (typeof r.id !== 'string' || !isUuid(r.id))),
      )
    ) {
      throw new ValidationError('invalid line set', [
        { path: `lines.${key}`, message: `array of at most ${MAX_LINES} rows with valid ids required` },
      ]);
    }
  }
  const r = repo(ctx, doc);
  const parent = await r.rawGet(id, 'update', true);
  if (parent.docstatus !== DOCSTATUS.draft) {
    throw new StateError(
      `${doc.name} ${id} is not a draft; lines are frozen`,
      'Cancel and amend the document to change its lines.',
      { docstatus: parent.docstatus },
    );
  }
  const out: LinesResult = {};
  markReplacing(ctx, doc.name, id, true);
  try {
    for (const spec of specs) {
      const incoming = lines[spec.entity.name];
      if (incoming !== undefined) out[spec.entity.name] = await replaceLineSet(ctx, spec, id, incoming);
    }
  } finally {
    markReplacing(ctx, doc.name, id, false);
  }
  await fireLinesSaved(ctx, doc, id);
  if ((await r.rawGet(id, 'update')).version === parent.version) await r.touch(id);
  return out;
}
