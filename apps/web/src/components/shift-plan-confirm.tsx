import type { ShiftPlanSummary } from '../api/shifts.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
export function ShiftPlanConfirm({
  plan,
  mode,
  sourceRevision,
  shortage,
  stale,
  onClose,
  onSaved,
}: {
  plan: ShiftPlanSummary;
  mode: 'publish' | 'cancel';
  sourceRevision: string;
  shortage: number;
  stale: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const task = useWorkforceTask();
  return (
    <WorkforceDialog
      title={t(
        mode === 'publish'
          ? { ja: 'このシフトを社員へ公開', en: 'Publish this shift plan' }
          : plan.status === 'draft'
            ? { ja: '下書きを取り消す', en: 'Cancel draft' }
            : { ja: '公開シフトを取り消す', en: 'Cancel published shifts' },
      )}
      submitLabel={t(
        mode === 'publish'
          ? { ja: '確認して公開', en: 'Confirm publication' }
          : { ja: '理由を記録して取消', en: 'Record reason and cancel' },
      )}
      stale={stale}
      onClose={onClose}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: mode === 'publish' ? 'workforce.publish_shift_plan' : 'workforce.cancel_shift_plan',
          input: {
            planId: plan.id,
            expectedVersion: plan.version,
            reason: String(data.get('reason') ?? '').trim(),
            ...(mode === 'publish'
              ? { sourceRevision, acknowledgeShortage: data.get('acknowledgeShortage') === 'on' }
              : {}),
          },
        });
        await onSaved();
      }}
    >
      <p className="workforce-notice">
        {t(
          mode === 'publish'
            ? {
                ja: '保存された案を公開します。改訂の場合は旧公開版を履歴として残し、新しい版へ切り替えます。',
                en: 'Publish the saved draft. A revision preserves the old version and replaces the current published plan.',
              }
            : plan.status === 'draft'
              ? {
                  ja: 'この下書きを取り消します。現在の公開版はそのまま保持されます。',
                  en: 'Cancel this draft. The current published version remains unchanged.',
                }
              : {
                  ja: 'この版の勤務予定が本人画面から外れます。履歴は保持されます。',
                  en: 'This version will disappear from employee schedules. History is retained.',
                },
        )}
      </p>
      {mode === 'publish' && shortage > 0 ? (
        <div className="workforce-error">
          <strong>
            {t({ ja: '不足人数（延べ）', en: 'Total shortage' })}: {shortage}
          </strong>
          <label className="workforce-checkbox">
            <input type="checkbox" name="acknowledgeShortage" required />
            {t({
              ja: '不足が残ることと対応方針を確認しました',
              en: 'I reviewed the remaining shortage and response plan',
            })}
          </label>
        </div>
      ) : null}
      <label>
        {t({ ja: '確認理由・対応方針', en: 'Reason and response plan' })}
        <textarea className="input" name="reason" rows={3} required maxLength={1000} />
      </label>
    </WorkforceDialog>
  );
}
