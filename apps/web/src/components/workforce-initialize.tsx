import { useState } from 'react';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';

export function WorkforceInitialize() {
  const { t } = useLocale();
  const task = useWorkforceTask();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t({ ja: '初期制度を準備', en: 'Initialize work policy' })}
      </button>
      {open ? (
        <WorkforceDialog
          title={t({ ja: '勤怠・給与の初期制度を準備', en: 'Initialize work and pay policy' })}
          description={t({
            ja: 'この会社に制度がない場合だけ、日本の通常の労働時間制の初期レコードを作成します。既存の制度を上書きしません。準備後に会社の就業規則・週の起算日を確認してください。',
            en: 'Create the initial ordinary Japanese work policy only when this company has no policy. Existing policies are kept. Review company work rules and the workweek origin before use.',
          })}
          submitLabel={t({ ja: '初期制度を準備する', en: 'Initialize policy' })}
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            await task.mutateAsync({ action: 'workforce.initialize_policy', input: {} });
          }}
        >
          <label className="workforce-checkbox">
            <input type="checkbox" required />
            {t({
              ja: '初期値をそのまま運用せず、会社の制度を確認します',
              en: 'I will review the company rules before using the defaults',
            })}
          </label>
        </WorkforceDialog>
      ) : null}
    </>
  );
}
