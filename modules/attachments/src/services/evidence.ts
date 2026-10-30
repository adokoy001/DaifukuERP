// Pure parts of the evidence search (docs/specs/evidence-search.md AC-3, AC-10): the public row schemas derived from the
// entity schema, the "search keys missing" flag, and the supersede tree (relations, order, truncation). No DB access.
import { z } from 'zod';
import { Attachment } from '../entities/attachment.ts';

/** Rows per evidence search page (AC-1). */
export const EVIDENCE_PAGE_MAX = 100;
export const EVIDENCE_PAGE_DEFAULT = 50;
/** Rows returned by attachment.history besides the always-kept path from the requested row to the latest (AC-10). */
export const HISTORY_LIMIT = 50;
/** Hops followed along supersededById, and levels walked down the tree; a safety bound (chains are acyclic). */
export const HISTORY_MAX_HOPS = 500;

export const LINKED_KINDS = ['document', 'entity', 'line', 'unknown'] as const;
export type LinkedKind = (typeof LINKED_KINDS)[number];

/** AC-5: the linked record as the caller may see it. `target` is the record to open (a line's document). */
export const linkedSchema = z.object({
  entity: z.string(),
  id: z.string(),
  kind: z.enum(LINKED_KINDS),
  readable: z.boolean(),
  target: z.object({ entity: z.string(), id: z.uuid() }).nullable(),
  title: z.string().nullable(),
  number: z.string().nullable(),
  docstatus: z.number().int().nullable(),
});
export type LinkedSummary = z.infer<typeof linkedSchema>;

/** The attachment JSON without the storage key; new attachment fields flow into every evidence output (AC-3). */
export const evidenceBaseSchema = Attachment.schemas.json.omit({ storageKey: true });

export const evidenceItemSchema = evidenceBaseSchema.extend({
  linked: linkedSchema.nullable(),
  /** Attachments superseded by this one (its older versions, direct only). */
  supersedes: z.number().int().min(0),
  /** One of 取引年月日・取引金額・取引先 is empty, so a search by that key cannot find the row. */
  incomplete: z.boolean(),
});
/** The schema's base shape is the entity's open record type, so the added fields are spelled out for TypeScript users. */
export type EvidenceItem = z.infer<typeof evidenceBaseSchema> & {
  id: string;
  linked: LinkedSummary | null;
  supersedes: number;
  incomplete: boolean;
};

export const HISTORY_RELATIONS = ['self', 'newer', 'older', 'sibling'] as const;
export type HistoryRelation = (typeof HISTORY_RELATIONS)[number];

/** AC-10: the supersede record from the audit trail; every field null when no such entry exists ("not recorded"). */
export const supersedeRecordSchema = z.object({
  reason: z.string().nullable(),
  at: z.string().nullable(),
  actorType: z.string().nullable(),
  actorId: z.string().nullable(),
});
export type SupersedeRecord = z.infer<typeof supersedeRecordSchema>;
export const NO_SUPERSEDE_RECORD: SupersedeRecord = { reason: null, at: null, actorType: null, actorId: null };

export const historyItemSchema = evidenceBaseSchema.extend({
  relation: z.enum(HISTORY_RELATIONS),
  /** Distance from the latest version (0 = latest). */
  depth: z.number().int().min(0),
  incomplete: z.boolean(),
  /** Set on superseded rows; null on the latest version. */
  supersede: supersedeRecordSchema.nullable(),
});
export type HistoryItem = z.infer<typeof evidenceBaseSchema> & {
  id: string;
  relation: HistoryRelation;
  depth: number;
  incomplete: boolean;
  supersede: SupersedeRecord | null;
};

/** Strips the storage key from an attachment JSON row (the output schema would strip it too; this keeps it explicit). */
export function withoutStorageKey(json: Record<string, unknown>): Record<string, unknown> {
  const { storageKey: _storageKey, ...rest } = json;
  return rest;
}

/** AC-3: true when one of the three 電帳法 search keys is empty. */
export function isIncomplete(row: { txnDate?: unknown; amount?: unknown; partnerId?: unknown }): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  return empty(row.txnDate) || empty(row.amount) || empty(row.partnerId);
}

/** One row of the supersede tree as the history walk found it. */
export interface TreeNode {
  id: string;
  supersededById: string | null;
  /** ISO timestamp (createdAt). */
  createdAt: string;
  /** Distance from the latest version. */
  depth: number;
}

/**
 * AC-10 relation of `node` to the requested row: self; newer (on the path from self to the latest); older (its
 * supersededById chain reaches self); sibling otherwise. `byId` holds every returned node; a node's ancestors are always
 * returned before it (the walk only descends from returned rows), so the chain can be followed inside `byId`.
 */
export function relationOf(
  node: TreeNode,
  selfId: string,
  newerIds: ReadonlySet<string>,
  byId: ReadonlyMap<string, TreeNode>,
): HistoryRelation {
  if (node.id === selfId) return 'self';
  if (newerIds.has(node.id)) return 'newer';
  let next = node.supersededById;
  for (let hops = 0; next !== null && hops <= HISTORY_MAX_HOPS; hops++) {
    if (next === selfId) return 'older';
    next = byId.get(next)?.supersededById ?? null;
  }
  return 'sibling';
}

/** AC-10 order: shallow first (latest at the top), then newest registration first, then id. */
export function compareHistory(a: TreeNode, b: TreeNode): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * One level of the breadth-first walk: adds `children` (already ordered newest first) to `kept` until the budget is
 * spent. Rows already kept (the path from self to the latest) never count twice. Returns the ids to descend from next and
 * whether a child was left out.
 */
export function takeLevel(
  children: readonly TreeNode[],
  kept: Map<string, TreeNode>,
  budget: number,
): { next: string[]; skipped: boolean } {
  const next: string[] = [];
  let skipped = false;
  for (const child of children) {
    if (kept.has(child.id)) {
      next.push(child.id);
      continue;
    }
    if (kept.size >= budget) {
      skipped = true;
      continue;
    }
    kept.set(child.id, child);
    next.push(child.id);
  }
  return { next, skipped };
}

/** Picks the newest `attachment.supersede` audit entry (entries arrive newest first) as the supersede record. */
export function supersedeRecordOf(
  entries: readonly { action: string | null; actorType: string; actorId: string; at: Date | string; after: unknown }[],
): SupersedeRecord {
  const entry = entries.find((e) => e.action === 'attachment.supersede');
  if (!entry) return NO_SUPERSEDE_RECORD;
  const after = entry.after;
  const reason =
    after !== null && typeof after === 'object' && typeof (after as { reason?: unknown }).reason === 'string'
      ? (after as { reason: string }).reason
      : null;
  return {
    reason,
    at: entry.at instanceof Date ? entry.at.toISOString() : String(entry.at),
    actorType: entry.actorType,
    actorId: entry.actorId,
  };
}
