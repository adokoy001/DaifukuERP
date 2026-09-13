import { type ReactNode } from 'react';
import { isApiError } from '../api/client.ts';
import { useLocale } from '../i18n.tsx';
import { formatDecimal } from '../lib/format.ts';
import { workforceStatuses, workforceTone } from '../lib/workforce.ts';
import { Icon, type IconName } from './icon.tsx';

export function WorkforcePanel({
  title,
  note,
  icon,
  actions,
  children,
  className = '',
}: {
  title: string;
  note?: string;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'workforce-panel ' + className}>
      <header className="workforce-panel-heading">
        <div>
          {icon ? (
            <span className="workforce-panel-icon">
              <Icon name={icon} />
            </span>
          ) : null}
          <div>
            <h2>{title}</h2>
            {note ? <p>{note}</p> : null}
          </div>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function WorkforceEmpty({ children, icon = 'spark' }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="workforce-empty">
      <span>
        <Icon name={icon} size={26} />
      </span>
      <p>{children}</p>
    </div>
  );
}

export function WorkforceError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useLocale();
  const conflict = isApiError(error) && error.status === 409;
  const denied = isApiError(error) && [401, 403].includes(error.status);
  return (
    <div className={'workforce-error ' + (denied ? 'workforce-error-access' : '')} role="alert">
      <strong>
        {t(
          denied
            ? { ja: 'この情報へのアクセス権を確認してください', en: 'Check your access to this information' }
            : conflict
              ? { ja: '別の操作で情報が更新されています', en: 'This information has changed elsewhere' }
              : { ja: '操作を完了できませんでした', en: 'The operation could not be completed' },
        )}
      </strong>
      <p>
        {isApiError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : t({ ja: '通信状態を確認して、もう一度お試しください。', en: 'Check your connection and try again.' })}
      </p>
      {isApiError(error) && error.hint ? <p>{error.hint}</p> : null}
      {conflict ? (
        <p>
          {t({
            ja: '入力内容は保持しています。最新の状態を確認してからやり直してください。',
            en: 'Your input is preserved. Review the latest state before trying again.',
          })}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          {t({ ja: '最新の状態を確認', en: 'Refresh current state' })}
        </button>
      ) : null}
    </div>
  );
}

export function WorkforceMoney({ value }: { value: string | null | undefined }) {
  const { t } = useLocale();
  return (
    <span className="workforce-money">
      {value === null || value === undefined ? '—' : formatDecimal(value)}
      {value === null || value === undefined ? null : <small> {t({ ja: '円', en: 'JPY' })}</small>}
    </span>
  );
}

export function WorkforceStatus({ status }: { status: string }) {
  const { t } = useLocale();
  return (
    <span className="workforce-status" data-tone={workforceTone(status)}>
      {workforceStatuses[status] ? t(workforceStatuses[status]) : status}
    </span>
  );
}
