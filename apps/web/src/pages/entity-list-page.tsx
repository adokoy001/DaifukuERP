// AC-3: /e/:entity — paged table (views.list), debounced search, sortable headers, total count, "New" when ops has create.
// ui-kit AC-4..6: PageHeader + Toolbar, skeleton rows while a changed query loads, and an empty state with the next step.
// csv-import AC-11: "Import" next to "New" when the entity has a derived <entity>.import action and create permission.
// list-workbench (docs/specs/list-workbench.md): meta-driven filters in the URL (`?f=`, and the `?status=&from=&to=`
// link contract) sent as REST `where`, a column chooser and saved views in browser storage, page totals of money
// columns, CSV export through the fresh export authorization, and bulk submit / cancel / delete with per-row results.
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCompanyId, getUser } from '../api/client.ts';
import { useCurrencyScale } from '../api/company.tsx';
import { useEntityMeta, useList, useMeta, useRefLabelMaps } from '../api/queries.ts';
import type { EntityMeta, Label, RecordJson } from '../api/types.ts';
import { DataTable, type RowSelection } from '../components/data-table.tsx';
import { BulkBar, BulkConfirm, BulkResults, useBulkRunner } from '../components/list-bulk.tsx';
import { ListColumnsDialog } from '../components/list-columns-dialog.tsx';
import { ListEmptyState } from '../components/list-empty-state.tsx';
import { ListExportButton } from '../components/list-export.tsx';
import { ListFilterPanel } from '../components/list-filter-panel.tsx';
import { ListViewsDialog } from '../components/list-views-dialog.tsx';
import { WorkforceWorkflowLink } from '../components/workforce-workflow-link.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { decimalMinScale, formatDecimal } from '../lib/format.ts';
import {
  activeFilterCount,
  describeFilter,
  effectiveFilters,
  filterDefs,
  filtersToDomain,
  parseFilters,
  withFilter,
  type ListFilters,
} from '../lib/list-filters.ts';
import {
  columnCandidates,
  deleteView,
  EMPTY_PREFS,
  isDefaultColumns,
  listStorageKey,
  mutateListPrefs,
  newViewId,
  readListPrefs,
  resolveColumns,
  saveView,
  type ListPrefs,
  type ListStorage,
  type SavedListView,
} from '../lib/list-views.ts';
import {
  BULK_LIMIT,
  bulkOps,
  exportActionName,
  exportInput,
  pageTotals,
  planBulk,
  rowLabel,
  type BulkOp,
} from '../lib/list-workbench.ts';
import { PAGE_SIZE, pageCount, toListState, updateSearch, type ListSearch, type SearchPatch } from '../lib/query.ts';
import { S } from '../strings.ts';
import { Button, buttonClass, EmptyState, PageHeader, Toolbar } from '../ui/index.ts';
import { EntityMissing, LoadingView, MetaError } from './status-views.tsx';

const W = {
  filters: { ja: '絞り込み', en: 'Filters' },
  columns: { ja: '列', en: 'Columns' },
  views: { ja: '保存ビュー', en: 'Saved views' },
  clearFilters: { ja: '絞り込みをクリア', en: 'Clear filters' },
  removeFilter: { ja: '絞り込みを外す', en: 'Remove filter' },
  pageTotals: { ja: 'このページの合計', en: 'Totals on this page' },
  storageFailed: {
    ja: '表示設定を読み込めませんでした。既定の列で表示しています。',
    en: 'Could not read the saved list settings; showing the default columns.',
  },
  saveFailed: {
    ja: 'このブラウザに保存できませんでした。表示は変わりません。',
    en: 'Could not save in this browser; the list is unchanged.',
  },
  newerVersion: {
    ja: '新しい版で保存された設定があるため上書きしません。',
    en: 'Settings saved by a newer version are not overwritten.',
  },
  selectRow: { ja: '選択', en: 'Select' },
  selectPage: { ja: 'このページの行をすべて選択', en: 'Select all rows on this page' },
  limitReached: {
    ja: `一度に選択できるのは ${BULK_LIMIT} 件までです。`,
    en: `Up to ${BULK_LIMIT} rows can be selected at once.`,
  },
} satisfies Record<string, Label>;

/** "絞り込み（2）" / "Filters (2)". */
function withCount(text: string, count: number, locale: 'ja' | 'en'): string {
  return locale === 'ja' ? `${text}（${count}）` : `${text} (${count})`;
}

