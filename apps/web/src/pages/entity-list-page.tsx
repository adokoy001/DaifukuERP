// AC-3: /e/:entity — paged table (views.list), debounced search, sortable headers, total count, "New" when ops has create.
// ui-kit AC-4..6: PageHeader + Toolbar, skeleton rows while a changed query loads, and an empty state with the next step.
// csv-import AC-11: "Import" next to "New" when the entity has a derived <entity>.import action and create permission.
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEntityMeta, useList, useRefLabelMaps } from '../api/queries.ts';
import type { EntityMeta, RecordJson } from '../api/types.ts';
import { DataTable } from '../components/data-table.tsx';
import { ListEmptyState } from '../components/list-empty-state.tsx';
import { WorkforceWorkflowLink } from '../components/workforce-workflow-link.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { listColumns } from '../lib/ext.ts';
import { PAGE_SIZE, pageCount, toListState, updateSearch, type ListSearch } from '../lib/query.ts';
import { S } from '../strings.ts';
import { Button, buttonClass, EmptyState, PageHeader, Toolbar } from '../ui/index.ts';
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
      void navigate({
        to: '/e/$entity',
        params: { entity },
        search: (prev) => updateSearch(prev, { q: text }),
        replace: true,
      });
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
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      <span data-testid="total" className="font-mono tabular-nums">
        {from}–{to} / {total} {t(S.total)}
      </span>
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t(S.prev)}
      </Button>
      <span className="font-mono tabular-nums">
        {page} / {pages}
      </span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t(S.next)}
      </Button>
    </div>
  );
}

function ListView({ entity, search, importable }: { entity: EntityMeta; search: ListSearch; importable: boolean }) {
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
  const setSearch = (patch: Parameters<typeof updateSearch>[1]) =>
    void navigate({ to: '/e/$entity', params: { entity: entity.name }, search: (prev) => updateSearch(prev, patch) });
  const openRow = (row: RecordJson) =>
    void navigate({ to: '/e/$entity/$id', params: { entity: entity.name, id: row.id } });
  const page = search.page ?? 1;
  const canCreate = entity.ops.includes('create');
  // "Clear search" and "Retry" sit in the table body and disappear when the list reloads; keep keyboard and
  // screen-reader users in place by moving focus to the search box (their next step is to type or read on).
  const searchBox = useRef<HTMLInputElement>(null);
  if (entity.name.startsWith('workforce_') && list.isError)
    return <MetaError error={list.error} retry={() => void list.refetch()} />;
  const empty = list.data ? (
    <ListEmptyState
      entityLabel={t(entity.label)}
      query={search.q}
      total={list.data.total}
      onClearSearch={() => {
        setText('');
        setSearch({ q: '' });
        searchBox.current?.focus();
      }}
      {...(canCreate
        ? {
            renderCreate: (label: string) => (
              <Link to="/e/$entity/new" params={{ entity: entity.name }} className={buttonClass('primary')}>
                {label}
              </Link>
            ),
          }
        : {})}
    />
  ) : list.isError ? (
    <EmptyState
      title={t(S.loadFailed)}
      action={
        <Button
          onClick={() => {
            searchBox.current?.focus();
            void list.refetch();
          }}
        >
          {t(S.retry)}
        </Button>
      }
    />
  ) : undefined;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <PageHeader
        title={t(entity.label)}
        meta={<span className="ui-code">{entity.name}</span>}
        actions={
          canCreate ? (
            <>
              {/* csv-import AC-11: only for importable masters the caller may create. */}
              {importable ? (
                <Link to="/e/$entity/import" params={{ entity: entity.name }} className={buttonClass()}>
                  {t({ ja: '取込', en: 'Import' })}
                </Link>
              ) : null}
              <Link to="/e/$entity/new" params={{ entity: entity.name }} className={buttonClass('primary')}>
                + {t(S.new)}
              </Link>
            </>
          ) : null
        }
      />
      <Toolbar
        end={list.data ? <Pager total={list.data.total} page={page} onPage={(p) => setSearch({ page: p })} /> : null}
      >
        <input
          ref={searchBox}
          type="search"
          role="searchbox"
          aria-label={t(S.search)}
          placeholder={t(S.searchPlaceholder)}
          className="input w-64"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Toolbar>
      <WorkforceWorkflowLink entity={entity.name} />
      <DataTable
        entity={entity}
        columns={columns}
        rows={rows}
        sort={search.sort}
        onSortChange={(sort) => setSearch({ sort })}
        onRowClick={openRow}
        refLabel={refLabel}
        loading={list.isFetching}
        stale={list.isPlaceholderData}
        empty={empty}
        fill
      />
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
  const importable = (meta.data?.actions ?? []).some((a) => a.name === `${entity.name}.import`);
  return <ListView key={entity.name} entity={entity} search={search} importable={importable} />;
}
