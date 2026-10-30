// accounting.generate_recurring (docs/specs/recurring-journals.md AC-9..AC-20): one draft journal entry per due
// occurrence of every active recurring journal, in the caller's context and transaction.
//   1. The company series lock `accounting-recurring` is taken before the candidates are read, and the candidates are
//      row-locked in id order: a concurrent run waits for this one to commit, then finds nothing left to create.
//   2. Each occurrence runs in its own savepoint: period check (assertOpenPeriod's rules and lock), the entry through
//      Repository + saveLines, its run record (unique templateId + occurrenceDate: a second row for the same occurrence
//      is refused by the database even on a path that skips the locks), optional submit, the event. A business error
//      rolls back that occurrence only and stops its template; any other error fails the whole run.
//   3. The template's cursor (lastOccurrenceDate) moves to the last created occurrence; hooks/recurring.ts derives
//      nextRunDate from it. A closed or missing period stops the template at that occurrence (nextRunDate stays there).
import {
  can,
  DaifukuError,
  Decimal,
  defineAction,
  label,
  PermissionDenied,
  repo,
  saveLines,
  StateError,
  submitDocument,
  todayLocal,
  withLock,
  withSavepoint,
  type Context,
  type EntityDef,
  type LocalDate,
} from '@daifuku/kernel';
import { z } from 'zod';
import { postingDimensions } from '../dimensions.ts';
import { withRecurringCursor, withRecurringRun } from '../domain-write.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import { JournalLine } from '../entities/journal-line.ts';
import { RecurringJournal, RecurringJournalLine } from '../entities/recurring-journal.ts';
import { RecurringJournalRun } from '../entities/recurring-journal-run.ts';
import { assertOpenPeriod } from '../hooks/validate-entry.ts';
import {
  companyScale,
  lastOccurrenceOf,
  scheduleOf,
  templateLineChecks,
  templateLines,
  type RecurringJournalLineRow,
  type RecurringJournalRow,
} from '../recurring-load.ts';
import {
  allocationAmount,
  allocationTotal,
  checkTemplate,
  dueOccurrences,
  RECURRING_KINDS,
  type Occurrence,
  type StopReason,
} from '../services/recurrence.ts';
import { loadRecurringAutoSubmit } from '../settings.ts';
import { listAll, localDate } from './helpers.ts';

export const RECURRING_GENERATED_EVENT = 'recurring_journal.generated';
/** AC-18: entries created by one call. */
export const MAX_RECURRING_ENTRIES = 200;
/** Upper bound of active templates read by one call (a company with more has to narrow with templateId). */
const MAX_TEMPLATES = 5000;

