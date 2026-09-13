// Small shared status views (loading / meta error / unknown entity / not found).
import { Link } from '@tanstack/react-router';
import { isApiError } from '../api/client.ts';
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';

export function LoadingView() {
  const { t } = useLocale();
  return <div className="p-4 text-neutral-500">{t(S.loading)}</div>;
}

export function MetaError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useLocale();
  const detail = isApiError(error)
    ? `${error.code}: ${error.message} — ${error.hint}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <div role="alert" className="m-4 rounded border border-red-200 bg-red-50 p-3 text-red-900">
      <div className="font-medium">{t(S.loadFailed)}</div>
      <div className="mt-1 text-xs">{detail}</div>
      <button type="button" className="btn mt-2" onClick={retry}>
        {t(S.retry)}
      </button>
    </div>
  );
}

export function EntityMissing({ name }: { name: string }) {
  const { t } = useLocale();
  return (
    <div className="p-4">
      <div className="font-mono text-neutral-500">{name}</div>
      <p>{t(S.unknownEntity)}</p>
      <Link to="/" className="mt-2 inline-block text-sky-700 hover:underline">
        {t(S.home)}
      </Link>
    </div>
  );
}

export function NotFoundView() {
  const { t } = useLocale();
  return (
    <div className="p-4">
      <p>{t(S.notFound)}</p>
      <Link to="/" className="mt-2 inline-block text-sky-700 hover:underline">
        {t(S.home)}
      </Link>
    </div>
  );
}
