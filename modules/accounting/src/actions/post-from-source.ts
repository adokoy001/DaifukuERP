// accounting.post_from_source (spec AC-7): the internal posting entry point for sales/purchase/payment. Creates and
// submits one journal_entry linked to the source document in the caller's transaction (all or nothing). A source may
// have at most one live (unreversed) entry; re-posting after a reversal is allowed.
import {
  Conflict,
  defineAction,
  DOCSTATUS,
  label,
  repo,
  StateError,
  withLock,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';
import { z } from 'zod';
import { postingDimensions } from '../dimensions.ts';
import { withPosting } from '../domain-write.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import {
  createAndSubmitEntry,
  lineInput,
  localDate,
  toEntryJson,
  entryWithLinesJson,
  type EntryWithLines,
  type LineInput,
} from './helpers.ts';

export interface PostFromSourceInput {
  sourceEntity: string;
  sourceId: string;
  date: LocalDate;
  description?: string | null | undefined;
  lines: readonly LineInput[];
  ext?: Record<string, unknown> | null | undefined;
}

export const postFromSourceInput = z.object({
  sourceEntity: z.string().min(1).max(100),
  sourceId: z.uuid(),
  date: localDate,
  description: z.string().max(500).nullable().optional(),
  lines: z.array(lineInput).min(2).max(500),
  ext: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Submitted entries of a source that have no submitted reversal. */
export async function liveEntriesForSource(
  ctx: Context,
  sourceEntity: string,
  sourceId: string,
): Promise<{ id: string; number: string | null }[]> {
  const r = repo(ctx, JournalEntry);
  const posted = await r.list({ where: { sourceEntity, sourceId, docstatus: DOCSTATUS.submitted }, limit: 500 });
  if (posted.total > posted.items.length)
    throw new StateError(
      'Source history exceeds the supported range',
      'Review and archive source posting history before continuing.',
    );
  if (posted.items.length === 0) return [];
  const reversals = await r.list({
    where: { reversalOf: { $in: posted.items.map((e) => e.id) }, docstatus: DOCSTATUS.submitted },
    limit: 500,
  });
  if (reversals.total > reversals.items.length)
    throw new StateError(
      'Source reversal history exceeds the supported range',
      'Review source posting history before continuing.',
    );
  const reversed = new Set(reversals.items.map((e) => e.reversalOf));
  return posted.items.filter((e) => !reversed.has(e.id)).map((e) => ({ id: e.id, number: e.number }));
}

/** Plain function for in-process callers (no runAction). Permissions still apply to the caller's roles. */
export async function postFromSource(ctx: Context, input: PostFromSourceInput): Promise<EntryWithLines> {
  await withLock(ctx, `accounting-source:${input.sourceEntity}:${input.sourceId}`, async () => undefined);
  const live = await liveEntriesForSource(ctx, input.sourceEntity, input.sourceId);
  const existing = live[0];
  if (existing) {
    throw new Conflict(
      `${input.sourceEntity} ${input.sourceId} is already posted as journal_entry ${existing.number ?? existing.id}`,
      'Cancel or correct the source through its owning business operation before posting again.',
      { sourceEntity: input.sourceEntity, sourceId: input.sourceId, entryId: existing.id, number: existing.number },
    );
  }
  return withPosting(ctx, (internal) =>
    createAndSubmitEntry(
      internal,
      {
        date: input.date,
        description: input.description ?? null,
        sourceEntity: input.sourceEntity,
        sourceId: input.sourceId,
        ext: postingDimensions(input.sourceEntity, JournalEntry.name, input.ext),
      },
      input.lines,
    ),
  );
}

export const postFromSourceAction = defineAction({
  name: 'accounting.post_from_source',
  description: label(
    '起票元の伝票（sourceEntity/sourceId）から仕訳を作成して転記します（内部用: 販売・購買・入出金が呼ぶ）。同じ起票元に未逆仕訳の転記があれば CONFLICT。',
    'Create and submit a journal entry for a source document (internal: used by sales/purchase/payment). CONFLICT if the source already has an unreversed entry.',
  ),
  input: postFromSourceInput,
  output: entryWithLinesJson,
  permission: { entity: JournalEntry.name, op: 'submit' },
  internal: true,
  handler: async (ctx, input) => toEntryJson(await postFromSource(ctx, input)),
});