export const RUN_STATUSES = ['generated', 'up_to_date', 'blocked', 'failed', 'inactive'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STOP_REASONS = ['closed_period', 'closed_year', 'no_period', 'error', 'invalid_template'] as const;
export type RunStopReason = (typeof RUN_STOP_REASONS)[number];

export const generateRecurringInput = z.object({ asOf: localDate.optional(), templateId: z.uuid().optional() });
export type GenerateRecurringInput = z.output<typeof generateRecurringInput>;

const issueJson = z.object({ path: z.string(), message: z.string() });
const entryJson = z.object({
  occurrenceDate: z.string(),
  occurrenceNo: z.number().int().nullable(),
  entryId: z.uuid(),
  number: z.string().nullable(),
  docstatus: z.number().int(),
  amount: z.string(),
});
const stopJson = z.object({
  occurrenceDate: z.string(),
  reason: z.enum(RUN_STOP_REASONS),
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  periodCode: z.string().optional(),
  fiscalYearCode: z.string().optional(),
  issues: z.array(issueJson).optional(),
});
const templateJson = z.object({
  templateId: z.uuid(),
  name: z.string(),
  kind: z.enum(RECURRING_KINDS),
  status: z.enum(RUN_STATUSES),
  entries: z.array(entryJson),
  nextRunDate: z.string().nullable(),
  more: z.boolean(),
  stop: stopJson.optional(),
});
export const generateRecurringOutput = z.object({
  asOf: z.string(),
  autoSubmit: z.boolean(),
  created: z.number().int(),
  truncated: z.boolean(),
  templates: z.array(templateJson),
});
export type GenerateRecurringResult = z.output<typeof generateRecurringOutput>;
type TemplateResult = z.output<typeof templateJson>;
type EntryResult = z.output<typeof entryJson>;
type Stop = z.output<typeof stopJson>;

/**
 * AC-15 defense in depth: the action needs update on recurring_journal; the caller must also be able to create journal
 * entries and lines (and submit them when auto-submit is on). Shipped roles that pass the first check pass this one.
 */
export function assertCanGenerate(ctx: Pick<Context, 'roles' | 'appliedPacks' | 'accessScope'>, autoSubmit: boolean) {
  type Need = [EntityDef, 'create' | 'update' | 'submit'];
  const needs: Need[] = [
    [JournalEntry, 'create'],
    [JournalLine, 'create'],
  ];
  if (autoSubmit) needs.push([JournalEntry, 'submit'], [JournalLine, 'update']);
  for (const [entity, op] of needs)
    if (!can(ctx, entity, op)) throw new PermissionDenied(entity.name, op, ctx.roles ?? []);
}

/** `摘要 (k/N)` for allocations; the name when the description is empty. */
export function entryDescription(
  template: Pick<RecurringJournalRow, 'name' | 'description' | 'kind' | 'allocationPeriods'>,
  no: number,
): string {
  const base = template.description?.trim() ? template.description : template.name;
  return template.kind === 'allocation' ? `${base} (${no}/${template.allocationPeriods ?? 0})` : base;
}

/** The kind of period refusal assertOpenPeriod raised (by its details), for the per-template stop. */
function periodStop(err: StateError, date: LocalDate): Stop {
  const d = err.details ?? {};
  const reason: StopReason = 'fiscalYearId' in d ? 'closed_year' : 'periodId' in d ? 'closed_period' : 'no_period';
  return {
    occurrenceDate: date,
    reason,
    code: err.code,
    message: err.message,
    hint: err.hint,
    ...(reason === 'closed_period' && typeof d.code === 'string' ? { periodCode: d.code } : {}),
    ...(reason === 'closed_year' && typeof d.code === 'string' ? { fiscalYearCode: d.code } : {}),
  };
}

function errorStop(err: DaifukuError, date: LocalDate): Stop {
  const issues = err.details?.issues;
  return {
    occurrenceDate: date,
    reason: 'error',
    code: err.code,
    message: err.message,
    hint: err.hint,
    ...(Array.isArray(issues) ? { issues: issues as Stop['issues'] } : {}),
  };
}

interface Plan {
  template: RecurringJournalRow;
  lines: RecurringJournalLineRow[];
  total: Decimal | null;
  scale: number;
  autoSubmit: boolean;
}

/** One occurrence in its own savepoint: entry, lines, run record, optional submit, event. */
async function createOccurrence(ctx: Context, plan: Plan, o: Occurrence): Promise<EntryResult> {
  const { template, lines, total, scale, autoSubmit } = plan;
  const allocation = template.kind === 'allocation';
  const share =
    allocation && total !== null ? allocationAmount(total, template.allocationPeriods ?? 1, scale, o.no) : null;
  return withSavepoint(ctx, async (sp) => {
    const entries = repo(sp, JournalEntry);
    const head = await entries.create({
      date: o.date,
      description: entryDescription(template, o.no),
      ext: postingDimensions(RecurringJournal.name, JournalEntry.name, template.ext),
    });
    const rows = lines.map((l) => ({
      accountId: l.accountId,
      debit: share !== null && l.debit.gt(0) ? share : l.debit,
      credit: share !== null && l.credit.gt(0) ? share : l.credit,
      partnerId: l.partnerId,
      taxCategory: l.taxCategory,
      taxRate: l.taxRate,
      memo: l.memo,
      ext: postingDimensions(RecurringJournalLine.name, JournalLine.name, l.ext),
    }));
    await saveLines(sp, JournalEntry, head.id, { [JournalLine.name]: rows });
    const occurrenceNo = allocation ? o.no : null;
    await withRecurringRun(sp, (w) =>
      repo(w, RecurringJournalRun).create({
        templateId: template.id,
        occurrenceDate: o.date,
        occurrenceNo,
        entryId: head.id,
      }),
    );
    if (autoSubmit) await submitDocument(sp, JournalEntry, head.id);
    const entry = await entries.get(head.id);
    await sp.emit(RECURRING_GENERATED_EVENT, {
      templateId: template.id,
      occurrenceDate: o.date,
      occurrenceNo,
      entryId: head.id,
      submitted: autoSubmit,
    });
    return {
      occurrenceDate: o.date,
      occurrenceNo,
      entryId: entry.id,
      number: entry.number,
      docstatus: entry.docstatus,
      amount: Decimal.sum(rows.map((r) => r.debit)).toString(),
    };
  });
}

interface Budget {
  left: number;
  truncated: boolean;
}

async function runTemplate(
  ctx: Context,
  template: RecurringJournalRow,
  asOf: LocalDate,
  scale: number,
  autoSubmit: boolean,
  budget: Budget,
): Promise<TemplateResult> {
  const result: TemplateResult = {
    templateId: template.id,
    name: template.name,
    kind: template.kind,
    status: 'up_to_date',
    entries: [],
    nextRunDate: template.nextRunDate,
    more: false,
  };
  const lines = await templateLines(ctx, template.id);
  const checks = await templateLineChecks(ctx, lines);
  const schedule = scheduleOf(template);
  const issues = checkTemplate(schedule, checks, scale);
  const due = dueOccurrences(schedule, lastOccurrenceOf(template), asOf, budget.left + 1);
  if (issues.length > 0) {
    if (due.length === 0) return result;
    result.status = 'failed';
    result.stop = {
      occurrenceDate: due[0]?.date ?? asOf,
      reason: 'invalid_template',
      code: 'VALIDATION',
      message: `recurring_journal ${template.id} is not a valid template`,
      issues,
    };
    return result;
  }
  const plan: Plan = { template, lines, total: allocationTotal(checks), scale, autoSubmit };
  let last: LocalDate | null = null;
  for (const o of due) {
    if (budget.left === 0) {
      budget.truncated = true;
      result.more = true;
      break;
    }
    try {
      await assertOpenPeriod(ctx, o.date);
    } catch (err) {
      if (!(err instanceof StateError)) throw err;
      result.stop = periodStop(err, o.date);
      break;
    }
    try {
      result.entries.push(await createOccurrence(ctx, plan, o));
      budget.left -= 1;
      last = o.date;
    } catch (err) {
      if (!(err instanceof DaifukuError)) throw err;
      ctx.log.warn('recurring journal occurrence failed; rolled back to its savepoint', {
        templateId: template.id,
        occurrenceDate: o.date,
        code: err.code,
        error: err.message,
      });
      result.stop = errorStop(err, o.date);
      break;
    }
  }
  if (last !== null) {
    const moved = await withRecurringCursor(ctx, (w) =>
      repo(w, RecurringJournal).update(template.id, { lastOccurrenceDate: last }),
    );
    result.nextRunDate = moved.nextRunDate;
  }
  result.status = result.stop
    ? result.stop.reason === 'error'
      ? 'failed'
      : 'blocked'
    : result.entries.length > 0
      ? 'generated'
      : 'up_to_date';
  return result;
}

async function candidates(ctx: Context, asOf: LocalDate, templateId: string | undefined) {
  if (templateId) return [await repo(ctx, RecurringJournal).get(templateId)];
  const { items } = await listAll(
    ctx,
    RecurringJournal,
    { where: { isActive: true, nextRunDate: { $lte: asOf } }, orderBy: [{ field: 'id', dir: 'asc' }] },
    MAX_TEMPLATES,
  );
  return items;
}

export async function generateRecurring(
  ctx: Context,
  input: GenerateRecurringInput,
  opts: { maxEntries?: number } = {},
): Promise<GenerateRecurringResult> {
  const autoSubmit = await loadRecurringAutoSubmit(ctx);
  assertCanGenerate(ctx, autoSubmit);
  const asOf = input.asOf ?? todayLocal(ctx.now());
  await withLock(ctx, 'accounting-recurring', async () => undefined);
  const found = await candidates(ctx, asOf, input.templateId);
  const scale = await companyScale(ctx);
  const budget: Budget = { left: opts.maxEntries ?? MAX_RECURRING_ENTRIES, truncated: false };
  const out: GenerateRecurringResult = { asOf, autoSubmit, created: 0, truncated: false, templates: [] };
  for (const candidate of [...found].sort((a, b) => a.id.localeCompare(b.id))) {
    // AC-18: templates not processed for lack of budget are left out of the response; the next call continues
    if (budget.left === 0) {
      budget.truncated = true;
      break;
    }
    // re-read under the row lock: an earlier run may have moved the cursor while this one waited for the series lock
    const template = await repo(ctx, RecurringJournal).lock(candidate.id);
    const base = { templateId: template.id, name: template.name, kind: template.kind, entries: [], more: false };
    if (!template.isActive) {
      if (input.templateId) out.templates.push({ ...base, status: 'inactive', nextRunDate: template.nextRunDate });
      continue;
    }
    if (template.nextRunDate === null || template.nextRunDate > asOf) {
      if (input.templateId) out.templates.push({ ...base, status: 'up_to_date', nextRunDate: template.nextRunDate });
      continue;
    }
    const result = await runTemplate(ctx, template, asOf, scale, autoSubmit, budget);
    out.templates.push(result);
    out.created += result.entries.length;
  }
  out.truncated = budget.truncated;
  return out;
}

export const generateRecurringAction = defineAction({
  name: 'accounting.generate_recurring',
  description: label(
    '定期仕訳の生成: 有効な定期仕訳ごとに、基準日（asOf、省略時は今日）までに期日が来た回を 1 回 1 本の仕訳にします（既定は下書き。会社設定 accounting.recurring_auto_submit が on なら確定）。同じ回は二度作らず、締めた期間・会計期間の無い日付の回でその定期仕訳を止めます（templates[].stop）。按分は総額を回数で割って切り捨て、端数を最終回に寄せます。1 回の呼出しで 200 本まで（truncated / more なら続けて呼ぶ）。templateId で 1 件に絞れます。',
    'Generates recurring journals: for each active template, one journal entry per occurrence due up to asOf (default today), as drafts (submitted when the company setting accounting.recurring_auto_submit is on). An occurrence is never generated twice; a closed or missing fiscal period stops that template at the occurrence (templates[].stop). Allocations spread the total over N periods rounded down, the remainder on the last one. At most 200 entries per call (call again when truncated / more). templateId limits the run to one template.',
  ),
  input: generateRecurringInput,
  output: generateRecurringOutput,
  permission: { entity: RecurringJournal.name, op: 'update' },
  handler: (ctx, input) => generateRecurring(ctx, input),
});
