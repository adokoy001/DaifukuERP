import { useRef, useState } from 'react';
import { formText, tokyoTimestamp, type AttendanceSummary, type CorrectionSummary } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { dateTimeInput, minutesLabel, timeLabel } from '../lib/workforce.ts';
import { Icon } from './icon.tsx';
import { useToast } from './toast.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceEmpty, WorkforceError, WorkforcePanel, WorkforceStatus } from './workforce-shared.tsx';

const punches = [
  { kind: 'clock_in', label: { ja: '出勤する', en: 'Clock in' }, enabled: [undefined], primary: true },
  { kind: 'clock_out', label: { ja: '退勤する', en: 'Clock out' }, enabled: ['working'], primary: true },
  { kind: 'break_start', label: { ja: '休憩に入る', en: 'Start break' }, enabled: ['working'] },
  { kind: 'break_end', label: { ja: '休憩を終える', en: 'End break' }, enabled: ['break'] },
];

export function WorkforceClock({
  attendance,
  today,
  registered,
  onHistory,
}: {
  attendance: AttendanceSummary | null;
  today: string;
  registered: boolean;
  onHistory: (period: string) => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const task = useWorkforceTask();
  const lock = useRef(false);
  const keys = useRef(new Map<string, string>());
  const [error, setError] = useState<unknown>();
  const punch = async (kind: string) => {
    if (lock.current) return;
    lock.current = true;
    setError(undefined);
    const operation = kind + ':' + (attendance?.id ?? today) + ':' + (attendance?.version ?? 0);
    const key = keys.current.get(operation) ?? crypto.randomUUID();
    keys.current.set(operation, key);
    try {
      await task.mutateAsync({
        action: 'workforce.punch',
        input: { kind, expectedVersion: attendance?.version ?? 0, idempotencyKey: key },
      });
      keys.current.delete(operation);
      toast.success(t({ ja: '打刻を記録しました', en: 'Time recorded' }));
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
    }
  };
  const shiftDate = attendance?.workDate ?? today;
  return (
    <section className="workforce-panel workforce-clock-card" aria-label={t({ ja: '今日の打刻', en: 'Today’s clock' })}>
      <div className="workforce-clock-top">
        <span>
          {shiftDate.replaceAll('-', '.')} ·{' '}
          {shiftDate === today
            ? t({ ja: '今日の勤務', en: 'Today’s work' })
            : t({ ja: '継続中の勤務', en: 'Ongoing shift' })}
        </span>
        {attendance ? (
          <WorkforceStatus status={attendance.status} />
        ) : (
          <span className="workforce-status">{t({ ja: '未出勤', en: 'Not clocked in' })}</span>
        )}
      </div>
      <strong className="workforce-clock">{attendance ? timeLabel(attendance.clockIn) : '—:—'}</strong>
      <p className="workforce-clock-label">
        {t({ ja: '出勤時刻', en: 'Clock-in time' })}
        {attendance?.clockOut ? ' · ' + minutesLabel(attendance.workedMinutes, locale) : ''}
      </p>
      <div className="workforce-punches">
        {punches.map((button) => (
          <button
            type="button"
            key={button.kind}
            className="workforce-punch"
            data-primary={button.primary}
            disabled={!registered || task.isPending || !button.enabled.some((value) => value === attendance?.status)}
            onClick={() => void punch(button.kind)}
          >
            <Icon name={button.kind.startsWith('break') ? 'clock' : 'arrow'} size={20} />
            {t(button.label)}
          </button>
        ))}
      </div>
      <p className="workforce-footer-note">
        {t({
          ja: '打刻ボタンを押した時点の時刻を記録します。打刻後は下の記録を確認してください。',
          en: 'Your time is recorded when the request is received. Check the recorded times below.',
        })}
      </p>
      {attendance && shiftDate !== today ? (
        <div className="workforce-notice">
          <p>
            {t({
              ja: '前の日から続く勤務です。退勤を忘れた場合は、勤務を始めた月の記録から訂正を申請してください。',
              en: 'This shift began on an earlier day. If you forgot to clock out, request a correction from the month when it began.',
            })}
          </p>
          <button type="button" className="btn" onClick={() => onHistory(shiftDate.slice(0, 7))}>
            {t({ ja: 'この勤務の記録を開く', en: 'Open this attendance record' })}
          </button>
        </div>
      ) : null}
      {attendance ? (
        <dl className="workforce-definition">
          <div>
            <dt>{t({ ja: '出勤', en: 'Clock in' })}</dt>
            <dd>{timeLabel(attendance.clockIn)}</dd>
          </div>
          <div>
            <dt>{t({ ja: '退勤', en: 'Clock out' })}</dt>
            <dd>{timeLabel(attendance.clockOut)}</dd>
          </div>
          {attendance.breaks.map((item, i) => (
            <div key={i}>
              <dt>
                {t({ ja: '休憩', en: 'Break' })} {i + 1}
              </dt>
              <dd>
                {timeLabel(item.start)} — {timeLabel(item.end)}
              </dd>
            </div>
          ))}
          {attendance.breakStartedAt ? (
            <div>
              <dt>{t({ ja: '休憩開始', en: 'Current break began' })}</dt>
              <dd>{timeLabel(attendance.breakStartedAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {error ? <WorkforceError error={error} /> : null}
    </section>
  );
}

function CorrectionForm({
  attendance,
  stale,
  onClose,
}: {
  attendance: AttendanceSummary;
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const task = useWorkforceTask();
  const [key] = useState(() => crypto.randomUUID());
  const [breaks, setBreaks] = useState(attendance.breaks);
  return (
    <WorkforceDialog
      title={t({ ja: '勤怠の訂正を申請', en: 'Request an attendance correction' })}
      description={
        attendance.workDate +
        ' · ' +
        t({
          ja: '変更後の時刻と理由を入力します。承認されるまで元の勤怠は変わりません。時刻は日本時間です。',
          en: 'Enter corrected times and a reason. Original attendance remains until approval. Times are Japan time.',
        })
      }
      submitLabel={t({ ja: '訂正を申請', en: 'Request correction' })}
      stale={stale}
      onClose={onClose}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'workforce.request_correction',
          input: {
            attendanceId: attendance.id,
            expectedVersion: attendance.version,
            idempotencyKey: key,
            clockIn: tokyoTimestamp(formText(data, 'clockIn')),
            clockOut: tokyoTimestamp(formText(data, 'clockOut')),
            breaks: breaks.map((_, i) => ({
              start: tokyoTimestamp(formText(data, `breakStart${i}`)),
              end: tokyoTimestamp(formText(data, `breakEnd${i}`)),
            })),
            reason: formText(data, 'reason'),
          },
        });
      }}
    >
      <div className="workforce-form-row">
        <label>
          {t({ ja: '訂正後の出勤', en: 'Corrected clock in' })}
          <input
            className="input"
            name="clockIn"
            type="datetime-local"
            step="1"
            required
            defaultValue={dateTimeInput(attendance.clockIn)}
          />
        </label>
        <label>
          {t({ ja: '訂正後の退勤', en: 'Corrected clock out' })}
          <input
            className="input"
            name="clockOut"
            type="datetime-local"
            step="1"
            required
            defaultValue={attendance.clockOut ? dateTimeInput(attendance.clockOut) : ''}
          />
        </label>
      </div>
      {breaks.map((item, i) => (
        <div className="workforce-form-row" key={i}>
          <label>
            {t({ ja: '休憩開始', en: 'Break starts' })} {i + 1}
            <input
              className="input"
              name={`breakStart${i}`}
              type="datetime-local"
              step="1"
              required
              defaultValue={dateTimeInput(item.start)}
            />
          </label>
          <label>
            {t({ ja: '休憩終了', en: 'Break ends' })} {i + 1}
            <input
              className="input"
              name={`breakEnd${i}`}
              type="datetime-local"
              step="1"
              required
              defaultValue={dateTimeInput(item.end)}
            />
          </label>
        </div>
      ))}
      <div className="button-row">
        <button
          type="button"
          className="btn"
          data-draft-change
          disabled={breaks.length >= 20}
          onClick={() => setBreaks([...breaks, { start: '', end: '' }])}
        >
          {t({ ja: '休憩を追加', en: 'Add break' })}
        </button>
        {breaks.length ? (
          <button type="button" className="btn" data-draft-change onClick={() => setBreaks(breaks.slice(0, -1))}>
            {t({ ja: '最後の休憩を除く', en: 'Remove last break' })}
          </button>
        ) : null}
      </div>
      <label>
        {t({ ja: '訂正する理由', en: 'Reason for correction' })}
        <textarea className="input" name="reason" required maxLength={1000} rows={3} />
      </label>
    </WorkforceDialog>
  );
}

export function WorkforceAttendance({
  rows,
  corrections,
  actions,
}: {
  rows: AttendanceSummary[];
  corrections: CorrectionSummary[];
  actions: string[];
}) {
  const { t, locale } = useLocale();
  const task = useWorkforceTask();
  const [selected, setSelected] = useState<AttendanceSummary>();
  const [error, setError] = useState<unknown>();
  const submit = async (row: AttendanceSummary) => {
    setError(undefined);
    try {
      await task.mutateAsync({
        action: 'workforce.submit_attendance',
        input: { attendanceId: row.id, expectedVersion: row.version },
      });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <WorkforcePanel
      title={t({ ja: '勤怠の記録', en: 'Attendance records' })}
      note={t({
        ja: '退勤後に確認して提出します。訂正は承認を経て反映されます。',
        en: 'Review and submit after clocking out. Corrections take effect after approval.',
      })}
      icon="calendar"
    >
      {error ? <WorkforceError error={error} /> : null}
      {rows.length ? (
        <div className="workforce-record-list">
          {rows.map((row) => (
            <article className="workforce-record" key={row.id}>
              <header>
                <h3>{row.workDate}</h3>
                <WorkforceStatus status={row.status} />
              </header>
              <div className="workforce-record-meta">
                <span>
                  {timeLabel(row.clockIn)} — {timeLabel(row.clockOut)}
                </span>
                <strong>
                  {row.clockOut
                    ? minutesLabel(row.workedMinutes, locale)
                    : t({ ja: '退勤後に集計', en: 'Total after clock-out' })}
                </strong>
              </div>
              <div className="workforce-record-actions">
                {['closed', 'returned'].includes(row.status) && actions.includes('workforce.submit_attendance') ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={task.isPending}
                    onClick={() => void submit(row)}
                  >
                    {t({ ja: 'この勤怠を提出', en: 'Submit attendance' })}
                  </button>
                ) : null}
                {actions.includes('workforce.request_correction') ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={
                      task.isPending || corrections.some((c) => c.attendanceId === row.id && c.status === 'pending')
                    }
                    onClick={() => setSelected(row)}
                  >
                    {t({ ja: '訂正を申請', en: 'Request correction' })}
                  </button>
                ) : null}
              </div>
              {corrections
                .filter((c) => c.attendanceId === row.id)
                .map((c) => (
                  <div key={c.id}>
                    <p>
                      {t({ ja: '訂正申請', en: 'Correction' })} · <WorkforceStatus status={c.status} />
                    </p>
                    <p>{c.reason}</p>
                    {c.reviewReason ? <p>{c.reviewReason}</p> : null}
                  </div>
                ))}
            </article>
          ))}
        </div>
      ) : (
        <WorkforceEmpty icon="calendar">
          {t({
            ja: 'この月の勤怠はまだありません。今日の打刻から始めましょう。',
            en: 'There are no attendance records this month. Start with today’s clock.',
          })}
        </WorkforceEmpty>
      )}
      {selected ? (
        <CorrectionForm
          attendance={selected}
          stale={rows.find((r) => r.id === selected.id)?.version !== selected.version}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </WorkforcePanel>
  );
}
