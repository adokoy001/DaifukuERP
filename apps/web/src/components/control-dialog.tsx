import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { Icon } from './icon.tsx';
export function ControlDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useLocale();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="action-dialog control-dialog"
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      <header className="panel-heading">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={onClose}
          aria-label={t({ ja: '閉じる', en: 'Close' })}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
