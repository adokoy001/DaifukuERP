// attachment.history (docs/specs/evidence-search.md AC-10): the supersede tree of one attachment (訂正削除履歴). The
// root is the latest version; a row's children are the rows it replaced. The path from the requested row up to the latest
// is always returned, then the rest breadth-first until HISTORY_LIMIT rows in total (more only when that path alone is
// longer). The reason/time/actor of each supersede come
// from the audit trail (the only place the reason is kept), read with the caller's Context. Reads only.
import { auditTrail, defineAction, label, repo, type Context, type Infer } from '@daifuku/kernel';
import { z } from 'zod';
import { Attachment, attachmentJson } from '../entities/attachment.ts';
import {
  compareHistory,
  HISTORY_LIMIT,
  HISTORY_MAX_HOPS,
  historyItemSchema,
  isIncomplete,
  relationOf,
  supersedeRecordOf,
  takeLevel,
  withoutStorageKey,
  type TreeNode,
} from '../services/evidence.ts';

type Row = Infer<typeof Attachment>;

/** Audit entries read per superseded row to find its supersede entry (other updates of the row may come after it). */
const AUDIT_SCAN = 500;

function nodeOf(row: Row, depth: number): TreeNode {
  return { id: row.id, supersededById: row.supersededById, createdAt: row.createdAt.toISOString(), depth };
}

/** The requested row and every newer version up to the latest (self first). `cut` when the walk stopped early. */
async function pathToLatest(ctx: Context, self: Row): Promise<{ path: Row[]; cut: boolean }> {
  const r = repo(ctx, Attachment);
  const path = [self];
  let current = self;
  while (current.supersededById !== null) {
    if (path.length > HISTORY_MAX_HOPS) return { path, cut: true };
    const next = await r.find(current.supersededById);
    if (!next) return { path, cut: true };
    path.push(next);
    current = next;
  }
  return { path, cut: false };
}

export const historyAction = defineAction({
  name: 'attachment.history',
  description: label(
    '証憑の差替の履歴（訂正削除履歴）を返します。最新版を根とする木で、指定した証憑から最新版までの版を必ず含み、合計 50 行に達するまで残りの版を足します（50 行を超えるのは、指定した証憑から最新版までの経路だけで 50 行を超えるときだけ）。返さなかった版があれば truncated が true です。差し替えられた版には差替の理由・日時・実行者（監査ログ）が付きます。どの版も削除されずダウンロードできます。',
    'Return the supersede history of an attachment as a tree rooted at the latest version: up to 50 rows in total, always including the path from the requested attachment to the latest (more than 50 only when that path alone is longer). truncated is true when rows were left out. Superseded versions carry the reason, time and actor of the supersede (from the audit trail). No version is deleted; each can be downloaded.',
  ),
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), items: z.array(historyItemSchema), truncated: z.boolean() }),
  permission: { entity: 'attachment', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, { id }) => {
    const r = repo(ctx, Attachment);
    const self = await r.get(id); // NotFound / PermissionDenied when the caller may not see it
    const { path, cut } = await pathToLatest(ctx, self);
    let truncated = cut;
    const rows = new Map<string, Row>();
    const kept = new Map<string, TreeNode>();
    path.forEach((row, index) => {
      rows.set(row.id, row);
      kept.set(row.id, nodeOf(row, path.length - 1 - index));
    });
    const newerIds = new Set(path.slice(1).map((row) => row.id));
    const latest = path[path.length - 1] as Row;
    let frontier = [latest.id];
    for (let depth = 0; frontier.length > 0; depth++) {
      if (depth >= HISTORY_MAX_HOPS) {
        truncated = true;
        break;
      }
      const res = await r.list({
        where: { supersededById: { $in: frontier } },
        orderBy: [{ field: 'createdAt', dir: 'desc' }],
        limit: 500,
      });
      if (res.total > res.items.length) truncated = true;
      for (const row of res.items) if (!rows.has(row.id)) rows.set(row.id, row);
      const level = takeLevel(
        res.items.map((row) => nodeOf(row, depth + 1)),
        kept,
        HISTORY_LIMIT, // the path rows are already in `kept`: they count toward the limit but are never left out
      );
      if (level.skipped) truncated = true;
      frontier = level.next;
    }
    const nodes = [...kept.values()].sort(compareHistory);
    const items = [];
    for (const node of nodes) {
      const row = rows.get(node.id) as Row;
      const supersede =
        row.supersededById === null ? null : supersedeRecordOf(await auditTrail(ctx, 'attachment', row.id, AUDIT_SCAN));
      items.push({
        ...withoutStorageKey(attachmentJson(row)),
        relation: relationOf(node, self.id, newerIds, kept),
        depth: node.depth,
        incomplete: isIncomplete(row),
        supersede,
      });
    }
    return { id: self.id, items, truncated };
  },
});
