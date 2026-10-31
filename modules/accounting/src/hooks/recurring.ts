// Recurring journal hooks (docs/specs/recurring-journals.md AC-5, AC-7, AC-8, AC-17).
// - recurring_journal before_create / before_update: header rules, nextRunDate derived from the schedule and the last
//   generated occurrence; on a header-only update that changes kind or allocationPeriods, the line rules against the
//   saved lines. A generic update that also carries lines is marked as replacing by the kernel (ADR-0031), so the line
//   rules are left to after_lines_saved, which sees the new lines.
// - after generation started (lastOccurrenceDate set): kind changes, an allocation's schedule and its frozen line values
//   (row set, accountId, debit, credit) are refused, and the template cannot be deleted.
// - recurring_journal_run: written only inside accounting.generate_recurring; every generic write is refused.
import {
  Decimal,
  isSavingLines,
  registry,
  repo,
  StateError,
  ValidationError,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { isRecurringCursorWrite, isRecurringRunWrite } from '../domain-write.ts';
import { RecurringJournal, RecurringJournalLine } from '../entities/recurring-journal.ts';
import { RecurringJournalRun } from '../entities/recurring-journal-run.ts';
import {
  companyScale,
  lastOccurrenceOf,
  scheduleOf,
  templateLineChecks,
  templateLines,
  type RecurringJournalRow,
} from '../recurring-load.ts';
import { checkHeader, checkLines, nextOccurrence } from '../services/recurrence.ts';

type Raw = Record<string, unknown>;

export const RECURRING_DUPLICATE_HINT =
  'Duplicate it to create a new recurring journal, and deactivate this one (isActive = false).';
export const RECURRING_DELETE_HINT = 'Deactivate it instead (isActive = false); its generated history stays linked.';
export const RECURRING_RUN_HINT =
  'recurring_journal_run rows are written by accounting.generate_recurring; run it instead (deleting a generated draft entry skips that occurrence).';
const INVALID_HINT = 'Fix the recurring journal and save again.';

/** Allocation schedule fields that decide each occurrence's number and amount (AC-8). */
const ALLOCATION_SCHEDULE = ['allocationPeriods', 'frequency', 'dayOfMonth', 'startDate'] as const;
/** Line fields frozen on an allocation that has started generating; partner, tax, memo, seq and ext stay editable. */
const FROZEN_LINE_FIELDS = ['accountId', 'debit', 'credit'] as const;

const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

function sameValue(a: unknown, b: unknown): boolean {
  const x = text(a);
  const y = text(b);
  if (x === null || y === null) return x === y;
  if (Decimal.isDecimalString(x) && Decimal.isDecimalString(y)) return Decimal.from(x).eq(y);
  return x === y;
}

function generated(row: Raw | RecurringJournalRow): boolean {
  return lastOccurrenceOf(row) !== null;
}

function frozenAllocation(row: Raw | RecurringJournalRow): boolean {
  return (row as Raw).kind === 'allocation' && generated(row);
}

function refuseAfterGeneration(what: string, id: unknown): never {
  throw new StateError(
    `recurring_journal ${String(id)} has generated entries; ${what} cannot be changed`,
    RECURRING_DUPLICATE_HINT,
    { reason: 'generated', id },
  );
}

function assertValid(id: unknown, issues: { path: string; message: string }[]): void {
  if (issues.length > 0)
    throw new ValidationError(`recurring_journal ${String(id ?? 'new')} is not a valid template`, issues, INVALID_HINT);
}

/** AC-8: the parts of the header that may no longer change once an occurrence has been generated. */
function assertHeaderChange(row: Raw, previous: Raw): void {
  if (!generated(previous)) return;
  if (!sameValue(row.kind, previous.kind)) refuseAfterGeneration('the kind', previous.id);
  if (previous.kind !== 'allocation') return;
  for (const field of ALLOCATION_SCHEDULE)
    if (!sameValue(row[field], previous[field])) refuseAfterGeneration(`the allocation's ${field}`, previous.id);
}

function deriveNextRun(row: Raw): void {
  row.nextRunDate = nextOccurrence(scheduleOf(row), lastOccurrenceOf(row))?.date ?? null;
}

async function lineIssues(ctx: Context, row: Raw, lines: readonly Raw[]) {
  return checkLines(scheduleOf(row), await templateLineChecks(ctx, lines), await companyScale(ctx));
}

async function beforeCreate(_ctx: Context, { row }: HookArgs): Promise<void> {
  assertValid(row.id, checkHeader(scheduleOf(row)));
  deriveNextRun(row);
}

async function beforeUpdate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const before = previous ?? {};
  // generation's cursor write only moves lastOccurrenceDate; the template was checked when the run started
  if (!isRecurringCursorWrite(ctx)) {
    assertHeaderChange(row, before);
    assertValid(row.id, checkHeader(scheduleOf(row)));
    const lineRulesChanged =
      !sameValue(row.kind, before.kind) || !sameValue(row.allocationPeriods, before.allocationPeriods);
    if (lineRulesChanged && !isSavingLines(ctx, RecurringJournal.name, row.id as string)) {
      const saved = await templateLines(ctx, row.id as string);
      // a template saved without lines is not checked against lines; generation reports it as invalid_template
      if (saved.length > 0) assertValid(row.id, await lineIssues(ctx, row, saved as unknown as Raw[]));
    }
  }
  deriveNextRun(row);
}

