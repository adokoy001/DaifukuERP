// accounting.recurring_schedule (docs/specs/recurring-journals.md AC-21): the occurrences generation would create up to
// asOf, one row each, decided by the same pure functions (services/recurrence.ts planTemplate): `due`, `blocked` (the
// first one in a closed or missing period), `invalid_template` (the first one of a template that fails the AC-7 rules)
// and `after_blocked` (every later one of that template). Read-only; every read goes through the caller's context.
import {
  column,
  defineAction,
  label,
  MAX_REPORT_ROWS,
  tableResult,
  todayLocal,
  type Context,
  type LocalDate,
  type TableResult,
} from '@daifuku/kernel';
import { z } from 'zod';
import { FiscalPeriod } from '../entities/fiscal-period.ts';
import { FiscalYear } from '../entities/fiscal-year.ts';
import { RecurringJournal } from '../entities/recurring-journal.ts';
import { companyScale, lastOccurrenceOf, scheduleOf, templateLineChecks, templateLines } from '../recurring-load.ts';
import { checkTemplate, PLAN_STATUSES, planTemplate } from '../services/recurrence.ts';
import { loadRecurringAutoSubmit } from '../settings.ts';
import { listAll, localDate } from './helpers.ts';

export const recurringScheduleInput = z.object({ asOf: localDate.optional() });

export const RECURRING_SCHEDULE_COLUMNS = [
  column('templateName', label('定期仕訳', 'Recurring journal'), 'text'),
  column('occurrenceDate', label('回の日付', 'Occurrence date'), 'date'),
  column('occurrence', label('回', 'Occurrence'), 'text'),
  column('amount', label('金額（借方合計）', 'Amount (total debit)'), 'decimal'),
  column('periodCode', label('会計期間', 'Fiscal period'), 'text'),
  column('status', label('状態', 'Status'), 'text'),
  column('reason', label('理由', 'Reason'), 'text'),
  column('detail', label('検査の要約', 'Check summary'), 'text'),
  column('templateId', label('定期仕訳 ID', 'Recurring journal id'), 'ref', { ref: RecurringJournal.name }),
];

const MAX_TEMPLATES = 5000;

export async function recurringSchedule(ctx: Context, asOfInput: LocalDate | undefined): Promise<TableResult> {
  const asOf = asOfInput ?? todayLocal(ctx.now());
  const templates = await listAll(
    ctx,
    RecurringJournal,
    { where: { isActive: true, nextRunDate: { $lte: asOf } }, orderBy: [{ field: 'id', dir: 'asc' }] },
    MAX_TEMPLATES,
  );
  const periods = (await listAll(ctx, FiscalPeriod, { orderBy: [{ field: 'startDate', dir: 'asc' }] }, 10000)).items;
  const years = (await listAll(ctx, FiscalYear, {}, 10000)).items;
  const scale = await companyScale(ctx);
  const rows: Record<string, unknown>[] = [];
  let truncated = templates.truncated;
  for (const t of templates.items) {
    const lines = await templateLineChecks(ctx, await templateLines(ctx, t.id));
    const schedule = scheduleOf(t);
    const issues = checkTemplate(schedule, lines, scale);
    const left = MAX_REPORT_ROWS - rows.length;
    const planned = planTemplate({
      schedule,
      lastOccurrenceDate: lastOccurrenceOf(t),
      lines,
      scale,
      asOf,
      max: left + 1,
      periods,
      years,
    });
    if (planned.length > left) truncated = true;
    for (const p of planned.slice(0, left))
      rows.push({
        templateName: t.name,
        occurrenceDate: p.date,
        occurrence: t.kind === 'allocation' ? `${p.no}/${t.allocationPeriods ?? 0}` : '',
        amount: p.amount.toString(),
        periodCode: p.periodCode,
        status: p.status,
        reason: p.reason,
        detail: p.status === 'invalid_template' ? issues.map((i) => `${i.path}: ${i.message}`).join('; ') : null,
        templateId: t.id,
      });
    if (rows.length >= MAX_REPORT_ROWS) break;
  }
  rows.sort((a, b) =>
    a.occurrenceDate === b.occurrenceDate
      ? String(a.templateName).localeCompare(String(b.templateName))
      : String(a.occurrenceDate) < String(b.occurrenceDate)
        ? -1
        : 1,
  );
  const counts = Object.fromEntries(PLAN_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  return {
    title: label(`定期仕訳の予定（${asOf} まで）`, `Recurring journals due up to ${asOf}`),
    columns: RECURRING_SCHEDULE_COLUMNS,
    rows,
    meta: { asOf, autoSubmit: await loadRecurringAutoSubmit(ctx), truncated, counts },
  };
}

export const recurringScheduleAction = defineAction({
  name: 'accounting.recurring_schedule',
  description: label(
    '定期仕訳の予定: 基準日（asOf、省略時は今日）までに期日が来た回を 1 行ずつ、金額・会計期間・状態（due = 生成する、blocked = 締めた期間・会計期間なしで止まる、invalid_template = 定期仕訳の内容が不正、after_blocked = 止まった回より後）で返します。生成はしません。',
    'Recurring journal schedule: one row per occurrence due up to asOf (default today) with its amount, fiscal period and status (due = will be generated, blocked = stops at a closed or missing period, invalid_template = the template is invalid, after_blocked = after a stop). Generates nothing.',
  ),
  input: recurringScheduleInput,
  output: tableResult,
  exportEntities: ['recurring_journal', 'recurring_journal_line', 'account', 'fiscal_period', 'fiscal_year'],
  permission: { entity: RecurringJournal.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => recurringSchedule(ctx, input.asOf),
});
