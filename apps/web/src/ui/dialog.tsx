// UI kit: Dialog — a thin wrapper over the native modal <dialog>. New dialogs use this (docs/conventions/ui.md).
// The native modal supplies the focus trap and Escape (cancel). Two things it does not do for us, done here:
// - first focus: React's `autoFocus` runs before the dialog is open, so it is ignored; mark the safest action
//   (usually "Go back") with `data-autofocus` and it receives focus when the dialog opens, never a destructive button;
// - focus return: callers close the dialog by unmounting it, and removing an open <dialog> skips the browser's own
//   focus restoration, so on unmount the dialog is closed while still attached and focus goes back to the opener.
import { useId, useLayoutEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../components/icon.tsx';
import { cx } from './cx.ts';

export interface DialogProps {
  title: ReactNode;
  /** Called on Escape, on the close button and when the dialog closes. */
  onClose: () => void;
  /** Accessible name of the close (×) button, e.g. t(S.close). */
  closeLabel: string;
  /** Consequence text under the title; it becomes the dialog's accessible description. */
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

/** Element to focus first: the one marked `data-autofocus`, else the browser's choice (first focusable). */
function initialFocusTarget(dialog: ParentNode): HTMLElement | null {
  return dialog.querySelector<HTMLElement>('[data-autofocus]');
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
  const descriptionId = useId();
  // Layout effect: its cleanup runs before React detaches the node, while close() can still restore focus.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    initialFocusTarget(element)?.focus();
    return () => {
      const active = document.activeElement;
      const focusInside = !active || active === document.body || element.contains(active);
      if (element.open) element.close();
      if (focusInside && opener?.isConnected && document.activeElement !== opener) opener.focus();
    };
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
      {description ? <p id={descriptionId}>{description}</p> : null}
      {children}
      {actions ? <div className="dialog-actions">{actions}</div> : null}
    </>
  );
  return (
    <dialog
      ref={dialog}
      className={cx('action-dialog', className)}
      onCancel={onClose}
      // A close event can arrive late, after StrictMode's remount reopened the dialog; only a closed dialog reports it.
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      {onSubmit ? <form onSubmit={onSubmit}>{content}</form> : <div>{content}</div>}
    </dialog>
  );
}
