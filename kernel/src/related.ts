// Related records of one record (document-links AC-2/AC-3): what it references and what references it, grouped by
// entity, at most RELATED_LIMIT per entity. Links come from the registry only: `ref` fields, the `<x>Entity` + `<x>Id`
// pair convention (polymorphic links such as journal_entry.sourceEntity/sourceId and payment_allocation.invoiceEntity/
// invoiceId), document lines (their links count as the document's; a line that references the record, or one of the
// record's lines, is reported as its parent document, and a link to another document's line as that document) and the
// amendedFrom chain. Every read goes through Repository with the caller's Context, so read permission, row rules,
// company/site/store scope and field masks apply per related entity; an entity the caller cannot read, or whose linking
// field is masked for the caller, is left out entirely (no group, no count).
//
// The pair convention is inferred from field names, and the kernel does not check the pair on write the way it checks a
// `ref`. A new `<x>Entity` + `<x>Id` pair must therefore be serverOwned or validated on write (the target entity is
// registered and the record is visible to the writer, as attachments' assertLinkTarget does); otherwise anyone who may
// create the source could add made-up "referenced by" entries to any record whose id they know.
// apps/api/test/related.db.test.ts pins the reviewed pairs.
import type { Context } from './context.ts';
import type { EntityDef } from './dsl/entity.ts';
import type { Domain } from './dsl/types.ts';
import type { Label } from './i18n.ts';
import { isUuid } from './ids.ts';
import { can, maskedFields } from './permissions.ts';
import { outputHiddenFields, publicOutput } from './public-output.ts';
import { registry } from './registry.ts';
import { repo } from './repository/repository.ts';

/** Items returned per related entity. */
export const RELATED_LIMIT = 50;
/** Line rows read per lookup (the kernel's per-document line maximum). */
const LINE_SCAN = 500;
/** Hops followed along an amendedFrom chain in each direction. */
const CHAIN_HOPS = 50;

/**
 * How an item relates to the requested record: it is referenced by the record (`references`), it references the record
 * (`referenced_by`), or it is an earlier (`amended_from`) / later (`amendment`) version in the record's amendment chain.
 */
export type RelatedRelation = 'references' | 'referenced_by' | 'amended_from' | 'amendment';

export interface RelatedItem {
  id: string;
  /** The entity's display field when the caller may read it, else null. */
  title: string | null;
  /** Document number (null for drafts and plain entities). */
  number: string | null;
  /** Document status 0/1/2; null for plain entities. */
  docstatus: number | null;
  /** Business date: the `date` field, else the first date field the caller may read; null when there is none. */
  date: string | null;
  relation: RelatedRelation;
  /** The linking field: `journalEntryId`, `amendedFrom`, or `<line entity>.<field>` for links held by lines. */
  via: string;
}

export interface RelatedGroup {
  entity: string;
  label: Label;
  kind: 'entity' | 'document';
  items: RelatedItem[];
  /**
   * True when more than RELATED_LIMIT records matched (only the first RELATED_LIMIT are returned). A hint, possibly
   * conservative: when more than 500 lines reference the record, it is set without checking that the remaining lines
   * belong to documents the caller may read.
   */
  more: boolean;
}

export interface RelatedResult {
  entity: string;
  id: string;
  groups: RelatedGroup[];
}

type Raw = Record<string, unknown>;

/** One link a source entity can hold: `idField` names the target id; `entityField` (polymorphic) the target entity. */
export interface LinkSpec {
  idField: string;
  entityField?: string;
  /** Target entity names; `any` for a free-text entity field. */
  targets: readonly string[] | 'any';
}

const ENTITY_SUFFIX = 'Entity';
const ID_SUFFIX = 'Id';

/**
 * `ref` fields and `<x>Entity` (text/enum) + `<x>Id` (uuid/text) pairs of an entity, in declaration order: the links the
 * related-records reader follows.
 */
