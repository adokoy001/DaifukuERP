import { useState } from 'react';
import type { ShiftProfile } from '@daifuku/mod-workforce/scheduling';
import { useShiftBoard, type ShiftProfileSummary } from '../api/shifts.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { shiftMonday } from '../lib/shift.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { ReadRecoveryProvider } from './read-refresh-notice.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceError } from './workforce-shared.tsx';
const defaults: ShiftProfile = {
  employmentType: 'part_time',
  skills: [],
  targetMinutes: 1200,
  maxWeeklyMinutes: 2400,
  maxDailyMinutes: 480,
  maxDays: 5,
  maxConsecutiveDays: 5,
  minRestMinutes: 660,
};
function ProfileEditor({
  siteId,
  employeeId,
  name,
  onClose,
}: {
  siteId: string;
  employeeId: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    [week] = useState(() => shiftMonday()),
    board = useShiftBoard(siteId, week);
  if (board.isError && !canRetainData(board))
    return <WorkforceError error={board.error} onRetry={() => void board.refetch()} />;
  if (!board.data) return <p role="status">{t({ ja: '勤務条件を読込中…', en: 'Loading work profile…' })}</p>;
  const current = board.data.profiles.find((row) => row.employeeId === employeeId);
  return (
    <ReadRecoveryProvider sources={[board]}>
      <ProfileForm employeeId={employeeId} name={name} current={current} onClose={onClose} />
    </ReadRecoveryProvider>
  );
}
function ProfileForm({
  employeeId,
  name,
  current,
  onClose,
}: {
  employeeId: string;
  name: string;
  current: ShiftProfileSummary | undefined;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    task = useWorkforceTask(),
    [original] = useState(current);
  const profile = original?.profile ?? defaults;
  return (
    <WorkforceDialog
      stale={(current?.version ?? 0) !== (original?.version ?? 0)}
      title={`${name} · ${t({ ja: 'シフト勤務条件', en: 'Shift work profile' })}`}
      submitLabel={t({ ja: '勤務条件を保存', en: 'Save work profile' })}
      onClose={onClose}
      onSubmit={async (data) => {
        const n = (key: string) => Number(data.get(key));
        const skills = [
          ...new Set(
            String(data.get('skills') ?? '')
              .split(/[,、\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ];
        await task.mutateAsync({
          action: 'workforce.save_shift_profile',
          input: {
            employeeId,
            expectedVersion: original?.version ?? 0,
            profile: {
              skills,
              employmentType: data.get('employmentType'),
              targetMinutes: n('targetMinutes'),
              maxWeeklyMinutes: n('maxWeeklyMinutes'),
              maxDailyMinutes: n('maxDailyMinutes'),
              maxDays: n('maxDays'),
              maxConsecutiveDays: n('maxConsecutiveDays'),
              minRestMinutes: n('minRestMinutes'),
            },
          },
        });
      }}
    >
      <p className="workforce-notice">
        {t({
          ja: '計画用の運用条件です。法令適合の認定や給与設定ではありません。通常勤務では会社の日8時間・週40時間等の上限を別に適用し、変形・フレックスでは確定した勤務制度と期間残枠も確認します。勤務間隔660分は確認して変更できる初期提案値です。',
          en: 'These are planning preferences, not legal certification or payroll settings. Company limits still apply to ordinary work; confirmed variable/flex rules and remaining period budgets also apply. Review the proposed 660-minute rest interval.',
        })}
      </p>
      <label>
        {t({ ja: '雇用区分', en: 'Employment type' })}
        <select className="input" name="employmentType" defaultValue={profile.employmentType}>
          <option value="full_time">{t({ ja: '正社員', en: 'Full time' })}</option>
          <option value="part_time">{t({ ja: 'パート・アルバイト', en: 'Part time' })}</option>
          <option value="contract">{t({ ja: '契約社員', en: 'Contract' })}</option>
        </select>
      </label>
      <label>
        {t({ ja: '対応スキル（カンマ区切り）', en: 'Skills (comma separated)' })}
        <input className="input" name="skills" defaultValue={profile.skills.join(', ')} />
      </label>
      <div className="workforce-form-row">
        {(
          [
            ['targetMinutes', { ja: '週の目標（分）', en: 'Weekly target (minutes)' }, 0, 5760],
            ['maxWeeklyMinutes', { ja: '週の上限（分）', en: 'Weekly maximum (minutes)' }, 60, 5760],
            ['maxDailyMinutes', { ja: '日の上限（分）', en: 'Daily maximum (minutes)' }, 60, 960],
            ['maxDays', { ja: '週の勤務日数上限', en: 'Maximum days per week' }, 1, 6],
            ['maxConsecutiveDays', { ja: '連続勤務日数の上限', en: 'Maximum consecutive days' }, 1, 6],
            ['minRestMinutes', { ja: '最小勤務間隔（分）', en: 'Minimum rest (minutes)' }, 0, 1440],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            {t(label)}
            <input
              className="input"
              name={key}
              type="number"
              required
              min={min}
              max={max}
              step={1}
              defaultValue={profile[key]}
            />
          </label>
        ))}
      </div>
    </WorkforceDialog>
  );
}
export function ShiftProfileButton({ siteId, employeeId, name }: { siteId: string; employeeId: string; name: string }) {
  const { t } = useLocale(),
    [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t({ ja: '勤務条件を編集', en: 'Edit shift profile' })}
      </button>
      {open ? (
        <ProfileEditor siteId={siteId} employeeId={employeeId} name={name} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
