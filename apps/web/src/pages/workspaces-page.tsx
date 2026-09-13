import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useNavigation } from '../api/navigation.ts';
import type { Label } from '../api/types.ts';
import { Icon } from '../components/icon.tsx';
import { ScreenCard, WORKSPACE_ICONS } from '../components/workspace-cards.tsx';
import { useLocale } from '../i18n.tsx';
import {
  DIRECTORY_KINDS,
  parseDirectorySearch,
  type DirectoryKind,
  type DirectoryPatch,
  type DirectorySearch,
} from '../lib/menu-search.ts';
import { searchNavigation, type NavigationEntry, type NavigationWorkspace } from '../lib/navigation.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const PAGE_SIZE = 24;
const KIND_LABELS: Record<DirectoryKind, Label> = {
  workspace: { ja: '業務画面', en: 'Workflows' },
  record: { ja: 'マスター・記録', en: 'Masters and records' },
  report: { ja: '帳票', en: 'Reports' },
  action: { ja: '操作', en: 'Actions' },
  setting: { ja: '設定', en: 'Settings' },
};

function DirectoryPager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const { t } = useLocale();
  if (pages <= 1) return null;
  return (
    <nav className="directory-pager" aria-label={t({ ja: '画面一覧のページ', en: 'Screen directory pages' })}>
      <button type="button" className="btn" disabled={page === 1} onClick={() => onPage(1)}>
        {t({ ja: '先頭', en: 'First' })}
      </button>
      <button type="button" className="btn" disabled={page === 1} onClick={() => onPage(page - 1)}>
        {t({ ja: '前へ', en: 'Previous' })}
      </button>
      <label>
        {t({ ja: 'ページ', en: 'Page' })}
        <select className="input" value={page} onChange={(event) => onPage(Number(event.target.value))}>
          {Array.from({ length: pages }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1} / {pages}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" disabled={page === pages} onClick={() => onPage(page + 1)}>
        {t({ ja: '次へ', en: 'Next' })}
      </button>
      <button type="button" className="btn" disabled={page === pages} onClick={() => onPage(pages)}>
        {t({ ja: '最後', en: 'Last' })}
      </button>
    </nav>
  );
}

function FeaturedScreens({ entries }: { entries: NavigationEntry[] }) {
  const { t } = useLocale();
  if (!entries.length) return null;
  return (
    <section className="featured-screens" aria-label={t({ ja: 'よく使う操作', en: 'Start a workflow' })}>
      <div className="section-heading">
        <h2>
          <Icon name="spark" size={19} />
          {t({ ja: 'よく使う操作', en: 'Start a workflow' })}
        </h2>
      </div>
      <div className="screen-grid">
        {entries.map((entry) => (
          <ScreenCard key={entry.id} entry={entry} featured />
        ))}
      </div>
    </section>
  );
}

