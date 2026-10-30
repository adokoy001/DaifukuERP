// Recurring journal run record (定期仕訳の生成記録, docs/specs/recurring-journals.md AC-10, AC-17). One row per generated
// occurrence. The unique key (templateId, occurrenceDate) is the database-level idempotency guarantee behind the
// series lock and row locks of accounting.generate_recurring. Rows are written only inside generation
// (hooks/recurring.ts refuses every generic write, admin included), like contract_billing. Deleting a generated draft
// entry keeps the row with entryId cleared (`set null`): the occurrence counts as generated and is not made again.
import { defineEntity, f, label } from '@daifuku/kernel';

export const RecurringJournalRun = defineEntity({
  name: 'recurring_journal_run',
  label: label('定期仕訳の生成記録', 'Recurring journal run'),
  fields: {
    templateId: f.ref('recurring_journal', {
      label: label('定期仕訳', 'Recurring journal'),
      serverOwned: true,
      required: true,
      immutable: true,
    }),
    occurrenceDate: f.date({
      label: label('回の日付', 'Occurrence date'),
      serverOwned: true,
      required: true,
      immutable: true,
    }),
    occurrenceNo: f.int({
      label: label('回番号', 'Occurrence no.'),
      description: label('按分の k/N の k（定額は空）', 'k of an allocation k/N (empty for fixed amounts)'),
      serverOwned: true,
      immutable: true,
      min: 1,
    }),
    entryId: f.ref('journal_entry', {
      label: label('仕訳', 'Journal entry'),
      description: label('下書きを削除すると空になります', 'Cleared when the draft entry is deleted'),
      serverOwned: true,
      onDelete: 'set null',
    }),
  },
  displayField: 'occurrenceDate',
  unique: [['templateId', 'occurrenceDate']],
  import: false,
  permissions: {
    roles: {
      // create exists for the kernel's permission check only; hooks/recurring.ts lets through the writes made inside
      // accounting.generate_recurring (module write capability) and refuses every other one.
      accounting: ['read', 'create'],
      viewer: ['read'],
    },
  },
  views: { list: ['templateId', 'occurrenceDate', 'occurrenceNo', 'entryId'] },
});

export type RecurringJournalRunDef = typeof RecurringJournalRun;
