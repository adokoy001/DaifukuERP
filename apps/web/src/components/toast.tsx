// Toast notifications (AC-8): errors show `code: message` plus the server's `hint`.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { isApiError } from '../api/client.ts';
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';

export type ToastKind = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => void;
  success: (title: string) => void;
  /** Formats any thrown value; ApiError shows its code and hint. */
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
      error: (e, fallbackTitle = 'Error') => {
        if (isApiError(e)) {
          push({ kind: 'error', title: `${e.code}: ${e.message}`, message: e.hint });
          return;
        }
        push({ kind: 'error', title: fallbackTitle, message: e instanceof Error ? e.message : String(e) });
      },
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
  error: 'border-red-300 bg-red-50 text-red-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  info: 'border-sky-300 bg-sky-50 text-sky-900',
};

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  const { t } = useLocale();
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" className="fixed right-3 bottom-3 z-50 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'} className={`rounded border px-3 py-2 shadow-md ${KIND_CLASS[toast.kind]}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium break-words">{toast.title}</div>
              {toast.message ? <div className="mt-0.5 text-xs break-words opacity-90">{toast.message}</div> : null}
            </div>
            <button type="button" aria-label={t(S.close)} className="shrink-0 rounded px-1 text-lg leading-none opacity-60 hover:opacity-100" onClick={() => dismiss(toast.id)}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
