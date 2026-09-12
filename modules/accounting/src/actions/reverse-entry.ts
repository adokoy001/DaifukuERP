// accounting.reverse_entry (spec AC-6, ADR-0005): the only correction path for a posted entry. Posts a new entry with
// debit/credit swapped, linked by reversalOf, and emits journal_entry.reversed.
import { Conflict, defineAction, DOCSTATUS, label, repo, StateError, ValidationError, hasWriteCapability, withLock, type Context, type LocalDate } from '@daifuku/kernel';
import { z } from 'zod';
import { withPosting, withStamp } from '../domain-write.ts';
import { JournalLine } from '../entities/journal-line.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import { reverseLines } from '../services/balance.ts';
import { loadLines } from '../hooks/validate-entry.ts';
import { createAndSubmitEntry, entryWithLinesJson, localDate, toEntryJson, type EntryWithLines } from './helpers.ts';

export interface ReverseEntryInput {
  id: string;
  /** Date of the reversing entry; defaults to the original's date. */
  date?: LocalDate | null | undefined;
}

export const REVERSED_EVENT = 'journal_entry.reversed';

/** Plain function for in-process callers (no runAction). */
export async function reverseEntry(ctx: Context, { id, date }: ReverseEntryInput): Promise<EntryWithLines> {
  const r = repo(ctx, JournalEntry);
  await withLock(ctx, `accounting-reversal:${id}`, async () => undefined);
  const original = await r.lock(id, 'submit');
  const owningSource = original.sourceEntity || (original.reversalOf ? (await r.get(original.reversalOf)).sourceEntity : null);
  if (date && date < original.date) throw new ValidationError('Correction cannot precede the original entry', [{ path: 'date', message: 'must be on or after the original date' }]);
  if (owningSource && !hasWriteCapability(ctx, JournalEntry.name, 'reverse-source')) throw new StateError('A source-generated journal must be reversed by its owning business operation', 'Cancel the source document; a standalone reversal would leave its business balance unchanged.');
  if (original.docstatus !== DOCSTATUS.submitted) {
    throw new StateError(`journal_entry ${id} is not submitted`, 'Only submitted entries can be reversed; delete a draft instead.', { id, docstatus: original.docstatus });
  }
  const already = await r.count({ reversalOf: id, docstatus: DOCSTATUS.submitted });
  if (already > 0) throw new Conflict(`journal_entry ${original.number ?? id} is already reversed`, 'Post a new entry instead of reversing twice.', { id, number: original.number });
  const originalLines = await loadLines(ctx, id);
  const lines = reverseLines(originalLines).map((l) => ({
    accountId: l.accountId,
    debit: l.debit,
    credit: l.credit,
    partnerId: l.partnerId,
    taxCategory: l.taxCategory,
    taxRate: l.taxRate,
    memo: l.memo,
    ext: l.ext ?? {},
  }));
  const reversal = await withPosting(ctx, (internal) => createAndSubmitEntry(internal, { date: date ?? original.date, description: `逆仕訳: ${original.number ?? id}`, reversalOf: id, ext: original.ext ?? {} }, lines));
  await withStamp(ctx, async (internal) => {
    for (let i = 0; i < reversal.lines.length; i += 1) {
      const line = reversal.lines[i];
      const before = originalLines[i];
      if (line && before) reversal.lines[i] = await repo(internal, JournalLine).update(line.id, { accountType: before.accountType, accountTaxRole: before.accountTaxRole });
    }
  });
  await ctx.emit(REVERSED_EVENT, { id, number: original.number, reversalId: reversal.id, reversalNumber: reversal.number });
  return reversal;
}

export const reverseEntryAction = defineAction({
  name: 'accounting.reverse_entry',
  description: label(
    '転記済みの仕訳を逆仕訳で取り消します（貸借を入れ替えた新しい仕訳を転記）。仕訳の cancel は禁止されているため、訂正は必ずこのアクションで行います。date 省略時は元仕訳の日付。',
    'Reverse a submitted journal entry by posting a new one with debit/credit swapped. Cancelling entries is forbidden; this is the correction path. date defaults to the original date.',
  ),
  input: z.object({ id: z.uuid(), date: localDate.optional() }),
  output: entryWithLinesJson,
  permission: { entity: JournalEntry.name, op: 'submit' },
  handler: async (ctx, input) => toEntryJson(await reverseEntry(ctx, input)),
});