async function afterLinesSaved(ctx: Context, { row }: HookArgs): Promise<void> {
  const template = await repo(ctx, RecurringJournal).get(row.id as string);
  const lines = await templateLines(ctx, template.id);
  assertValid(template.id, [
    ...checkHeader(scheduleOf(template)),
    ...(await lineIssues(ctx, template as unknown as Raw, lines as unknown as Raw[])),
  ]);
}

async function beforeDelete(_ctx: Context, { row }: HookArgs): Promise<void> {
  if (generated(row))
    throw new StateError(
      `recurring_journal ${String(row.id)} has generated entries and cannot be deleted`,
      RECURRING_DELETE_HINT,
      { reason: 'generated', id: row.id },
    );
}

/** The parent of a line, locked (update) so a concurrent generation cannot slip between the check and the write. */
async function lockedParent(ctx: Context, templateId: unknown): Promise<RecurringJournalRow | null> {
  if (typeof templateId !== 'string') return null;
  return repo(ctx, RecurringJournal).lock(templateId);
}

async function lineCreateOrDelete(ctx: Context, { row }: HookArgs): Promise<void> {
  const parent = await lockedParent(ctx, row.templateId);
  if (parent && frozenAllocation(parent)) refuseAfterGeneration("the allocation's lines (rows)", parent.id);
}

async function lineUpdate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const parent = await lockedParent(ctx, previous?.templateId ?? row.templateId);
  if (!parent || !frozenAllocation(parent)) return;
  for (const field of FROZEN_LINE_FIELDS)
    if (!sameValue(row[field], previous?.[field])) refuseAfterGeneration(`the allocation's line ${field}`, parent.id);
}

/**
 * AC-17: run rows are written only by generation's module-private capability, which grants `create` only. A generic
 * create normally stops earlier (server-owned input is PERMISSION_DENIED, an input without it fails validation), so the
 * create guard is defence in depth; update and delete are refused here for every role.
 */
function runGuard(op: 'create' | 'update' | 'delete') {
  return (ctx: Context): void => {
    if (isRecurringRunWrite(ctx, op)) return;
    throw new StateError(`recurring_journal_run cannot be written directly (${op})`, RECURRING_RUN_HINT, { op });
  };
}

export function registerRecurringHooks(): void {
  registry.registerHook(RecurringJournal.name, 'before_create', beforeCreate);
  registry.registerHook(RecurringJournal.name, 'before_update', beforeUpdate);
  registry.registerHook(RecurringJournal.name, 'after_lines_saved', afterLinesSaved);
  registry.registerHook(RecurringJournal.name, 'before_delete', beforeDelete);
  registry.registerHook(RecurringJournalLine.name, 'before_create', lineCreateOrDelete);
  registry.registerHook(RecurringJournalLine.name, 'before_update', lineUpdate);
  registry.registerHook(RecurringJournalLine.name, 'before_delete', lineCreateOrDelete);
  registry.registerHook(RecurringJournalRun.name, 'before_create', runGuard('create'));
  registry.registerHook(RecurringJournalRun.name, 'before_update', runGuard('update'));
  registry.registerHook(RecurringJournalRun.name, 'before_delete', runGuard('delete'));
}
