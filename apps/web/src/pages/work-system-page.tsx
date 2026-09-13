import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useWorkSystemBoard, type WorkSystemBoard } from '../api/fiscal.ts';
import { useMeta } from '../api/queries.ts';
import { formText } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { ReadRecoveryProvider, ReadRefreshNotice } from '../components/read-refresh-notice.tsx';
import { WorkforceDialog } from '../components/workforce-dialog.tsx';
import { WorkSystemEditor, workSystemModes } from '../components/work-system-editor.tsx';
import { WorkSystemCalendar } from '../components/work-system-calendar.tsx';
import { WorkforceHero } from '../components/workforce-shell.tsx';
import { WorkforceEmpty, WorkforceError, WorkforcePanel, WorkforceStatus } from '../components/workforce-shared.tsx';
import { useLocale } from '../i18n.tsx';
import { businessToday } from '../lib/operations.ts';
import { minutesLabel } from '../lib/workforce.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { LoadingView } from './status-views.tsx';
import '../fiscal.css';
type Period = WorkSystemBoard['periods'][number];
const nextMonth = () => {
  const date = new Date(businessToday() + 'T00:00:00Z');
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
};
export function WorkSystemPage() {
  const { t, locale } = useLocale(),
    meta = useMeta(),
    task = useWorkforceTask();
  const [period, setPeriod] = useState(nextMonth),
    [employeeId, setEmployeeId] = useState('');
  const [editing, setEditing] = useState<{ employee: WorkSystemBoard['employees'][number]; original?: Period }>(),
    [decision, setDecision] = useState<{ row: Period; kind: 'confirm' | 'cancel' }>();
  const actions = meta.data?.actions.map((action) => action.name) ?? [],
    allowed = actions.includes('workforce.work_system_board'),
    board = useWorkSystemBoard(period, allowed);
  if (!meta.data && !meta.isError) return <LoadingView />;
  const failed = [meta, board].find((source) => source.isError && !canRetainData(source));
  if (failed)
    return (
      <div className="workspace-page workforce-page">
        <WorkforceError
          error={failed.error}
          onRetry={() => {
            void meta.refetch();
            void board.refetch();
          }}
        />
      </div>
    );
  if (!allowed)
    return (
      <div className="workspace-page">
        <p role="alert">
          {t({ ja: '勤務制度を管理する権限がありません。', en: 'You do not have working-time management access.' })}
        </p>
      </div>
    );
  if (!board.data) return <LoadingView />;
  const data = board.data,
    selected = data.employees.find((employee) => employee.id === employeeId),
    rows = data.periods.filter((row) => !selected || row.employeeId === selected.id);
  return (
    <ReadRecoveryProvider sources={[meta, board]}>
      <div className="workspace-page workforce-page" data-testid="work-system-management">
        <ReadRefreshNotice />
        <WorkforceHero
          title={t({ ja: '働き方を、予定と実績でつなぐ。', en: 'Connect working-time rules with plans and actuals.' })}
          description={t({
            ja: '通常勤務、1か月変形、フレックス。所定カレンダーと合意資料を確認し、開始前に制度を確定します。',
            en: 'Ordinary, one-month variable hours and flex. Verify the calendar and agreements before confirming a period.',
          })}
          management
          side={
            <>
              <strong>{period.replace('-', '.')}</strong>
              <span>{t({ ja: '事前に整える勤務制度', en: 'Plan working-time systems ahead' })}</span>
            </>
          }
        />
        <div className="fiscal-toolbar">
          <label>
            {t({ ja: '表示月', en: 'Month' })}
            <input
              className="input"
              type="month"
              value={period}
              onChange={(event) => {
                if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setPeriod(event.target.value);
              }}
            />
          </label>
          <label>
            {t({ ja: '従業員', en: 'Employee' })}
            <select
              aria-label={t({ ja: '従業員', en: 'Employee' })}
              className="input"
              value={selected?.id ?? ''}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <option value="">{t({ ja: '全従業員', en: 'All employees' })}</option>
              {data.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.code} · {employee.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary"
            disabled={!selected || !actions.includes('workforce.save_work_system')}
            onClick={() => {
              if (selected) setEditing({ employee: selected });
            }}
          >
            {t({ ja: '選択した従業員の制度を作成', en: 'Create a period for this employee' })}
          </button>
          <Link className="btn" to="/workforce/shifts">
            {t({ ja: 'シフト計画へ', en: 'Shift planning' })}
          </Link>
        </div>
        <WorkforcePanel
          title={t({ ja: '勤務期間と所定時間', en: 'Working periods and scheduled time' })}
          icon="calendar"
        >
          {rows.length ? (
            rows.map((row) => {
              const employee = data.employees.find((person) => person.id === row.employeeId);
              return (
                <article className="workforce-record" key={row.id}>
                  <header>
                    <h3>
                      {employee?.name} · {t(workSystemModes[row.mode])}
                    </h3>
                    <WorkforceStatus status={row.status} />
                  </header>
                  <p>
                    {row.startsOn} — {row.endsOn} · {minutesLabel(row.agreedTotalMinutes, locale)}
                  </p>
                  <p>{row.agreementReference}</p>
                  <p>{row.basis}</p>
                  <details>
                    <summary>{t({ ja: '所定カレンダーを見る', en: 'View scheduled calendar' })}</summary>
                    <WorkSystemCalendar days={row.days} readOnly />
                  </details>
                  <div className="workforce-record-actions">
                    {row.status === 'draft' && employee ? (
                      <>
                        <button className="btn" onClick={() => setEditing({ employee, original: row })}>
                          {t({ ja: '編集', en: 'Edit' })}
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={!actions.includes('workforce.confirm_work_system')}
                          onClick={() => setDecision({ row, kind: 'confirm' })}
                        >
                          {t({ ja: '開始前に確定', en: 'Confirm before start' })}
                        </button>
                      </>
                    ) : null}
                    {row.status !== 'cancelled' ? (
                      <button
                        className="btn"
                        disabled={!actions.includes('workforce.cancel_work_system')}
                        onClick={() => setDecision({ row, kind: 'cancel' })}
                      >
                        {t({ ja: '制度を取消', en: 'Cancel period' })}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <WorkforceEmpty>
              {t({
                ja: '対象月の勤務制度はありません。従業員を選択して所定カレンダーを作成してください。',
                en: 'No working-time periods for this month. Select an employee to create a calendar.',
              })}
            </WorkforceEmpty>
          )}
        </WorkforcePanel>
        {editing ? (
          <WorkSystemEditor
            employee={editing.employee}
            period={period}
            {...(editing.original
              ? { original: editing.original, current: data.periods.find((row) => row.id === editing.original?.id) }
              : {})}
            onClose={() => setEditing(undefined)}
          />
        ) : null}
        {decision ? (
          <WorkforceDialog
            title={t(
              decision.kind === 'confirm'
                ? { ja: '所定時間と制度を確定', en: 'Confirm the working-time period' }
                : { ja: '勤務制度を取り消す', en: 'Cancel the working-time period' },
            )}
            description={t({
              ja: '確定後の変更は取消と新しい期間で記録します。給与や公開シフトが依存する場合は、それらとの整合を先に確認してください。',
              en: 'After confirmation, use cancellation and a new period for changes. Resolve dependencies on payroll and published shifts first.',
            })}
            submitLabel={t({ ja: '確認して実行', en: 'Confirm and apply' })}
            stale={data.periods.find((row) => row.id === decision.row.id)?.version !== decision.row.version}
            onClose={() => setDecision(undefined)}
            onSubmit={async (form) => {
              await task.mutateAsync({
                action: `workforce.${decision.kind}_work_system`,
                input: {
                  periodId: decision.row.id,
                  expectedVersion: decision.row.version,
                  reason: formText(form, 'reason'),
                },
              });
            }}
          >
            <label>
              {t({ ja: '確認根拠・理由', en: 'Evidence / reason' })}
              <textarea className="input" name="reason" maxLength={1000} required rows={3} />
            </label>
          </WorkforceDialog>
        ) : null}
      </div>
    </ReadRecoveryProvider>
  );
}