function DirectoryFilters({
  search,
  workspaces,
  workspace,
  onChange,
  onWorkspace,
}: {
  search: DirectorySearch;
  workspaces: NavigationWorkspace[];
  workspace?: NavigationWorkspace | undefined;
  onChange: (patch: DirectoryPatch) => void;
  onWorkspace: (id: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="directory-filters">
      <label className="directory-search">
        <span>{t({ ja: '画面名を検索', en: 'Search screens' })}</span>
        <div>
          <Icon name="search" size={18} />
          <input
            type="search"
            className="input"
            maxLength={120}
            value={search.q ?? ''}
            placeholder={t({ ja: '例：請求、シフト、試算表', en: 'Try invoice, shift or trial balance' })}
            onChange={(event) => onChange({ q: event.target.value || undefined, page: undefined })}
          />
        </div>
      </label>
      <label>
        <span>{t({ ja: '業務分野', en: 'Business area' })}</span>
        <select className="input" value={workspace?.id ?? ''} onChange={(event) => onWorkspace(event.target.value)}>
          <option value="">{t({ ja: 'すべての分野', en: 'All areas' })}</option>
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {t(item.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t({ ja: '画面の種類', en: 'Screen type' })}</span>
        <select
          className="input"
          value={search.kind ?? ''}
          onChange={(event) =>
            onChange({ kind: DIRECTORY_KINDS.find((kind) => kind === event.target.value), page: undefined })
          }
        >
          <option value="">{t({ ja: 'すべての種類', en: 'All types' })}</option>
          {DIRECTORY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_LABELS[kind])}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function DirectoryResults({
  entries,
  page,
  filtered,
  onClear,
}: {
  entries: NavigationEntry[];
  page: number;
  filtered: boolean;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const start = (page - 1) * PAGE_SIZE;
  return (
    <>
      <p className="directory-count" role="status">
        {entries.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, entries.length)} / ${entries.length}` : '0'}{' '}
        {t({ ja: '画面', en: 'screens' })}
      </p>
      <div className="screen-grid">
        {entries.slice(start, start + PAGE_SIZE).map((entry) => (
          <div className="directory-result" key={entry.id}>
            <span className="screen-kind">{t(KIND_LABELS[entry.kind])}</span>
            <ScreenCard entry={entry} />
          </div>
        ))}
      </div>
      {!entries.length ? (
        <div className="directory-empty">
          <Icon name="search" size={30} />
          <p>
            {t(
              filtered
                ? {
                    ja: '条件に一致する画面がありません。短い言葉や別の種類で探してください。',
                    en: 'No matching screens. Try a shorter phrase or another type.',
                  }
                : {
                    ja: 'この分野の操作画面は上にまとめています。',
                    en: 'The workflows for this area are listed above.',
                  },
            )}
          </p>
          {filtered ? (
            <button type="button" className="btn" onClick={onClear}>
              {t({ ja: '検索条件をクリア', en: 'Clear filters' })}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function WorkspacesPage() {
  const { t, locale } = useLocale();
  const { catalog, meta } = useNavigation();
  const { workspace: workspaceId } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as DirectorySearch;
  const navigate = useNavigate();
  const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
  const update = (patch: DirectoryPatch, replace = true) => {
    const next = parseDirectorySearch({ ...search, ...patch });
    if (workspaceId)
      void navigate({
        to: '/workspaces/$workspace',
        params: { workspace: workspaceId },
        search: next,
        replace,
        resetScroll: false,
      });
    else void navigate({ to: '/workspaces', search: next, replace, resetScroll: false });
  };
  const switchWorkspace = (id: string) => {
    const next = parseDirectorySearch({ q: search.q, kind: search.kind });
    if (id) void navigate({ to: '/workspaces/$workspace', params: { workspace: id }, search: next });
    else void navigate({ to: '/workspaces', search: next });
  };
  if (meta.isError && !canRetainData(meta)) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  if (workspaceId && !workspace)
    return (
      <div className="workspace-page">
        <h1>{t({ ja: 'この業務分野は利用できません', en: 'This business area is unavailable' })}</h1>
        <p>
          {t({
            ja: '現在の会社・権限で利用できる画面を確認してください。',
            en: 'Explore the screens available for your company and access.',
          })}
        </p>
        <Link to="/workspaces" className="btn">
          {t({ ja: 'すべての画面を探す', en: 'Find a screen' })}
        </Link>
      </div>
    );
  return (
    <DirectoryContent
      workspace={workspace}
      workspaces={catalog.workspaces}
      entries={searchNavigation(catalog, search.q ?? '', locale)}
      search={search}
      update={update}
      switchWorkspace={switchWorkspace}
    />
  );
}

function DirectoryContent({
  workspace,
  workspaces,
  entries,
  search,
  update,
  switchWorkspace,
}: {
  workspace?: NavigationWorkspace | undefined;
  workspaces: NavigationWorkspace[];
  entries: NavigationEntry[];
  search: DirectorySearch;
  update: (patch: DirectoryPatch, replace?: boolean) => void;
  switchWorkspace: (id: string) => void;
}) {
  const { t } = useLocale();
  const filtered = Boolean(search.q?.trim() || search.kind);
  const featured = !filtered && workspace ? workspace.entries.filter((entry) => entry.featured) : [];
  const featuredIds = new Set(featured.map((entry) => entry.id));
  const visible = entries.filter(
    (entry) =>
      (!workspace || entry.workspace === workspace.id) &&
      (!search.kind || entry.kind === search.kind) &&
      !featuredIds.has(entry.id),
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.min(search.page ?? 1, pages);
  return (
    <div className={`workspace-page directory-page workspace-${workspace?.id ?? 'other'}`}>
      <header className="directory-heading">
        <span className="workspace-tile-icon">
          <Icon name={workspace ? WORKSPACE_ICONS[workspace.id] : 'search'} size={28} />
        </span>
        <div>
          <span className="eyebrow">{workspace ? 'YOUR BUSINESS AREA' : 'SCREEN DIRECTORY'}</span>
          <h1>{workspace ? t(workspace.label) : t({ ja: 'すべての画面を探す', en: 'Find a screen' })}</h1>
          <p>
            {workspace
              ? t(workspace.description)
              : t({
                  ja: '画面名や業務の言葉で検索できます。現在の会社・権限で利用できる画面を表示します。',
                  en: 'Search screen names and business terms. Only screens available for your company and access are shown.',
                })}
          </p>
        </div>
      </header>
      <DirectoryFilters
        search={search}
        workspaces={workspaces}
        workspace={workspace}
        onChange={update}
        onWorkspace={switchWorkspace}
      />
      <FeaturedScreens entries={featured} />
      <section className="directory-records" aria-label={t({ ja: '画面一覧', en: 'Screen directory' })}>
        <div className="section-heading">
          <h2>
            {t(
              featured.length
                ? { ja: 'マスター・記録と関連する画面', en: 'Masters, records and other screens' }
                : { ja: '画面一覧', en: 'Screen directory' },
            )}
          </h2>
          {filtered ? (
            <button
              type="button"
              className="btn"
              onClick={() => update({ q: undefined, kind: undefined, page: undefined })}
            >
              {t({ ja: '条件をクリア', en: 'Clear filters' })}
            </button>
          ) : null}
        </div>
        <DirectoryResults
          entries={visible}
          page={page}
          filtered={filtered}
          onClear={() => update({ q: undefined, kind: undefined, page: undefined })}
        />
        <DirectoryPager
          page={page}
          pages={pages}
          onPage={(next) => update({ page: next === 1 ? undefined : next }, false)}
        />
      </section>
      {workspace && workspace.id !== 'reports' && workspaces.some((item) => item.id === 'reports') ? (
        <Link to="/workspaces/$workspace" params={{ workspace: 'reports' }} className="directory-next">
          <Icon name="chart" size={20} />
          <span>
            {t({ ja: '記録をまとめて確認する', en: 'Review your records in context' })}
            <small>{t({ ja: '分析・レポートで集計や推移を確認', en: 'Explore reports and pivot analytics' })}</small>
          </span>
          <Icon name="arrow" size={17} />
        </Link>
      ) : null}
    </div>
  );
}