export function relatedLinkSpecs(entity: EntityDef): LinkSpec[] {
  const fields = entity.config.fields;
  const out: LinkSpec[] = [];
  for (const [name, fd] of Object.entries(fields)) {
    if (fd.kind === 'ref' && fd.ref && fd.ref !== '@company') out.push({ idField: name, targets: [fd.ref] });
    if (
      (fd.kind === 'text' || fd.kind === 'enum') &&
      name.endsWith(ENTITY_SUFFIX) &&
      name.length > ENTITY_SUFFIX.length
    ) {
      const idField = `${name.slice(0, -ENTITY_SUFFIX.length)}${ID_SUFFIX}`;
      const idKind = fields[idField]?.kind;
      if (idKind === 'uuid' || idKind === 'text')
        out.push({ idField, entityField: name, targets: fd.kind === 'enum' ? (fd.values ?? []) : 'any' });
    }
  }
  return out;
}

function canTarget(link: LinkSpec, entity: string): boolean {
  return link.targets === 'any' || link.targets.includes(entity);
}

/** The caller may filter on / read every named field (not masked by a field group, not output-hidden). */
function readable(ctx: Context, entity: EntityDef, names: readonly (string | undefined)[]): boolean {
  const masked = maskedFields(ctx, entity);
  const hidden = outputHiddenFields(entity);
  return names.every((n) => n === undefined || (!masked.has(n) && !hidden.has(n)));
}

/** The caller may list the entity here: readable, and company-scoped entities only inside a company context. */
function listable(ctx: Context, entity: EntityDef): boolean {
  return (entity.scope === 'tenant' || Boolean(ctx.companyId)) && can(ctx, entity, 'read');
}

type LineParents = Map<string, { parent: EntityDef; parentField: string }>;

/** line entity name -> its document and parent field. */
function lineParents(): LineParents {
  const out = new Map<string, { parent: EntityDef; parentField: string }>();
  for (const doc of registry.allEntities())
    for (const l of doc.doc?.lines ?? [])
      if (registry.hasEntity(l.entity)) out.set(l.entity, { parent: doc, parentField: l.parentField });
  return out;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function dateField(entity: EntityDef, row: Raw): string | null {
  if (entity.config.fields.date?.kind === 'date' && typeof row.date === 'string') return row.date;
  for (const [name, fd] of Object.entries(entity.config.fields))
    if (fd.kind === 'date' && !fd.opts.hidden && typeof row[name] === 'string') return row[name] as string;
  return null;
}

function itemOf(entity: EntityDef, domainRow: Raw, relation: RelatedRelation, via: string): RelatedItem {
  const row = publicOutput(entity, domainRow);
  const df = entity.displayField;
  const title = df ? row[df] : undefined;
  return {
    id: row.id as string,
    title: typeof title === 'string' && title !== '' ? title : typeof title === 'number' ? String(title) : null,
    number: entity.kind === 'document' ? text(row.number) : null,
    docstatus: entity.kind === 'document' && typeof row.docstatus === 'number' ? row.docstatus : null,
    date: dateField(entity, row),
    relation,
    via,
  };
}

/** Accumulates items per entity, de-duplicated by id (the first relation found wins), capped at RELATED_LIMIT. */
class Groups {
  private readonly byEntity = new Map<string, { entity: EntityDef; items: Map<string, RelatedItem>; more: boolean }>();
  constructor(private readonly self: { entity: string; id: string }) {}

  /** `via` names the linking field, for all rows or per row id. */
  add(
    entity: EntityDef,
    rows: readonly Raw[],
    relation: RelatedRelation,
    via: string | ((id: string) => string),
    more = false,
  ): void {
    let group = this.byEntity.get(entity.name);
    if (!group) {
      group = { entity, items: new Map(), more: false };
      this.byEntity.set(entity.name, group);
    }
    if (more) group.more = true;
    for (const row of rows) {
      const id = row.id as string;
      if ((entity.name === this.self.entity && id === this.self.id) || group.items.has(id)) continue;
      if (group.items.size >= RELATED_LIMIT) {
        group.more = true;
        continue;
      }
      group.items.set(id, itemOf(entity, row, relation, typeof via === 'string' ? via : via(id)));
    }
  }

  result(appliedPacks: readonly string[]): RelatedGroup[] {
    return [...this.byEntity.values()]
      .filter((g) => g.items.size > 0)
      .map((g) => ({
        entity: g.entity.name,
        label: registry.labelOverrides(g.entity.name, appliedPacks)?.entity ?? g.entity.config.label,
        kind: g.entity.kind,
        items: [...g.items.values()],
        more: g.more,
      }));
  }
}

/** Reads `ids` of `entity` the caller may see (RELATED_LIMIT at most); `more` when further visible rows exist. */
async function readByIds(
  ctx: Context,
  entity: EntityDef,
  ids: readonly string[],
): Promise<{ rows: Raw[]; more: boolean }> {
  if (ids.length === 0 || !listable(ctx, entity)) return { rows: [], more: false };
  const res = await repo(ctx, entity).list({ where: { id: { $in: [...ids] } }, limit: RELATED_LIMIT });
  return { rows: res.items as Raw[], more: res.total > res.items.length };
}

/** target entity -> target id -> the linking field it was first reached through. */
type Targets = Map<string, Map<string, string>>;

function addTarget(into: Targets, target: string, id: string, via: string): void {
  let ids = into.get(target);
  if (!ids) {
    ids = new Map();
    into.set(target, ids);
  }
  if (!ids.has(id)) ids.set(id, via);
}

/** Outgoing links of one row, each id labelled with its own linking field. */
function collectTargets(entity: EntityDef, row: Raw, skip: ReadonlySet<string>, prefix: string, into: Targets): void {
  for (const link of relatedLinkSpecs(entity)) {
    if (skip.has(link.idField)) continue;
    const target = link.entityField ? row[link.entityField] : link.targets[0];
    const id = row[link.idField];
    if (typeof target !== 'string' || !registry.hasEntity(target) || !canTarget(link, target)) continue;
    if (typeof id !== 'string' || !isUuid(id)) continue;
    addTarget(into, target, id, `${prefix}${link.idField}`);
  }
}

/** Document id of each of `ids` (rows of the line entity `line`); empty when the caller may not read the parent field. */
async function documentsOfLines(
  ctx: Context,
  line: EntityDef,
  parentField: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0 || !listable(ctx, line) || !readable(ctx, line, [parentField])) return out;
  const res = await repo(ctx, line).list({ where: { id: { $in: [...ids] } }, limit: LINE_SCAN });
  for (const row of res.items as Raw[]) if (isId(row[parentField])) out.set(row.id as string, row[parentField]);
  return out;
}

