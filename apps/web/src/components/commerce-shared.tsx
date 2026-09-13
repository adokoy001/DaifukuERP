import { useCommerceCopy } from './commerce-copy.ts';
import '../commerce.css';
import '../workforce.css';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMeta } from '../api/queries.ts';
import { ReadRefreshNotice, type ReadSource } from './read-refresh-notice.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { WorkforceError, WorkforceMoney } from './workforce-shared.tsx';
import { Icon } from './icon.tsx';
export { WorkforceMoney as CommerceMoney } from './workforce-shared.tsx';
export { CommerceDialog } from './commerce-dialog.tsx';
export function useCommerceAccess(action: string) {
  const meta = useMeta();
  return {
    meta,
    allowed: Boolean(meta.data?.actions.some((a) => a.name === action)),
    actions: meta.data?.actions.map((a) => a.name) ?? [],
  };
}
export function CommerceShell({
  title,
  subtitle,
  children,
  action,
  sources = [],
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  action: string;
  sources?: ReadSource[];
}) {
  const copy = useCommerceCopy();
  const { meta, allowed } = useCommerceAccess(action),
    readers = [meta, ...sources],
    failed = readers.find((q) => q.isError && !canRetainData(q));
  return (
    <div className="workspace-page commerce-page">
      <header className="commerce-hero">
        <div>
          <span className="eyebrow">DAIFUKU · CONNECTED FINANCE</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <span className="commerce-hero-icon">
          <Icon name="building" size={34} />
        </span>
      </header>
      {failed ? (
        <WorkforceError
          error={failed.error}
          onRetry={() => {
            for (const source of readers) void source.refetch();
          }}
        />
      ) : !meta.data ? (
        <p role="status">{copy('利用権限を確認しています…')}</p>
      ) : !allowed ? (
        <p className="commerce-notice">{copy('この会社でこの操作を利用する権限がありません。')}</p>
      ) : (
        <>
          <ReadRefreshNotice sources={readers} />
          {children}
        </>
      )}
    </div>
  );
}
export function CommercePanel({
  title,
  note,
  children,
  actions,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="commerce-panel">
      <header>
        <div>
          <h2>{title}</h2>
          {note ? <p>{note}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
export function CommerceMetric({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <article className="commerce-metric">
      <span>{title}</span>
      <strong>
        <WorkforceMoney value={value} />
      </strong>
      <small>{note}</small>
    </article>
  );
}
export function SourceLink({
  entity,
  id,
  children,
}: {
  entity: string;
  id: string | null | undefined;
  children: ReactNode;
}) {
  return id ? (
    <Link to="/e/$entity/$id" params={{ entity, id }} className="commerce-source">
      {children} <Icon name="arrow" size={14} />
    </Link>
  ) : (
    <span>—</span>
  );
}
export function CommerceEmpty({ children }: { children: ReactNode }) {
  return <p className="commerce-empty">{children}</p>;
}
export function CommercePager({
  offset,
  total,
  onPage,
}: {
  offset: number;
  total: number;
  onPage: (offset: number) => void;
}) {
  const copy = useCommerceCopy();
  return (
    <nav className="commerce-pager" aria-label={copy('一覧のページ')}>
      <button className="btn" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - 100))}>
        {copy('前へ')}
      </button>
      <span>{total ? `${offset + 1}–${Math.min(total, offset + 100)} / ${total}` : copy('0件')}</span>
      <button className="btn" disabled={offset + 100 >= total} onClick={() => onPage(offset + 100)}>
        {copy('次へ')}
      </button>
    </nav>
  );
}
