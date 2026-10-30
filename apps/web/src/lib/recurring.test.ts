// docs/specs/recurring-journals.md AC-3, AC-23, AC-24: ja/en wording of schedule states and stop reasons, the run
// button, the result links, the no-permission explanation and the line lock of an allocation that started generating.
import { describe, expect, it } from 'vitest';
import type { RecordJson } from '../api/types.ts';
import { lineLockReason } from './line-lock.ts';
import {
  autoSubmitNotice,
  canGenerate,
  NO_PERMISSION,
  parseSchedule,
  periodSuffix,
  PLAN_STATUSES,
  PLAN_STATUS_LABEL,
  recurringLineLock,
  resultLinks,
  resultSummary,
  RUN_STATUSES,
  RUN_STATUS_LABEL,
  runButtonLabel,
  scheduleRowHint,
  STOP_REASONS,
  STOP_REASON_LABEL,
  stopHint,
  type GenerateResult,
} from './recurring.ts';

const filled = (l: { ja: string; en: string }) => l.ja.trim() !== '' && l.en.trim() !== '' && l.ja !== l.en;
const record = (values: Record<string, unknown>): RecordJson => ({
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 't',
  companyId: 'c',
  createdAt: '',
  updatedAt: '',
  createdBy: null,
  updatedBy: null,
  version: 1,
  ...values,
});
const result = (over: Partial<GenerateResult> = {}): GenerateResult => ({
  asOf: '2026-10-31',
  autoSubmit: false,
  created: 2,
  truncated: false,
  templates: [],
  ...over,
});

describe('recurring journal screen wording (AC-23, AC-25)', () => {
  it('AC-23 every state, run status and stop reason has ja and en text; hints differ for allocations', () => {
    for (const s of PLAN_STATUSES) expect(filled(PLAN_STATUS_LABEL[s]), s).toBe(true);
    for (const s of RUN_STATUSES) expect(filled(RUN_STATUS_LABEL[s]), s).toBe(true);
    for (const r of STOP_REASONS) {
      expect(filled(STOP_REASON_LABEL[r]), r).toBe(true);
      expect(filled(stopHint(r, false)), r).toBe(true);
    }
    expect(stopHint('closed_period', true).ja).toContain('按分の回の日付は変えられません');
    expect(stopHint('closed_period', false).ja).not.toContain('按分');
    // server hints are English technical text; the screen never shows them as its explanation
    expect(stopHint('closed_period', false).ja).not.toMatch(/open the period/);
  });

  it('AC-23 the button and the notice follow the auto-submit setting', () => {
    expect(runButtonLabel(false)).toEqual({ ja: '下書きを生成', en: 'Generate drafts' });
    expect(runButtonLabel(true)).toEqual({ ja: '生成して確定', en: 'Generate and submit' });
    expect(autoSubmitNotice(true).ja).toContain('確定');
    expect(autoSubmitNotice(false).ja).toContain('下書き');
  });

  it('AC-23 the schedule is parsed defensively; the run is offered only when an occurrence is due', () => {
    const schedule = parseSchedule({
      rows: [
        {
          templateId: 't1',
          templateName: '家賃',
          occurrenceDate: '2026-10-31',
          occurrence: '',
          amount: '1000',
          periodCode: '2026-10',
          status: 'due',
          reason: null,
          detail: null,
        },
        {
          templateId: 't2',
          templateName: '保険',
          occurrenceDate: '2026-09-30',
          occurrence: '3/12',
          amount: '8333',
          periodCode: '2026-09',
          status: 'blocked',
          reason: 'closed_period',
          detail: null,
        },
        { templateId: 't3', templateName: '?', occurrenceDate: '2026-09-30', status: 'weird', reason: 'odd' },
      ],
      meta: { asOf: '2026-10-31', autoSubmit: true, truncated: false },
    });
    expect(schedule).toMatchObject({ asOf: '2026-10-31', autoSubmit: true, truncated: false });
    expect(schedule.rows.map((r) => [r.status, r.reason])).toEqual([
      ['due', null],
      ['blocked', 'closed_period'],
      ['blocked', 'error'],
    ]);
    expect(canGenerate(schedule)).toBe(true);
    expect(canGenerate({ ...schedule, rows: schedule.rows.slice(1) })).toBe(false);
    expect(canGenerate(undefined)).toBe(false);
    expect(parseSchedule(undefined).rows).toEqual([]);
  });

  it('AC-21 AC-23 a stopping schedule row explains what to do (allocation advice for k/N rows); due rows have no hint', () => {
    const row = { reason: null, occurrence: '' } as const;
    expect(scheduleRowHint(row)).toBeUndefined();
    expect(scheduleRowHint({ ...row, reason: 'closed_period' })).toEqual(stopHint('closed_period', false));
    expect(scheduleRowHint({ reason: 'closed_period', occurrence: '3/12' })?.ja).toContain(
      '按分の回の日付は変えられません',
    );
    expect(scheduleRowHint({ ...row, reason: 'invalid_template' })).toEqual(stopHint('invalid_template', false));
    expect(periodSuffix('2026-09')).toEqual({ ja: '（2026-09）', en: ' (2026-09)' });
    expect(periodSuffix(undefined)).toBeUndefined();
  });

  it('AC-23 result links: the journal list, and the close guide only for drafts; none when nothing was created', () => {
    expect(resultLinks(result()).map((l) => l.href)).toEqual(['/e/journal_entry', '/finance/close']);
    expect(resultLinks(result({ autoSubmit: true })).map((l) => l.href)).toEqual(['/e/journal_entry']);
    expect(resultLinks(result({ created: 0 }))).toEqual([]);
    expect(resultSummary(result()).ja).toBe('2 本の仕訳を下書きで生成しました。');
    expect(resultSummary(result({ created: 1, truncated: true })).en).toContain('generate again to continue');
  });
});

describe('access and the line lock (AC-24, AC-3)', () => {
  it('AC-24 a user who cannot run the generation gets an explanation in both languages', () => {
    expect(filled(NO_PERMISSION.title)).toBe(true);
    expect(NO_PERMISSION.description.ja).toContain('経理');
  });

  it('AC-3 an allocation that has started generating locks its grid with a reason; other records do not', () => {
    const generated = record({ kind: 'allocation', lastOccurrenceDate: '2026-10-31' });
    const lock = recurringLineLock('recurring_journal', generated);
    expect(lock?.ja).toBe('生成を始めた按分の明細は変更できません。複製して作り直してください');
    expect(
      recurringLineLock('recurring_journal', record({ kind: 'allocation', lastOccurrenceDate: null })),
    ).toBeUndefined();
    expect(
      recurringLineLock('recurring_journal', record({ kind: 'fixed', lastOccurrenceDate: '2026-10-31' })),
    ).toBeUndefined();
    expect(recurringLineLock('journal_entry', generated)).toBeUndefined();
    expect(recurringLineLock('recurring_journal', undefined)).toBeUndefined();
    const state = { canWrite: true, saving: false, actionBusy: false, conflict: false, frozen: false };
    expect(lineLockReason({ ...state, locked: lock })).toEqual(lock);
    expect(lineLockReason(state)).toBeUndefined();
    // view mode still explains itself first
    expect(lineLockReason({ ...state, canWrite: false, locked: lock })?.en).toBe(
      'Lines cannot be changed in view mode.',
    );
  });
});
