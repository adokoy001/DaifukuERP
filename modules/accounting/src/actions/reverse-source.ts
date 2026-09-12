import { repo, StateError, type Context } from '@daifuku/kernel';
import { JournalEntry } from '../entities/journal-entry.ts';
import { withPosting } from '../domain-write.ts';
import { reverseEntry, type ReverseEntryInput } from './reverse-entry.ts';
import type { EntryWithLines } from './helpers.ts';

/** Trusted module correction path. Source identity must match the immutable posting. */
export async function reverseSourceEntry(ctx: Context, input: ReverseEntryInput & { sourceEntity: string; sourceId: string }): Promise<EntryWithLines> {
  const original = await repo(ctx, JournalEntry).get(input.id);
  if (original.sourceEntity !== input.sourceEntity || original.sourceId !== input.sourceId) {
    throw new StateError('journal entry does not belong to the cancelling source', 'Repair the source linkage before retrying the business cancellation.');
  }
  return withPosting(ctx, (internal) => reverseEntry(internal, input));
}
