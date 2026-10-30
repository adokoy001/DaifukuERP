// AC-5 (docs/specs/evidence-search.md): what each evidence row links to, read with the caller's Context. One
// Repository.list per linked entity on the page (limit = the ids asked for), so read permission, row rules, company/
// site/store scope and field masks of the linked entity apply; anything the caller cannot see is `readable: false`
// without saying why. A link to a document line stands for its document (as the related-records reader does).
// Only kernel public API: registry, repo, can, maskedFields and the entity definitions.
import { can, isUuid, maskedFields, registry, repo, type Context, type EntityDef } from '@daifuku/kernel';
import type { LinkedKind, LinkedSummary } from './evidence.ts';

type Raw = Record<string, unknown>;

export interface LinkRef {
  /** Attachment id. */
  id: string;
  linkedEntity: string | null;
  linkedId: string | null;
}

/** line entity name -> its document and the line's parent field. */
export function lineParents(): Map<string, { parent: EntityDef; parentField: string }> {
  const out = new Map<string, { parent: EntityDef; parentField: string }>();
  for (const doc of registry.allEntities())
    for (const line of doc.doc?.lines ?? [])
      if (registry.hasEntity(line.entity)) out.set(line.entity, { parent: doc, parentField: line.parentField });
  return out;
}

/** How a linked entity is shown: a registered document, a line of one, a plain entity, or unknown. */
export function linkKindOf(entity: string, parents: ReadonlyMap<string, unknown>): LinkedKind {
  if (!registry.hasEntity(entity)) return 'unknown';
  if (parents.has(entity)) return 'line';
  return registry.entity(entity).kind === 'document' ? 'document' : 'entity';
}

/** The caller may read every named field: not masked by a field group and not output-hidden. */
export function fieldsReadable(ctx: Pick<Context, 'roles'>, entity: EntityDef, names: readonly string[]): boolean {
  const masked = maskedFields(ctx, entity);
  return names.every((n) => !masked.has(n) && !entity.config.fields[n]?.opts.outputHidden);
}

/** The caller may list the entity here (read permission; company-scoped entities only inside a company). */
function listable(ctx: Context, entity: EntityDef): boolean {
  return (entity.scope === 'tenant' || Boolean(ctx.companyId)) && can(ctx, entity, 'read');
}

/** Display title, number and status of a visible row (title null when the display field is masked or hidden). */
export function describeRow(
  ctx: Pick<Context, 'roles'>,
  entity: EntityDef,
  row: Raw,
): Pick<LinkedSummary, 'title' | 'number' | 'docstatus'> {
  const df = entity.displayField;
  const raw = df && fieldsReadable(ctx, entity, [df]) ? row[df] : undefined;
  const title = typeof raw === 'string' && raw !== '' ? raw : typeof raw === 'number' ? String(raw) : null;
  const isDoc = entity.kind === 'document';
  return {
    title,
    number: isDoc && typeof row.number === 'string' && row.number !== '' ? row.number : null,
    docstatus: isDoc && typeof row.docstatus === 'number' ? row.docstatus : null,
  };
}

export function unreadable(entity: string, id: string, kind: LinkedKind): LinkedSummary {
  return { entity, id, kind, readable: false, target: null, title: null, number: null, docstatus: null };
}

/** Rows of `entity` with these ids that the caller may see (at most ids.length, which is at most one page). */
async function visibleRows(ctx: Context, entity: EntityDef, ids: readonly string[]): Promise<Map<string, Raw>> {
  const out = new Map<string, Raw>();
  const wanted = [...new Set(ids.filter(isUuid))];
  if (wanted.length === 0 || !listable(ctx, entity)) return out;
  const res = await repo(ctx, entity).list({ where: { id: { $in: wanted } }, limit: wanted.length });
  for (const row of res.items as Raw[]) out.set(row.id as string, row);
  return out;
}

/** Summaries of every linked record of the page, keyed by attachment id (null when the attachment has no link). */
export async function linkedSummaries(
  ctx: Context,
  refs: readonly LinkRef[],
): Promise<Map<string, LinkedSummary | null>> {
  const out = new Map<string, LinkedSummary | null>();
  const byEntity = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref.linkedEntity || !ref.linkedId) {
      out.set(ref.id, null);
      continue;
    }
    const ids = byEntity.get(ref.linkedEntity) ?? new Set<string>();
    ids.add(ref.linkedId);
    byEntity.set(ref.linkedEntity, ids);
  }
  const parents = lineParents();
  /** entity -> linked id -> summary */
  const summaries = new Map<string, Map<string, LinkedSummary>>();
  for (const [name, idSet] of byEntity) {
    const ids = [...idSet];
    const kind = linkKindOf(name, parents);
    const found = new Map<string, LinkedSummary>();
    summaries.set(name, found);
    if (kind === 'unknown') continue;
    const entity = registry.entity(name);
    const rows = await visibleRows(ctx, entity, ids);
    if (kind !== 'line') {
      for (const [id, row] of rows)
        found.set(id, {
          entity: name,
          id,
          kind,
          readable: true,
          target: { entity: name, id },
          ...describeRow(ctx, entity, row),
        });
      continue;
    }
    const parent = parents.get(name);
    if (!parent || !fieldsReadable(ctx, entity, [parent.parentField])) continue;
    const docOf = new Map<string, string>();
    for (const [id, row] of rows) {
      const docId = row[parent.parentField];
      if (typeof docId === 'string' && isUuid(docId)) docOf.set(id, docId);
    }
    const docs = await visibleRows(ctx, parent.parent, [...docOf.values()]);
    for (const [lineId, docId] of docOf) {
      const doc = docs.get(docId);
      if (!doc) continue;
      found.set(lineId, {
        entity: name,
        id: lineId,
        kind,
        readable: true,
        target: { entity: parent.parent.name, id: docId },
        ...describeRow(ctx, parent.parent, doc),
      });
    }
  }
  for (const ref of refs) {
    if (!ref.linkedEntity || !ref.linkedId) continue;
    const summary = summaries.get(ref.linkedEntity)?.get(ref.linkedId);
    out.set(ref.id, summary ?? unreadable(ref.linkedEntity, ref.linkedId, linkKindOf(ref.linkedEntity, parents)));
  }
  return out;
}
