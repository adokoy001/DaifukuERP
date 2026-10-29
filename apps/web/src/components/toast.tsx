// Toast notifications (AC-8; ui-kit AC-9): errors show the human message first, then the server's `hint`, then the
// error code as secondary text.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { toastFromError } from '../lib/error-view.ts';
import { S } from '../strings.ts';
import { cx } from '../ui/index.ts';

export type ToastKind = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Technical error code, shown small after the human text. */
  code?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => void;
  success: (title: string) => void;
  /** Formats any thrown value; ApiError shows its message, hint and code. */
  error: (e: unknown, fallbackTitle?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TTL: Record<ToastKind, number> = { error: 10_000, success: 4_000, info: 6_000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-4), { ...t, id }]);
      globalThis.setTimeout(() => dismiss(id), TTL[t.kind]);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (title) => push({ kind: 'success', title }),
      error: (e, fallbackTitle = 'Error') => push(toastFromError(e, fallbackTitle)),
    }),
    [push, dismiss],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new TypeError('useToast must be used inside <ToastProvider>');
  return ctx;
}

const KIND_CLASS: Record<ToastKind, string> = {
  error: 'ui-notice-danger',
  success: 'ui-notice-success',
  info: 'ui-notice-info',
};

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  const { t } = useLocale();
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" className="fixed right-3 bottom-3 z-50 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={cx('ui-toast', KIND_CLASS[toast.kind])}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium break-words">{toast.title}</div>
              {toast.message ? <div className="mt-0.5 text-xs break-words opacity-90">{toast.message}</div> : null}
              {toast.code ? <div className="ui-toast-code">{toast.code}</div> : null}
            </div>
            <button
              type="button"
              aria-label={t(S.close)}
              className="shrink-0 rounded px-1 text-lg leading-none opacity-60 hover:opacity-100"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
