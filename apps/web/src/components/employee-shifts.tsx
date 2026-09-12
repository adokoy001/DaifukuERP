import { useState } from 'react';
import type { ShiftAvailabilityDay } from '@daifuku/mod-workforce/scheduling';
import { useMyShifts, type MyShifts } from '../api/shifts.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { emptyAvailability, minuteTime, shiftMonday, shiftHours } from '../lib/shift.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { ReadRecoveryProvider, ReadRefreshNotice } from './read-refresh-notice.tsx';
import { ShiftTimeInput } from './shift-time-input.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceEmpty, WorkforceError } from './workforce-shared.tsx';
import '../shifts.css';
function AvailabilityEditor({ data, stale, onClose }: { data: MyShifts; stale: boolean; onClose: () => void }) {
  const { t } = useLocale(), task = useWorkforceTask();
  const [days, setDays] = useState<ShiftAvailabilityDay[]>(data.availability?.days ?? emptyAvailability(data.weekStart));
  const patch = (date: string, value: Partial<ShiftAvailabilityDay>) => setDays((rows) => rows.map((row) => row.date === date ? { ...row, ...value } : row));
  return <WorkforceDialog title={t({ ja: '1週間の勤務希望を提出', en: 'Submit weekly availability' })} submitLabel={t({ ja: '7日分の希望を提出', en: 'Submit all seven days' })} onClose={onClose} stale={stale} confirmOnly onSubmit={async () => { await task.mutateAsync({ action: 'workforce.save_shift_availability', input: { weekStart: data.weekStart, expectedVersion: data.availability?.version ?? 0, days } }); }}>
    <p className="workforce-notice">{t({ ja: '初期値は全日「勤務不可」です。希望する日と時間を確認してください。提出しても勤務の確定ではありません。', en: 'Every day initially defaults to unavailable. Review your dates and hours. Submission does not publish a shift assignment.' })}</p>
    {days.map((day) => <section className="shift-availability-day" key={day.date}><h3>{day.date}</h3><label>{t({ ja: '勤務希望', en: 'Preference' })}<select className="input" value={day.preference} onChange={(event) => patch(day.date, { preference: event.target.value as ShiftAvailabilityDay['preference'] })}><option value="unavailable">{t({ ja: '勤務不可', en: 'Unavailable' })}</option><option value="available">{t({ ja: '勤務可能', en: 'Available' })}</option><option value="preferred">{t({ ja: '優先して勤務希望', en: 'Preferred' })}</option></select></label>{day.preference !== 'unavailable' ? <div className="workforce-form-row"><ShiftTimeInput label={t({ ja: '勤務可能な開始', en: 'Available from' })} value={day.startMinute} onChange={(startMinute) => patch(day.date, { startMinute })} /><ShiftTimeInput label={t({ ja: '勤務可能な終了', en: 'Available until' })} dayEnd value={day.endMinute} onChange={(endMinute) => patch(day.date, { endMinute })} /></div> : null}</section>)}
  </WorkforceDialog>;
}
function MyShiftWeek({ weekStart }: { weekStart: string }) {
  const { t } = useLocale(), query = useMyShifts(weekStart), [editing, setEditing] = useState<MyShifts>();
  if (query.isError && !canRetainData(query)) return <WorkforceError error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <p role="status">{t({ ja: 'シフトを読込中…', en: 'Loading shifts…' })}</p>;
  const data = query.data;
  return <ReadRecoveryProvider sources={[query]}><ReadRefreshNotice /><button className="btn shift-refresh" disabled={query.isFetching} onClick={() => void query.refetch()}>{t({ ja: '希望・公開予定を再取得', en: 'Refresh availability and published shifts' })}</button><div className="workforce-panel"><header className="workforce-panel-heading"><div><h2>{t({ ja: '勤務希望', en: 'My availability' })}</h2><p>{data.availability ? t({ ja: '提出済み。変更は管理側の再確認対象になります。', en: 'Submitted. Changes require the planner to recheck published shifts.' }) : t({ ja: '未提出です。提出するまで推薦の候補になりません。', en: 'Not submitted. You cannot be recommended until you submit availability.' })}</p></div>{data.employee ? <button className="btn btn-primary" onClick={() => setEditing(data)}>{t(data.availability ? { ja: '希望を更新', en: 'Update availability' } : { ja: '希望を提出', en: 'Submit availability' })}</button> : null}</header>
    {!data.employee ? <WorkforceEmpty>{t({ ja: '従業員登録が必要です。管理者へ確認してください。', en: 'Ask an administrator to register your employee record.' })}</WorkforceEmpty> : data.availability ? <div className="shift-my-days">{data.availability.days.map((day) => <article key={day.date}><strong>{day.date}</strong><span>{day.preference === 'unavailable' ? t({ ja: '勤務不可', en: 'Unavailable' }) : `${minuteTime(day.startMinute)}–${minuteTime(day.endMinute)} · ${t(day.preference === 'preferred' ? { ja: '勤務希望', en: 'Preferred' } : { ja: '勤務可能', en: 'Available' })}`}</span></article>)}</div> : null}
  </div>{data.profile ? <p className="shift-notice">{t({ ja: '現在の勤務条件 · 週の目標 / 上限', en: 'Current profile · weekly target / maximum' })}: {shiftHours(data.profile.profile.targetMinutes)} / {shiftHours(data.profile.profile.maxWeeklyMinutes)} · {data.profile.profile.skills.join(' / ')}</p> : data.employee ? <p className="workforce-notice">{t({ ja: '勤務条件が未設定です。管理者へ登録を依頼してください。希望を提出しても条件設定までは推薦対象になりません。', en: 'Your work profile is missing. Ask a manager to configure it. Availability alone does not make you eligible for recommendations.' })}</p> : null}<section className="workforce-panel"><h2>{t({ ja: '公開された自分の勤務', en: 'My published shifts' })}</h2><p className="shift-muted">{t({ ja: '下書きや他の社員の勤務は表示しません。予定と打刻実績は別の記録です。フレックスの時刻は本人の選択を尊重する調整案として確認してください。', en: 'Drafts and other employees are not shown. Plans and actual attendance are separate records. Flex shift times are coordination proposals that respect the employee’s choice.' })}</p>{data.assignments.length ? <div className="shift-my-days">{data.assignments.map((row) => <article key={row.id}><strong>{row.date} · {row.label}</strong><span>{minuteTime(row.startMinute)}–{minuteTime(row.endMinute)} · {row.breakMinutes}{t({ ja: '分休憩', en: ' min break' })}</span></article>)}</div> : <WorkforceEmpty icon="calendar">{t({ ja: 'この週の勤務はまだ公開されていません。', en: 'No shifts have been published for you this week.' })}</WorkforceEmpty>}</section>
    {editing ? <AvailabilityEditor data={editing} stale={editing.availability?.version !== data.availability?.version} onClose={() => setEditing(undefined)} /> : null}
  </ReadRecoveryProvider>;
}
export function EmployeeShifts() {
  const { t } = useLocale(), [weekStart, setWeekStart] = useState(() => shiftMonday());
  return <div className="workforce-stack" data-testid="my-shifts"><label className="shift-week-filter">{t({ ja: '希望・予定の週（月曜）', en: 'Availability week (Monday)' })}<input className="input" type="date" value={weekStart} onChange={(event) => { if (event.target.value) setWeekStart(shiftMonday(event.target.value)); }} /></label><MyShiftWeek key={weekStart} weekStart={weekStart} /></div>;
}