/**
 * Records this one references (header fields, then lines). A link to a line of another document stands for that
 * document. Returns the ids of the record's own lines the caller may read (for the links that point at them).
 */
async function outgoing(
  ctx: Context,
  entity: EntityDef,
  record: Raw,
  parents: LineParents,
  groups: Groups,
): Promise<Map<string, string[]>> {
  const targets: Targets = new Map();
  const ownLines = new Map<string, string[]>();
  collectTargets(entity, publicOutput(entity, record), new Set(), '', targets);
  for (const l of entity.doc?.lines ?? []) {
    const line = registry.entity(l.entity);
    if (!listable(ctx, line) || !readable(ctx, line, [l.parentField])) continue;
    const res = await repo(ctx, line).list({ where: { [l.parentField]: record.id as string }, limit: LINE_SCAN });
    ownLines.set(
      line.name,
      (res.items as Raw[]).map((row) => row.id as string),
    );
    for (const row of res.items as Raw[])
      collectTargets(line, publicOutput(line, row), new Set([l.parentField]), `${line.name}.`, targets);
  }
  for (const [name, ids] of [...targets]) {
    const parent = parents.get(name);
    if (!parent) continue;
    targets.delete(name);
    const docs = await documentsOfLines(ctx, registry.entity(name), parent.parentField, [...ids.keys()]);
    for (const [lineId, via] of ids) {
      const doc = docs.get(lineId);
      if (doc) addTarget(targets, parent.parent.name, doc, via);
    }
  }
  for (const [name, ids] of targets) {
    const target = registry.entity(name);
    const { rows, more } = await readByIds(ctx, target, [...ids.keys()]);
    groups.add(target, rows, 'references', (id) => ids.get(id) ?? '', more);
  }
  return ownLines;
}

/**
 * Records referencing this one, or one of its own lines (`ownLines`; only through links that name the line entity, not
 * free-text `<x>Entity` pairs). A referencing line stands for its document; the record's own lines are left out.
 */
