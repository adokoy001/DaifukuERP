import type { ShiftBoard } from '../api/shifts.ts';
import { minuteTime } from '../lib/shift.ts';
import { useLocale } from '../i18n.tsx';
import { ShiftProfileButton } from './shift-profile.tsx';
export function ShiftSubmissions({ board, canEdit }: { board: ShiftBoard; canEdit: boolean }) {
  const { t } = useLocale();
  return (
    <section className="workforce-panel">
      <header className="workforce-panel-heading">
        <div>
          <h2>{t({ ja: '2. 希望提出と勤務条件', en: '2. Availability and work profiles' })}</h2>
          <p>
            {board.availability.length} / {board.problem.employees.length}{' '}
            {t({
              ja: '人が提出済み。未提出・条件未設定は推薦から除外します。',
              en: 'employees submitted. Missing availability or profiles excludes an employee from recommendations.',
            })}
          </p>
        </div>
      </header>
      <div className="shift-person-metrics">
        {board.problem.employees.map((employee) => (
          <article key={employee.id}>
            <strong>{employee.name}</strong>
            <small>
              {employee.code} · {employee.hiredOn}–{employee.terminatedOn ?? ''}
            </small>
            <span
              className={
                board.availability.some((row) => row.employeeId === employee.id) ? 'shift-complete' : 'shift-shortage'
              }
            >
              {board.availability.some((row) => row.employeeId === employee.id)
                ? t({ ja: '希望提出済み', en: 'Availability submitted' })
                : t({ ja: '希望未提出', en: 'Not submitted' })}
            </span>
            <small>
              {employee.profile
                ? employee.profile.skills.join(' / ') || t({ ja: '勤務条件設定済み', en: 'Profile configured' })
                : t({ ja: '勤務条件未設定', en: 'Profile missing' })}
            </small>
            {board.availability.find((row) => row.employeeId === employee.id) ? (
              <details>
                <summary>{t({ ja: '7日分の希望を見る', en: 'View weekly availability' })}</summary>
                <ul>
                  {board.availability
                    .find((row) => row.employeeId === employee.id)
                    ?.days.map((day) => (
                      <li key={day.date}>
                        {day.date}:{' '}
                        {day.preference === 'unavailable'
                          ? t({ ja: '勤務不可', en: 'Unavailable' })
                          : `${minuteTime(day.startMinute)}–${minuteTime(day.endMinute)} ${t(day.preference === 'preferred' ? { ja: '希望優先', en: 'Preferred' } : { ja: '勤務可能', en: 'Available' })}`}
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
            {canEdit ? (
              <ShiftProfileButton employeeId={employee.id} name={employee.name} siteId={board.site.id} />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
