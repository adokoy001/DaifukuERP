import './read-refresh-notice.css';
import { createContext, useContext, type ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { canRetainData, type ReadState } from '../lib/read-recovery.ts';
import { Icon } from './icon.tsx';

export interface ReadSource extends ReadState {
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}
const RecoveryContext = createContext<readonly ReadSource[]>([]);
/** Keeps an open modal aware of a failed page refresh without replacing its form. */
export function ReadRecoveryProvider({ sources, children }: { sources: readonly ReadSource[]; children: ReactNode }) {
  return <RecoveryContext.Provider value={sources}>{children}</RecoveryContext.Provider>;
}
export function ReadRefreshNotice({ sources }: { sources?: readonly ReadSource[] }) {
  const context = useContext(RecoveryContext),
    { t } = useLocale();
  const failed = (sources ?? context).filter(canRetainData);
  if (!failed.length) return null;
  const busy = failed.some((source) => source.isFetching);
  return (
    <div className="read-refresh-notice" role="status" data-testid="read-refresh-notice">
      <Icon name="clock" size={19} />
      <div>
        <strong>{t({ ja: '最新の情報を取得できませんでした', en: 'Could not refresh the latest information' })}</strong>
        <p>
          {t({
            ja: '入力内容はそのままです。表示は最後に取得できた情報です。通信を確認して再取得してください。',
            en: 'Your input is preserved. The page shows the last successful snapshot. Check your connection and retry.',
          })}
        </p>
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => {
          for (const source of failed) void source.refetch();
        }}
      >
        {t(busy ? { ja: '再取得中…', en: 'Refreshing…' } : { ja: '再取得', en: 'Retry refresh' })}
      </button>
    </div>
  );
}
