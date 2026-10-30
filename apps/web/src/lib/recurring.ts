// /finance/recurring — pure logic of the recurring journal screen (docs/specs/recurring-journals.md AC-3, AC-23..AC-25):
// the ja/en wording of schedule states and stop reasons (server messages and hints are English technical details and
// stay in the closed <details>), the run button, the result's links and the line-grid lock of an allocation that has
// started generating. No DOM here (recurring.test.ts).
import type { Label, RecordJson } from '../api/types.ts';

export const GENERATE_RECURRING_ACTION = 'accounting.generate_recurring';
export const RECURRING_SCHEDULE_ACTION = 'accounting.recurring_schedule';
export const RECURRING_ENTITY = 'recurring_journal';

export const PLAN_STATUSES = ['due', 'blocked', 'after_blocked', 'invalid_template'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const RUN_STATUSES = ['generated', 'up_to_date', 'blocked', 'failed', 'inactive'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const STOP_REASONS = ['closed_period', 'closed_year', 'no_period', 'error', 'invalid_template'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface ScheduleRow {
  templateId: string;
  templateName: string;
  occurrenceDate: string;
  occurrence: string;
  amount: string;
  periodCode: string | null;
  status: PlanStatus;
  reason: StopReason | null;
  detail: string | null;
}
export interface Schedule {
  rows: ScheduleRow[];
  asOf: string;
  autoSubmit: boolean;
  truncated: boolean;
}

export interface GeneratedEntry {
  occurrenceDate: string;
  occurrenceNo: number | null;
  entryId: string;
  number: string | null;
  docstatus: number;
  amount: string;
}
export interface RunStop {
  occurrenceDate: string;
  reason: StopReason;
  code: string;
  message: string;
  hint?: string;
  periodCode?: string;
  fiscalYearCode?: string;
  issues?: { path: string; message: string }[];
}
export interface TemplateRun {
  templateId: string;
  name: string;
  kind: 'fixed' | 'allocation';
  status: RunStatus;
  entries: GeneratedEntry[];
  nextRunDate: string | null;
  more: boolean;
  stop?: RunStop;
}
export interface GenerateResult {
  asOf: string;
  autoSubmit: boolean;
  created: number;
  truncated: boolean;
  templates: TemplateRun[];
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T =>
  (values as readonly unknown[]).includes(v) ? (v as T) : fallback;

/** The TableResult of accounting.recurring_schedule as the screen uses it (unknown codes fall back safely). */
export function parseSchedule(raw: { rows?: unknown; meta?: unknown } | undefined): Schedule {
  const meta = (raw?.meta ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(raw?.rows) ? (raw.rows as Record<string, unknown>[]) : [];
  return {
    asOf: text(meta.asOf),
    autoSubmit: meta.autoSubmit === true,
    truncated: meta.truncated === true,
    rows: rows.map((r) => ({
      templateId: text(r.templateId),
      templateName: text(r.templateName),
      occurrenceDate: text(r.occurrenceDate),
      occurrence: text(r.occurrence),
      amount: text(r.amount),
      periodCode: r.periodCode === null || r.periodCode === undefined ? null : text(r.periodCode),
      status: oneOf(PLAN_STATUSES, r.status, 'blocked'),
      reason: r.reason === null || r.reason === undefined ? null : oneOf(STOP_REASONS, r.reason, 'error'),
      detail: r.detail === null || r.detail === undefined ? null : text(r.detail),
    })),
  };
}

export const PLAN_STATUS_LABEL: Readonly<Record<PlanStatus, Label>> = {
  due: { ja: '生成する', en: 'To generate' },
  blocked: { ja: '止まる', en: 'Stops here' },
  after_blocked: { ja: '止まった回より後', en: 'After the stop' },
  invalid_template: { ja: '定期仕訳の内容に誤り', en: 'Template has errors' },
};

export const RUN_STATUS_LABEL: Readonly<Record<RunStatus, Label>> = {
  generated: { ja: '生成しました', en: 'Generated' },
  up_to_date: { ja: '生成する回はありません', en: 'Nothing due' },
  blocked: { ja: '期間で止まりました', en: 'Stopped at a period' },
  failed: { ja: '生成できませんでした', en: 'Could not generate' },
  inactive: { ja: '無効です', en: 'Inactive' },
};

export const STOP_REASON_LABEL: Readonly<Record<StopReason, Label>> = {
  closed_period: { ja: '会計期間が締め済みです', en: 'The fiscal period is closed' },
  closed_year: { ja: '会計年度が締め済みです', en: 'The fiscal year is closed' },
  no_period: { ja: 'この日付を含む会計期間がありません', en: 'No fiscal period contains this date' },
  error: { ja: '仕訳を作れませんでした', en: 'The journal entry could not be created' },
  invalid_template: { ja: '定期仕訳の内容に誤りがあります', en: 'The recurring journal has errors' },
};

/** What to do about a stop; allocations cannot move an occurrence to another date, so the advice differs. */
export function stopHint(reason: StopReason, allocation: boolean): Label {
  switch (reason) {
    case 'closed_period':
    case 'closed_year':
      return allocation
        ? {
            ja: '期間を再開してから、もう一度生成してください。按分の回の日付は変えられません。',
            en: 'Reopen the period, then generate again. The dates of an allocation cannot be changed.',
          }
        : {
            ja: '期間を再開してから生成するか、要らない回なら定期仕訳の開始日を後ろにずらしてください。',
            en: 'Reopen the period and generate again, or move the start date later if the occurrence is not needed.',
          };
    case 'no_period':
      return {
        ja: '会計年度を開いてから、もう一度生成してください。',
        en: 'Open the fiscal year, then generate again.',
      };
    case 'invalid_template':
      return {
        ja: '定期仕訳を開いて明細（借方・貸方の一致、取引先など）を直してから生成してください。',
        en: 'Open the recurring journal, fix its lines (balanced debits and credits, partners), then generate again.',
      };
    case 'error':
      return {
        ja: '技術情報の内容を確かめ、定期仕訳や勘定科目を直してから、もう一度生成してください。',
        en: 'Check the technical details, fix the recurring journal or its accounts, then generate again.',
      };
  }
}

/**
 * What to do about a schedule row that stops (blocked or invalid_template), shown under the row so a template that
 * cannot generate explains itself even while the run button is disabled. An allocation row carries `k/N`.
 */
export function scheduleRowHint(row: Pick<ScheduleRow, 'reason' | 'occurrence'>): Label | undefined {
  return row.reason ? stopHint(row.reason, row.occurrence !== '') : undefined;
}

/** A period code after a reason: full-width parentheses in Japanese, a space and ASCII ones in English. */
export function periodSuffix(code: string | undefined): Label | undefined {
  return code ? { ja: `（${code}）`, en: ` (${code})` } : undefined;
}

export function runButtonLabel(autoSubmit: boolean): Label {
  return autoSubmit ? { ja: '生成して確定', en: 'Generate and submit' } : { ja: '下書きを生成', en: 'Generate drafts' };
}

export function autoSubmitNotice(autoSubmit: boolean): Label {
  return autoSubmit
    ? {
        ja: '会社の設定により、生成と同時に確定します（転記されます）。',
        en: 'The company setting submits the entries as they are generated (they are posted).',
      }
    : {
        ja: '生成した仕訳は下書きです。内容を確かめてから仕訳の画面で確定してください。',
        en: 'Generated entries are drafts. Review and submit them on the journal entry screen.',
      };
}

export const dueRows = (schedule: Schedule): ScheduleRow[] => schedule.rows.filter((r) => r.status === 'due');

/** The run is worth starting when an occurrence would be generated (a blocked one is reported again, nothing new). */
export const canGenerate = (schedule: Schedule | undefined): boolean => !!schedule && dueRows(schedule).length > 0;

/** Links shown after a run: the journal list and, when drafts were made, the close guide that counts them (AC-23). */
export function resultLinks(result: GenerateResult): { href: string; label: Label }[] {
  if (result.created === 0) return [];
  const links = [{ href: '/e/journal_entry', label: { ja: '仕訳の一覧', en: 'Journal entries' } }];
  if (!result.autoSubmit)
    links.push({ href: '/finance/close', label: { ja: '月次締めガイド', en: 'Month-end close' } });
  return links;
}

export function resultSummary(result: GenerateResult): Label {
  const stopped = result.templates.filter((t) => t.stop).length;
  const ja =
    `${result.created} 本の仕訳を${result.autoSubmit ? '生成・確定' : '下書きで生成'}しました` +
    (stopped ? `。${stopped} 件の定期仕訳が止まっています` : '') +
    (result.truncated ? '。上限に達したため、もう一度生成すると続きを作ります' : '');
  const en =
    `${result.created} journal ${result.created === 1 ? 'entry' : 'entries'} ${result.autoSubmit ? 'generated and submitted' : 'generated as drafts'}` +
    (stopped ? `; ${stopped} recurring journal${stopped === 1 ? '' : 's'} stopped` : '') +
    (result.truncated ? '; the per-run limit was reached, generate again to continue' : '');
  return { ja: ja + '。', en: en + '.' };
}

/** The explanation shown on a direct visit by someone who cannot run the generation (AC-24). */
export const NO_PERMISSION: { title: Label; description: Label } = {
  title: { ja: '定期仕訳を生成する権限がありません', en: 'You cannot generate recurring journals' },
  description: {
    ja: '経理または管理者の役割が必要です。定期仕訳の登録内容は、閲覧できる場合は定期仕訳の一覧で確認できます。',
    en: 'The accounting or admin role is required. If you can view them, the recurring journals are in their list.',
  },
};

/**
 * AC-3: the line grid of a recurring journal is read-only once an allocation has generated an occurrence (the server
 * refuses changes to its rows, accounts and amounts, AC-8). Other entities and other states: no lock.
 */
export function recurringLineLock(entityName: string, record: RecordJson | undefined): Label | undefined {
  if (entityName !== RECURRING_ENTITY || !record) return undefined;
  if (record.kind !== 'allocation' || !record.lastOccurrenceDate) return undefined;
  return {
    ja: '生成を始めた按分の明細は変更できません。複製して作り直してください',
    en: 'Lines of an allocation that has started generating cannot be changed. Duplicate it to start over.',
  };
}