/** localStorage, when this browser lets the page use it (private modes and blocked site data throw). */
function browserStorage(): ListStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

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

/** AC-4/AC-5: the column layout and saved views of this list in browser storage; failures leave the defaults. */
function useListPrefs(entity: string) {
  const { t } = useLocale();
  const toast = useToast();
  const user = getUser();
  const key = listStorageKey(
    { tenantId: user?.tenantId ?? '', userId: user?.id ?? '', companyId: getCompanyId() ?? '' },
    entity,
  );
  const [prefs, setPrefs] = useState<ListPrefs>(EMPTY_PREFS);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => {
      const storage = browserStorage();
      try {
        setPrefs(storage ? readListPrefs(storage, key) : EMPTY_PREFS);
        setReadFailed(false);
      } catch {
        setPrefs(EMPTY_PREFS);
        setReadFailed(true);
      }
    };
    const receive = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh();
    };
    refresh();
    globalThis.addEventListener('storage', receive);
    return () => globalThis.removeEventListener('storage', receive);
  }, [key]);
  const change = useCallback(
    async (update: (current: ListPrefs) => ListPrefs): Promise<boolean> => {
      const storage = browserStorage();
      setBusy(true);
      try {
        if (!storage) throw new Error('storage unavailable');
        const next = await mutateListPrefs(storage, globalThis.navigator?.locks, key, update);
        setPrefs(next);
        setReadFailed(false);
        return true;
      } catch (error) {
        toast.push({
          kind: 'error',
          title: t(error instanceof Error && error.name === 'ListStorageError' ? W.newerVersion : W.saveFailed),
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [key, t, toast],
  );
  return { prefs, readFailed, busy, change };
}

/** Rows chosen for a bulk operation, kept across pages of the same criteria and refreshed with the rows shown. */
function useSelection(rows: RecordJson[] | undefined, criteria: string) {
  const [selected, setSelected] = useState<Map<string, RecordJson>>(() => new Map());
  useEffect(() => setSelected(new Map()), [criteria]);
  useEffect(() => {
    if (!rows) return;
    setSelected((current) => {
      if (!rows.some((row) => current.has(row.id))) return current;
      const next = new Map(current);
      for (const row of rows) if (next.has(row.id)) next.set(row.id, row);
      return next;
    });
  }, [rows]);
  const toggle = (row: RecordJson, on: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      if (on && next.size < BULK_LIMIT) next.set(row.id, row);
      if (!on) next.delete(row.id);
      return next;
    });
  const togglePage = (page: RecordJson[], on: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of page) {
        if (!on) next.delete(row.id);
        else if (next.size < BULK_LIMIT) next.set(row.id, row);
      }
      return next;
    });
  return { selected, toggle, togglePage, clear: () => setSelected(new Map()) };
}

