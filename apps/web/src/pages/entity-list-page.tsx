// AC-3: /e/:entity — paged table (views.list), debounced search, sortable headers, total count, "New" when ops has create.
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEntityMeta, useList, useRefLabelMaps } from '../api/queries.ts';
import type { EntityMeta, RecordJson } from '../api/types.ts';
import { DataTable } from '../components/data-table.tsx';
import { WorkforceWorkflowLink } from '../components/workforce-workflow-link.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { listColumns } from '../lib/ext.ts';
import { PAGE_SIZE, pageCount, toListState, updateSearch, type ListSearch } from '../lib/query.ts';
import { S } from '../strings.ts';
import { EntityMissing, LoadingView, MetaError } from './status-views.tsx';

/** Search box state: typing is debounced (300ms) into `?q=`; an external URL change (back button) flows back into the box. */
function useDebouncedNavigate(entity: string, search: ListSearch) {
  const navigate = useNavigate();
  const [text, setText] = useState(search.q ?? '');
  // The q we last pushed ourselves; when it arrives from the router we must not overwrite newer keystrokes with it.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const q = search.q ?? '';
    if (pending.current !== null && pending.current === q) {
      pending.current = null;
      return;
    }
    setText(q);
  }, [search.q]);
  useEffect(() => {
    if (text === (search.q ?? '')) return;
    const h = globalThis.setTimeout(() => {
      pending.current = text;
      void navigate({ to: '/e/$entity', params: { entity }, search: (prev) => updateSearch(prev, { q: text }), replace: true });
    }, 300);
    return () => globalThis.clearTimeout(h);
  }, [text, search.q, entity, navigate]);
  return { text, setText, navigate };
}

function Pager({ total, page, onPage }: { total: number; page: number; onPage: (p: number) => void }) {
  const { t } = useLocale();
  const pages = pageCount(total);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-600">
      <span data-testid="total" className="font-mono tabular-nums">
        {from}–{to} / {total} {t(S.total)}
      </span>
      <button type="button" className="btn px-2 py-0.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t(S.prev)}
      </button>
      <span className="font-mono tabular-nums">
        {page} / {pages}
      </span>
      <button type="button" className="btn px-2 py-0.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t(S.next)}
      </button>
    </div>
  );
}

function ListView({ entity, search }: { entity: EntityMeta; search: ListSearch }) {
  const { t } = useLocale();
  const toast = useToast();
  const { text, setText, navigate } = useDebouncedNavigate(entity.name, search);
  const state = useMemo(() => toListState(search), [search]);
  const list = useList(entity.name, state);
  useEffect(() => {
    if (list.error) toast.error(list.error);
  }, [list.error, toast]);
  // web-phase15 AC-3: `ext.<key>` in views.list resolves to the registered ext field.
  const columns = useMemo(() => listColumns(entity), [entity]);
  const refFields = useMemo(() => columns.filter((f) => f.kind === 'ref'), [columns]);
  const rows = list.data?.items;
  const refLabel = useRefLabelMaps(refFields, rows ?? []);
  const setSearch = (patch: Parameters<typeof updateSearch>[1]) => void navigate({ to: '/e/$entity', params: { entity: entity.name }, search: (prev) => updateSearch(prev, patch) });
  const openRow = (row: RecordJson) => void navigate({ to: '/e/$entity/$id', params: { entity: entity.name, id: row.id } });
  const page = search.page ?? 1;
  if (entity.name.startsWith('workforce_') && list.isError) return <MetaError error={list.error} retry={() => void list.refetch()} />;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-base font-semibold">{t(entity.label)}</h1>
        <span className="font-mono text-xs text-neutral-400">{entity.name}</span>
        <input type="search" role="searchbox" aria-label={t(S.search)} placeholder={t(S.searchPlaceholder)} className="input w-64" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="ml-auto flex items-center gap-2">
          {list.data ? <Pager total={list.data.total} page={page} onPage={(p) => setSearch({ page: p })} /> : null}
          {entity.ops.includes('create') ? (
            <Link to="/e/$entity/new" params={{ entity: entity.name }} className="btn btn-primary">
              + {t(S.new)}
            </Link>
          ) : null}
        </div>
      </header>
      <WorkforceWorkflowLink entity={entity.name} />
      <DataTable entity={entity} columns={columns} rows={rows} sort={search.sort} onSortChange={(sort) => setSearch({ sort })} onRowClick={openRow} refLabel={refLabel} loading={list.isFetching} />
    </div>
  );
}

export function EntityListPage() {
  const params = useParams({ strict: false }) as { entity?: string };
  const search = useSearch({ strict: false }) as ListSearch;
  const name = params.entity ?? '';
  const { meta, entity } = useEntityMeta(name);
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (meta.isPending) return <LoadingView />;
  if (!entity) return <EntityMissing name={name} />;
  return <ListView key={entity.name} entity={entity} search={search} />;
}
