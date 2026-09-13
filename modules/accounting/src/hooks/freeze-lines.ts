// journal_line before_create/update/delete (spec AC-5, AC-8, ADR-0005). The kernel freezes lines only on the
// saveLines path; this hook makes direct line writes under a non-draft entry fail the same way, and guards the derived
// columns: `posted`/`entryDate` stay false/null while the entry is a draft and, once it is submitted, the only write
// still accepted is the stamp `posted = true, entryDate = <entry.date>` (what the after_submit hook writes). Hence
// `posted = true` ⇔ "the entry is submitted", which is what the trial balance and ledger filter on.
import {
  Decimal,
  DOCSTATUS,
  isDecimal,
  registry,
  repo,
  StateError,
  ValidationError,
  hasWriteCapability,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import { JournalEntry } from '../entities/journal-entry.ts';
import { JournalLine } from '../entities/journal-line.ts';

type Raw = Record<string, unknown>;
type EntryRow = Infer<typeof JournalEntry>;

const STAMP_FIELDS: ReadonlySet<string> = new Set(['posted', 'entryDate', 'accountType', 'accountTaxRole']);
/** Compared when deciding whether an update under a submitted entry is a pure stamp; `ext` is frozen too. */
const COMPARED_FIELDS: readonly string[] = [...JournalLine.fieldNames.filter((f) => !STAMP_FIELDS.has(f)), 'ext'];

function frozenError(parent: EntryRow): StateError {
  return new StateError(
    `journal_entry ${parent.number ?? parent.id} is not a draft; its lines are frozen`,
    'Submitted entries are immutable. Post a reversal with accounting.reverse_entry, then a corrected entry (ADR-0005).',
    { entryId: parent.id, docstatus: parent.docstatus },
  );
}

async function loadParent(ctx: Context, entryId: unknown): Promise<EntryRow | null> {
  if (typeof entryId !== 'string') return null;
  return repo(ctx, JournalEntry).get(entryId);
}

async function assertParentDraft(ctx: Context, entryId: unknown): Promise<void> {
  const parent = await loadParent(ctx, entryId);
  if (parent && parent.docstatus !== DOCSTATUS.draft) throw frozenError(parent);
}

/** Under a draft, the derived columns are never user-writable. */
function assertNotStamped(row: Raw): void {
  if (row.posted !== true && (row.entryDate === null || row.entryDate === undefined)) return;
  throw new ValidationError(
    'journal_line.posted and journal_line.entryDate are derived at submit',
    [
      {
        path: row.posted === true ? 'posted' : 'entryDate',
        message: 'set by the system when the journal_entry is submitted',
      },
    ],
    'Omit posted/entryDate; submit the journal_entry instead.',
  );
}

/** Raw DB values (numeric strings) and domain values (Decimal) may describe the same amount. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (isDecimal(a) || isDecimal(b)) return Decimal.from(a as Decimal | string).eq(b as Decimal | string);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when the update writes only the stamp and the stamp is the parent's truth. */
function isStamp(row: Raw, previous: Raw, parent: EntryRow): boolean {
  if (row.posted !== true || row.entryDate !== parent.date) return false;
  return COMPARED_FIELDS.every((k) => sameValue(previous[k], row[k]));
}

export function registerFreezeLinesHook(): void {
  registry.registerHook(JournalLine.name, 'before_create', async (ctx, { row }) => {
    await assertParentDraft(ctx, row.entryId);
    assertNotStamped(row);
  });
  registry.registerHook(JournalLine.name, 'before_update', async (ctx, { row, previous }) => {
    const before = previous ?? {};
    const parent = await loadParent(ctx, before.entryId);
    if (parent && parent.docstatus !== DOCSTATUS.draft) {
      if (hasWriteCapability(ctx, JournalLine.name, 'update') && isStamp(row, before, parent)) return;
      throw frozenError(parent);
    }
    assertNotStamped(row);
    if (row.entryId !== before.entryId) await assertParentDraft(ctx, row.entryId);
  });
  registry.registerHook(JournalLine.name, 'before_delete', (ctx, { row }) => assertParentDraft(ctx, row.entryId));
}
