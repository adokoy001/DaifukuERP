// before_cancel on journal_entry (spec AC-6, ADR-0005): a posted entry is never cancelled; post a reversal instead.
// Note: the kernel checks dependents before this hook, so an entry that already has a reversal fails earlier with
// DependencyError — still a refusal, but with a different code.
import { registry, StateError } from '@daifuku/kernel';
import { JournalEntry } from '../entities/journal-entry.ts';

export const NO_CANCEL_HINT = 'use accounting.reverse_entry';

export function registerNoCancelHook(): void {
  registry.registerHook(JournalEntry.name, 'before_cancel', (_ctx, { row }) => {
    throw new StateError(
      `journal_entry ${String(row.number ?? row.id)} is submitted and cannot be cancelled (ledger entries are append-only, ADR-0005)`,
      `${NO_CANCEL_HINT} to post a reversing entry, then post the corrected entry.`,
      { id: row.id, number: row.number },
    );
  });
}