function ListView({ entity, search, importable }: { entity: EntityMeta; search: ListSearch; importable: boolean }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const meta = useMeta();
  const currencyScale = useCurrencyScale();
  const { text, setText, navigate } = useDebouncedNavigate(entity.name, search);
  const defs = useMemo(() => filterDefs(entity), [entity]);
  const filters = useMemo(() => effectiveFilters(search, entity, defs), [search, entity, defs]);
  const where = useMemo(() => filtersToDomain(filters, defs), [filters, defs]);
  const state = useMemo(() => ({ ...toListState(search), ...(where ? { where } : {}) }), [search, where]);
  const list = useList(entity.name, state);
  useEffect(() => {
    if (list.error) toast.error(list.error);
  }, [list.error, toast]);
  const { prefs, readFailed, busy: prefsBusy, change } = useListPrefs(entity.name);
  // web-phase15 AC-3: `ext.<key>` in views.list resolves to the registered ext field; AC-4 stored columns override it.
  const columns = useMemo(() => resolveColumns(entity, prefs.columns), [entity, prefs.columns]);
  const refFields = useMemo(() => columns.filter((f) => f.kind === 'ref'), [columns]);
  const rows = list.data?.items;
  const refLabel = useRefLabelMaps(refFields, rows ?? []);
  // Chip labels of ref filters resolve like ref cells: one pseudo row carrying the filter values.
  const refFilterFields = useMemo(() => defs.flatMap((d) => (d.kind === 'ref' && d.field ? [d.field] : [])), [defs]);
  const filterRow = useMemo(() => [{ id: 'filters', ...filters } as unknown as RecordJson], [filters]);
  const filterRefLabel = useRefLabelMaps(refFilterFields, filterRow);
  const setSearch = (patch: SearchPatch) =>
    void navigate({ to: '/e/$entity', params: { entity: entity.name }, search: (prev) => updateSearch(prev, patch) });
  const applyFilters = (next: ListFilters) => setSearch({ f: activeFilterCount(next) ? next : undefined });
  const openRow = (row: RecordJson) =>
    void navigate({ to: '/e/$entity/$id', params: { entity: entity.name, id: row.id } });
  const page = search.page ?? 1;
  const canCreate = entity.ops.includes('create');
  const canExport = meta.data?.actions.some((a) => a.name === exportActionName(entity.name) && a.canExport === true);
  const ops = bulkOps(entity);
  const criteria = JSON.stringify([search.q ?? '', search.sort ?? '', where ?? null]);
  const selection = useSelection(rows, criteria);
  const bulk = useBulkRunner(entity);
  const [confirmOp, setConfirmOp] = useState<BulkOp | null>(null);
  const [dialog, setDialog] = useState<'columns' | 'views' | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = activeFilterCount(filters);
  const totals = useMemo(() => (rows?.length ? pageTotals(rows, columns) : []), [rows, columns]);
  // "Clear search" and "Retry" sit in the table body and disappear when the list reloads; keep keyboard and
  // screen-reader users in place by moving focus to the search box (their next step is to type or read on).
  const searchBox = useRef<HTMLInputElement>(null);
  if (entity.name.startsWith('workforce_') && list.isError)
    return <MetaError error={list.error} retry={() => void list.refetch()} />;
  const selectedRows = [...selection.selected.values()];
  const rowSelection: RowSelection | undefined = ops.length
    ? {
        isSelected: (row) => selection.selected.has(row.id),
        onToggle: selection.toggle,
        onTogglePage: selection.togglePage,
        isDisabled: () => selection.selected.size >= BULK_LIMIT,
        rowLabel: (row) => `${t(W.selectRow)}: ${rowLabel(entity, row)}`,
        pageLabel: t(W.selectPage),
      }
    : undefined;
  const empty = list.data ? (
    <ListEmptyState
      entityLabel={t(entity.label)}
      query={search.q}
      total={list.data.total}
      filterCount={filterCount}
      onClearFilters={() => {
        applyFilters({});
        searchBox.current?.focus();
      }}
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
  const saveCurrentView = (name: string) => {
    const existing = prefs.views.find((v) => v.name.trim() === name);
    const view: SavedListView = {
      id: existing?.id ?? newViewId(),
      name,
      updatedAt: new Date().toISOString(),
      ...(search.q ? { q: search.q } : {}),
      ...(search.sort ? { sort: search.sort } : {}),
      ...(filterCount ? { filters } : {}),
      columns: columns.map((c) => c.name),
    };
    void change((current) => saveView(current, view)).then((ok) => {
      if (ok) toast.success(locale === 'ja' ? `ビュー「${name}」を保存しました` : `Saved view “${name}”`);
    });
  };
  const openView = (view: SavedListView) => {
    setDialog(null);
    const restored = parseFilters(view.filters, defs);
    setText(view.q ?? '');
    void navigate({
      to: '/e/$entity',
      params: { entity: entity.name },
      search: () =>
        updateSearch({}, { q: view.q, sort: view.sort, f: activeFilterCount(restored) ? restored : undefined }),
    });
    const names = view.columns && !isDefaultColumns(entity, view.columns) ? view.columns : undefined;
    void change((current) => {
      const { columns: _old, ...rest } = current;
      return names ? { ...rest, columns: names } : rest;
    });
  };
  const filterPanelId = `list-filters-${entity.name}`;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <PageHeader
        title={t(entity.label)}
        meta={<span className="ui-code">{entity.name}</span>}
        actions={
          <>
            {canExport ? (
              <ListExportButton
                entity={entity.name}
                input={exportInput(entity, { search: search.q, sort: search.sort, where }, columns, locale)}
                total={list.data?.total}
              />
            ) : null}
            {/* csv-import AC-11: only for importable masters the caller may create. */}
            {canCreate && importable ? (
              <Link to="/e/$entity/import" params={{ entity: entity.name }} className={buttonClass()}>
                {t({ ja: '取込', en: 'Import' })}
              </Link>
            ) : null}
            {canCreate ? (
              <Link to="/e/$entity/new" params={{ entity: entity.name }} className={buttonClass('primary')}>
                + {t(S.new)}
              </Link>
            ) : null}
          </>
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
          className="input w-64 max-w-full"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {defs.length ? (
          <Button
            aria-expanded={filtersOpen}
            aria-controls={filtersOpen ? filterPanelId : undefined}
            onClick={() => setFiltersOpen((open) => !open)}
            data-testid="filters-toggle"
          >
            {filterCount ? withCount(t(W.filters), filterCount, locale) : t(W.filters)}
          </Button>
        ) : null}
        <Button onClick={() => setDialog('columns')}>{t(W.columns)}</Button>
        <Button onClick={() => setDialog('views')}>
          {prefs.views.length ? withCount(t(W.views), prefs.views.length, locale) : t(W.views)}
        </Button>
      </Toolbar>
      {readFailed ? <p className="ui-notice ui-notice-warning text-xs">{t(W.storageFailed)}</p> : null}
      {filterCount ? (
        <div className="ui-chips" data-testid="filter-chips">
          {defs.map((def) => {
            const value = filters[def.key];
            if (value === undefined) return null;
            const shown = `${t(def.label)}: ${describeFilter(def, value, locale, (id) =>
              def.field ? filterRefLabel(def.field, id) : undefined,
            )}`;
            return (
              <button
                key={def.key}
                type="button"
                className="ui-chip"
                aria-label={`${t(W.removeFilter)}: ${shown}`}
                onClick={() => applyFilters(withFilter(filters, defs, def.key, undefined))}
              >
                <span>{shown}</span>
                <span aria-hidden="true">×</span>
              </button>
            );
          })}
          <button type="button" className="ui-link" onClick={() => applyFilters({})}>
            {t(W.clearFilters)}
          </button>
        </div>
      ) : null}
      {filtersOpen && defs.length ? (
        <ListFilterPanel
          key={JSON.stringify(filters)}
          id={filterPanelId}
          defs={defs}
          filters={filters}
          onApply={applyFilters}
        />
      ) : null}
      <WorkforceWorkflowLink entity={entity.name} />
      {ops.length && selectedRows.length ? (
        <BulkBar
          ops={ops}
          selected={selectedRows}
          busy={bulk.run?.active === true}
          onChoose={setConfirmOp}
          onClear={selection.clear}
        />
      ) : null}
      {selection.selected.size >= BULK_LIMIT ? <p className="text-xs text-text-muted">{t(W.limitReached)}</p> : null}
      {bulk.run ? <BulkResults entity={entity} run={bulk.run} onClose={bulk.clear} /> : null}
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
        {...(rowSelection ? { selection: rowSelection } : {})}
      />
      {totals.length && rows ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary" data-testid="page-totals">
          <span className="font-semibold">
            {locale === 'ja'
              ? `${t(W.pageTotals)}（表示中の ${rows.length} 件）`
              : `${t(W.pageTotals)} (${rows.length} rows shown)`}
          </span>
          {totals.map(({ field, total }) => (
            <span key={field.name} data-total={field.name}>
              {t(field.label)}:{' '}
              <span className="font-mono tabular-nums">
                {formatDecimal(total, decimalMinScale(field, currencyScale))}
              </span>
            </span>
          ))}
        </p>
      ) : null}
      {dialog === 'columns' ? (
        <ListColumnsDialog
          candidates={columnCandidates(entity)}
          current={columns.map((c) => c.name)}
          onClose={() => setDialog(null)}
          onReset={() => {
            setDialog(null);
            void change(({ columns: _old, ...rest }) => rest);
          }}
          onApply={(names) => {
            setDialog(null);
            void change(({ columns: _old, ...rest }) =>
              isDefaultColumns(entity, names) ? rest : { ...rest, columns: names },
            );
          }}
        />
      ) : null}
      {dialog === 'views' ? (
        <ListViewsDialog
          views={prefs.views}
          busy={prefsBusy}
          onClose={() => setDialog(null)}
          onSave={saveCurrentView}
          onOpen={openView}
          onDelete={(view) => void change((current) => deleteView(current, view.id))}
        />
      ) : null}
      {confirmOp ? (
        <BulkConfirm
          entity={entity}
          op={confirmOp}
          selected={selectedRows}
          onClose={() => setConfirmOp(null)}
          onConfirm={() => {
            const op = confirmOp;
            const targets = planBulk(op, selectedRows).targets;
            setConfirmOp(null);
            selection.clear();
            void bulk.start(op, targets);
          }}
        />
      ) : null}
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
