// Small shared status views (loading / meta error / unknown entity / not found), built on the UI kit (ui-kit AC-7/8).
import { Link } from '@tanstack/react-router';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import { S } from '../strings.ts';
import { Button, cx, EmptyState, Skeleton, SkeletonCard } from '../ui/index.ts';

/** Skeleton placeholder while a screen's data loads; the text is for assistive technology only. */
export function LoadingView({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <div className={cx('ui-loading', className)} aria-busy="true" data-testid="loading-view">
      <span className="sr-only">{t(S.loading)}</span>
      <Skeleton className="ui-skeleton-title" />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
    </div>
  );
}

/** A failed read: what happened in plain words first, the code / HTTP status / hint folded away, then Retry. */
export function MetaError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useLocale();
  const view = describeError(error);
  const technical = view.code !== undefined || view.hint !== undefined || view.status !== undefined;
  return (
    <div role="alert" className="ui-notice ui-notice-danger ui-error-panel" data-testid="meta-error">
      <p className="ui-error-title">{t(S.loadFailed)}</p>
      {view.explanation ? <p className="ui-error-message">{t(view.explanation)}</p> : null}
      {view.message ? <p className="ui-error-message">{view.message}</p> : null}
      {technical ? (
        <details className="ui-error-details">
          <summary>{t(S.technicalDetails)}</summary>
          <dl>
            {view.code ? (
              <>
                <dt>{t(S.errorCode)}</dt>
                <dd className="code">{view.code}</dd>
              </>
            ) : null}
            {view.status !== undefined ? (
              <>
                <dt>HTTP</dt>
                <dd className="code">{view.status === 0 ? t(S.noResponse) : view.status}</dd>
              </>
            ) : null}
            {view.hint ? (
              <>
                <dt>{t(S.errorHint)}</dt>
                <dd>{view.hint}</dd>
              </>
            ) : null}
          </dl>
        </details>
      ) : null}
      <Button onClick={retry}>{t(S.retry)}</Button>
    </div>
  );
}

export function EntityMissing({ name }: { name: string }) {
  const { t } = useLocale();
  return (
    <div className="p-4">
      <EmptyState
        title={t(S.unknownEntity)}
        description={<span className="ui-code">{name}</span>}
        action={
          <Link to="/" className="ui-link">
            {t(S.home)}
          </Link>
        }
      />
    </div>
  );
}

export function NotFoundView() {
  const { t } = useLocale();
  return (
    <div className="p-4">
      <EmptyState
        title={t(S.notFound)}
        action={
          <Link to="/" className="ui-link">
            {t(S.home)}
          </Link>
        }
      />
    </div>
  );
}
