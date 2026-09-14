import { useRef, useState, type ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { ControlDialog } from './control-dialog.tsx';
import { ReadRefreshNotice } from './read-refresh-notice.tsx';
import { WorkforceError } from './workforce-shared.tsx';
export function EdgeForm({
  title,
  submitLabel,
  children,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const pending = useRef(false);
  const submit = async (data: FormData) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(data);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <ControlDialog title={title} busy={busy} onClose={onClose}>
      <form
        className="edge-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(new FormData(event.currentTarget));
        }}
      >
        <ReadRefreshNotice />
        {error ? <WorkforceError error={error} /> : null}
        <fieldset disabled={busy}>
          {children}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t({ ja: '閉じる', en: 'Close' })}
            </button>
            <button className="btn btn-primary" type="submit">
              {busy ? t({ ja: '処理中…', en: 'Working…' }) : submitLabel}
            </button>
          </div>
        </fieldset>
      </form>
    </ControlDialog>
  );
}
