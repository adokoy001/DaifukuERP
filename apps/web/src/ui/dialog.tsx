// UI kit: Dialog — a thin wrapper over the native modal <dialog>. New dialogs use this (docs/conventions/ui.md).
// The native modal supplies focus trapping, Escape handling and focus restoration; put `autoFocus` on the safest
// action (usually "Go back") so the first focus never lands on a destructive button.
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../components/icon.tsx';
import { cx } from './cx.ts';

export interface DialogProps {
  title: ReactNode;
  /** Called on Escape, on the close button and when the dialog closes. */
  onClose: () => void;
  /** Accessible name of the close (×) button, e.g. t(S.close). */
  closeLabel: string;
  description?: ReactNode;
  /** Leading visual in the heading row (icon tile). */
  icon?: ReactNode;
  children?: ReactNode;
  /** Buttons row at the bottom. */
  actions?: ReactNode;
  /** When given, the content is a <form> and this handles its submit. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
}

export function Dialog({
  title,
  onClose,
  closeLabel,
  description,
  icon,
  children,
  actions,
  onSubmit,
  className,
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const content = (
    <>
      <div className="dialog-heading">
        {icon ?? <span />}
        <button type="button" onClick={onClose} aria-label={closeLabel}>
          <Icon name="close" />
        </button>
      </div>
      <h2 id={titleId}>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
      {actions ? <div className="dialog-actions">{actions}</div> : null}
    </>
  );
  return (
    <dialog
      ref={dialog}
      className={cx('action-dialog', className)}
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby={titleId}
    >
      {onSubmit ? <form onSubmit={onSubmit}>{content}</form> : <div>{content}</div>}
    </dialog>
  );
}
