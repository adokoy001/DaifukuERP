// The technical half of a read failure (ui-kit AC-8, lib/error-view.ts): error code, HTTP status and the server's
// hint in a closed <details>, after the plain-language explanation and the server message. Shared shape with
// MetaError's details; used where one section of a screen failed and the rest stays usable (the to-do inbox).
import { useLocale } from '../i18n.tsx';
import type { ErrorView } from '../lib/error-view.ts';
import { S } from '../strings.ts';

export function ErrorDetails({ view }: { view: ErrorView }) {
  const { t } = useLocale();
  if (view.code === undefined && view.hint === undefined && view.status === undefined) return null;
  return (
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
  );
}
