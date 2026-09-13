import { useState, type FormEvent } from 'react';
import { useOperationsTask, type StoreOption } from '../api/operations.ts';
import { useLocale } from '../i18n.tsx';
import { businessToday } from '../lib/operations.ts';
import { ControlDialog } from './control-dialog.tsx';
import { useToast } from './toast.tsx';
const weekdays = [
  ['mon', '月', 'Mon'],
  ['tue', '火', 'Tue'],
  ['wed', '水', 'Wed'],
  ['thu', '木', 'Thu'],
  ['fri', '金', 'Fri'],
  ['sat', '土', 'Sat'],
  ['sun', '日', 'Sun'],
] as const;
export function OperationsPlan({
  stores,
  mode,
  onClose,
  initialStoreId,
  initialDate,
}: {
  stores: StoreOption[];
  mode: 'plan' | 'status';
  onClose: () => void;
  initialStoreId?: string;
  initialDate?: string;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const task = useOperationsTask();
  const [storeId, setStoreId] = useState(initialStoreId ?? stores[0]?.id ?? '');
  const [from, setFrom] = useState(mode === 'status' ? (initialDate ?? businessToday()) : businessToday());
  const [to, setTo] = useState(businessToday());
  const [target, setTarget] = useState('0');
  const [days, setDays] = useState<string[]>(weekdays.map(([value]) => value));
  const [dayStatus, setDayStatus] = useState('no_sales');
  const [reason, setReason] = useState('');
  const title = t(
    mode === 'plan'
      ? { ja: '営業計画を作成', en: 'Create a trading plan' }
      : { ja: '売上ゼロ・休業を報告', en: 'Report no sales or closure' },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (task.isPending) return;
    task.mutate(
      {
        action: mode === 'plan' ? 'plan_days' : 'record_day_status',
        input:
          mode === 'plan'
            ? { storeId, from, to, openWeekdays: days, dailyGrossSalesTarget: target }
            : { storeId, date: from, dayStatus, reason },
      },
      {
        onSuccess: () => {
          toast.success(
            t(
              mode === 'plan'
                ? { ja: '営業計画を作成しました', en: 'Trading plan created' }
                : {
                    ja: '下書きの報告を作成しました。確認して提出してください。',
                    en: 'Draft report created. Check it and submit for review.',
                  },
            ),
          );
          onClose();
        },
        onError: (e) => toast.error(e),
      },
    );
  };
  return (
    <ControlDialog title={title} onClose={onClose} busy={task.isPending}>
      <form className="operations-plan-form" onSubmit={submit}>
        <label>
          {t({ ja: '対象店舗', en: 'Store' })}
          <select
            aria-label={t({ ja: '対象店舗', en: 'Store' })}
            className="input"
            required
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            disabled={task.isPending}
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <div className="access-form-grid">
          <label>
            {t(mode === 'plan' ? { ja: '計画開始日', en: 'Start date' } : { ja: '営業日', en: 'Business day' })}
            <input
              className="input"
              type="date"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={task.isPending}
            />
          </label>
          {mode === 'plan' ? (
            <label>
              {t({ ja: '計画終了日', en: 'End date' })}
              <input
                className="input"
                type="date"
                required
                min={from}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={task.isPending}
              />
            </label>
          ) : null}
        </div>
        {mode === 'plan' ? (
          <>
            <fieldset disabled={task.isPending}>
              <legend>{t({ ja: '営業する曜日', en: 'Open weekdays' })}</legend>
              <div className="weekday-options">
                {weekdays.map(([value, ja, en]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={days.includes(value)}
                      onChange={(e) =>
                        setDays(e.target.checked ? [...days, value] : days.filter((day) => day !== value))
                      }
                    />
                    {locale === 'ja' ? ja : en}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              {t({ ja: '1営業日の税込売上目標（円）', en: 'Daily gross sales target (JPY)' })}
              <input
                className="input"
                type="text"
                inputMode="decimal"
                required
                pattern="[0-9]+(\.[0-9]{1,6})?"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={task.isPending}
              />
            </label>
            <p className="muted">
              {t({
                ja: '選ばない曜日は休業計画になります。確定済みの計画や実績を上書きしません。',
                en: 'Unselected weekdays are planned closures. Existing plans and actuals are preserved.',
              })}
            </p>
          </>
        ) : (
          <>
            <label>
              {t({ ja: '報告の区分', en: 'Report type' })}
              <select
                aria-label={t({ ja: '報告の区分', en: 'Report type' })}
                className="input"
                value={dayStatus}
                onChange={(e) => setDayStatus(e.target.value)}
                disabled={task.isPending}
              >
                <option value="no_sales">{t({ ja: '営業したが売上ゼロ', en: 'Open with no sales' })}</option>
                <option value="closed">{t({ ja: '休業', en: 'Closed' })}</option>
              </select>
            </label>
            <label>
              {t({ ja: '理由', en: 'Reason' })}
              <textarea
                className="input"
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={task.isPending}
              />
            </label>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={task.isPending} onClick={onClose}>
            {t({ ja: '戻る', en: 'Back' })}
          </button>
          <button className="btn btn-primary" disabled={!storeId || task.isPending}>
            {title}
          </button>
        </div>
      </form>
    </ControlDialog>
  );
}