async function incoming(
  ctx: Context,
  entity: EntityDef,
  id: string,
  ownLines: ReadonlyMap<string, readonly string[]>,
  parents: LineParents,
  groups: Groups,
): Promise<void> {
  const targets: [string, readonly string[]][] = [[entity.name, [id]], ...ownLines];
  for (const source of registry.allEntities()) {
    for (const link of relatedLinkSpecs(source)) {
      const parent = parents.get(source.name);
      // The record's own lines are part of the record, not related records.
      if (parent && parent.parent.name === entity.name && parent.parentField === link.idField) continue;
      for (const [targetName, targetIds] of targets) {
        if (targetIds.length === 0 || !canTarget(link, targetName)) continue;
        if (targetName !== entity.name && link.targets === 'any') continue;
        if (!listable(ctx, source) || !readable(ctx, source, [link.idField, link.entityField])) continue;
        const where: Domain = {
          [link.idField]: targetIds.length === 1 ? (targetIds[0] as string) : { $in: [...targetIds] },
        };
        if (link.entityField) where[link.entityField] = targetName;
        const via = `${source.name}.${link.idField}`;
        if (!parent) {
          const res = await repo(ctx, source).list({ where, limit: RELATED_LIMIT });
          groups.add(source, res.items as Raw[], 'referenced_by', via, res.total > res.items.length);
          continue;
        }
        // A line that references the record stands for its document.
        if (!readable(ctx, source, [parent.parentField])) continue;
        const lines = await repo(ctx, source).list({ where, limit: LINE_SCAN });
        const ids = [...new Set((lines.items as Raw[]).map((r) => r[parent.parentField]).filter(isId))];
        const { rows, more } = await readByIds(ctx, parent.parent, ids);
        groups.add(parent.parent, rows, 'referenced_by', via, more || lines.total > lines.items.length);
      }
    }
  }
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && isUuid(v);
}

/** Earlier versions (amendedFrom, walked back) and later versions (documents amended from this one, walked forward). */
async function amendmentChain(ctx: Context, entity: EntityDef, record: Raw, groups: Groups): Promise<void> {
  const r = repo(ctx, entity);
  const earlier: Raw[] = [];
  let from = record.amendedFrom;
  for (let hops = 0; isId(from) && hops < CHAIN_HOPS; hops++) {
    const row = (await r.find(from)) as Raw | null;
    if (!row) break;
    earlier.push(row);
    from = row.amendedFrom;
  }
  groups.add(entity, earlier, 'amended_from', 'amendedFrom', isId(from) && earlier.length === CHAIN_HOPS);
  const later: Raw[] = [];
  let laterMore = false;
  let frontier = [record.id as string];
  for (let hops = 0; frontier.length > 0 && !laterMore; hops++) {
    const res = await r.list({ where: { amendedFrom: { $in: frontier } }, limit: RELATED_LIMIT });
    const rows = res.items as Raw[];
    later.push(...rows);
    frontier = rows.map((row) => row.id as string);
    laterMore =
      res.total > rows.length || later.length > RELATED_LIMIT || (hops + 1 >= CHAIN_HOPS && frontier.length > 0);
  }
  groups.add(entity, later, 'amendment', 'amendedFrom', laterMore);
}

/**
 * Related records of `entity` `id` for the caller (document-links AC-2/AC-3). NotFound / PermissionDenied when the
 * caller may not read the record itself. Groups are ordered: amendment chain, records this one references (header
 * fields, then lines), records referencing this one (registry order).
 */
export async function relatedRecords(ctx: Context, entity: EntityDef, id: string): Promise<RelatedResult> {
  const record = (await repo(ctx, entity).get(id)) as Raw;
  const groups = new Groups({ entity: entity.name, id });
  const parents = lineParents();
  if (entity.kind === 'document') await amendmentChain(ctx, entity, record, groups);
  const ownLines = await outgoing(ctx, entity, record, parents, groups);
  await incoming(ctx, entity, id, ownLines, parents, groups);
  return { entity: entity.name, id, groups: groups.result(ctx.appliedPacks ?? []) };
}
