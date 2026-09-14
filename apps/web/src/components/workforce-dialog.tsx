import { useBlocker } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getToken } from '../api/client.ts';
import { useLocale } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { WorkforceError } from './workforce-shared.tsx';
import { ReadRefreshNotice } from './read-refresh-notice.tsx';

/** Read actual controls at submit time; keep drafts through failed requests and require explicit discard. */
export function WorkforceDialog({
  title,
  description,
  submitLabel,
  children,
  onSubmit,
  onClose,
  stale = false,
  confirmOnly = false,
  readOnly = false,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  onClose: () => void;
  stale?: boolean;
  confirmOnly?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const exitAllowed = useRef(false);
  const id = useId();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<unknown>();
  const blocker = useBlocker({
    shouldBlockFn: () => Boolean(getToken()) && !exitAllowed.current && (locked.current || dirty),
    enableBeforeUnload: dirty || busy,
    withResolver: true,
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    if (locked.current) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };
  const cancelDiscard = () => {
    setDiscarding(false);
    if (blocker.status === 'blocked') blocker.reset();
  };
  const discard = () => {
    exitAllowed.current = true;
    if (blocker.status === 'blocked') blocker.proceed();
    else onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="action-dialog workforce-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="workforce-dialog-heading">
        <div>
          <span className="eyebrow">DAIFUKU PEOPLE</span>
          <h2 id={id}>{title}</h2>
        </div>
        <button
          type="button"
          className="btn workforce-icon-button"
          disabled={busy}
          onClick={close}
          aria-label={t({ ja: '閉じる', en: 'Close' })}
        >
          <Icon name="close" />
        </button>
      </header>
      <ReadRefreshNotice />
      {description ? <p className="workforce-dialog-description">{description}</p> : null}
      {discarding || blocker.status === 'blocked' ? (
        <div className="workforce-discard" role="alert">
          <p>
            {t(
              busy
                ? { ja: '送信が終わるまで、この画面でお待ちください。', en: 'Wait here until the request completes.' }
                : { ja: '入力中の内容を破棄しますか？', en: 'Discard your unsaved input?' },
            )}
          </p>
          <div className="button-row">
            <button type="button" className="btn" onClick={cancelDiscard}>
              {t({ ja: '入力に戻る', en: 'Keep editing' })}
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={discard}>
              {t({ ja: '破棄して移動', en: 'Discard and leave' })}
            </button>
          </div>
        </div>
      ) : null}
      <form
        onInput={() => setDirty(true)}
        onChange={() => setDirty(true)}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[data-draft-change]')) setDirty(true);
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked.current || stale || readOnly) return;
          const data = new FormData(event.currentTarget);
          locked.current = true;
          setBusy(true);
          setError(undefined);
          try {
            await onSubmit(data);
            exitAllowed.current = true;
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            locked.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="workforce-form-fields">
          {children}
        </fieldset>
        {stale ? (
          <p className="workforce-notice" role="status">
            {t({
              ja: '記録が更新されました。入力内容を確認して閉じ、最新の記録から開き直してください。',
              en: 'This record changed. Review your input, close this dialog and reopen the current record.',
            })}
          </p>
        ) : null}
        {error ? <WorkforceError error={error} /> : null}
        <footer className="workforce-dialog-actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            {t({ ja: '戻る', en: 'Back' })}
          </button>
          {readOnly ? null : (
            <button type="submit" className="btn btn-primary" disabled={busy || stale || (!dirty && !confirmOnly)}>
              {busy ? t({ ja: '送信中…', en: 'Sending…' }) : submitLabel}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
