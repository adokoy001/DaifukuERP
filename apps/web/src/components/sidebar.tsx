import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useId, useRef } from 'react';
import { useFavorites, useRecentRecords } from '../api/navigation-assist.ts';
import { useNavigation } from '../api/navigation.ts';
import type { Locale } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { findNavigationWorkspace } from '../lib/navigation.ts';
import type { NavigationCatalog } from '../lib/navigation-types.ts';
import { recentRecordText, SIDEBAR_RECENT_RECORDS } from '../lib/recent-records.ts';
import { S } from '../strings.ts';
import { Icon } from './icon.tsx';
import { WORKSPACE_ICONS } from './workspace-cards.tsx';
import './navigation-assist.css';

interface SidebarProps {
  userName: string | undefined;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
}
const ACTIVE = { className: 'nav-link is-active' };

function LocaleToggle() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="locale-toggle">
      {(['ja', 'en'] as const).map((l: Locale) => (
        <button
          type="button"
          key={l}
          aria-pressed={locale === l}
          aria-label={`${t(S.language)}: ${l}`}
          onClick={() => setLocale(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** navigation-assist AC-4/AC-5: favourite screens; the heading disappears with the last favourite. */
function FavoriteLinks({ catalog }: { catalog: NavigationCatalog }) {
  const { t } = useLocale();
  const id = useId();
  const favorites = useFavorites(catalog);
  if (!favorites.available || !favorites.entries.length) return null;
  return (
    <div role="group" aria-labelledby={id}>
      <div className="nav-caption" id={id}>
        {t({ ja: 'お気に入り', en: 'Favourites' })}
      </div>
      {favorites.entries.map((entry) => (
        <Link key={entry.href} to={entry.href} className="nav-link nav-shortcut" activeProps={{}}>
          <Icon name="star" size={16} />
          <span>
            <span>{t(entry.label)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** navigation-assist AC-3/AC-5: the five most recent records of this company; hidden when there are none. */
function RecentLinks({ catalog }: { catalog: NavigationCatalog }) {
  const { t, locale } = useLocale();
  const id = useId();
  const recent = useRecentRecords(catalog);
  if (!recent.available || !recent.items.length) return null;
  return (
    <div role="group" aria-labelledby={id}>
      <div className="nav-caption" id={id}>
        {t({ ja: '最近', en: 'Recent' })}
      </div>
      {recent.items.slice(0, SIDEBAR_RECENT_RECORDS).map((item) => {
        const text = recentRecordText(item, locale);
        return (
          <Link
            key={`${item.entity}/${item.id}`}
            to="/e/$entity/$id"
            params={{ entity: item.entity, id: item.id }}
            className="nav-link nav-shortcut"
            activeProps={{}}
            title={text}
          >
            <Icon name="clock" size={16} />
            <span>
              <span>{text}</span>
              <small>{t(item.entityLabel)}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Navigation() {
  const { t } = useLocale();
  const { catalog, meta } = useNavigation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = findNavigationWorkspace(catalog, pathname)?.id;
  return (
    <>
      <Link to="/" className="nav-link" activeProps={ACTIVE} activeOptions={{ exact: true }}>
        <Icon name="home" size={18} />
        {t({ ja: 'ホーム', en: 'Home' })}
      </Link>
      {catalog.entries.some((entry) => entry.href === '/me') ? (
        <Link to="/me" className="nav-link" activeProps={ACTIVE}>
          <Icon name="clock" size={18} />
          {t({ ja: '自分の勤怠・申請', en: 'My workday' })}
        </Link>
      ) : null}
      <Link to="/workspaces" className="nav-link nav-find" activeProps={ACTIVE} activeOptions={{ exact: true }}>
        <Icon name="search" size={18} />
        {t({ ja: 'すべての画面を探す', en: 'Find a screen' })}
      </Link>
      <div className="nav-caption">{t({ ja: '業務分野', en: 'Business areas' })}</div>
      {catalog.workspaces.map((workspace) => (
        <Link
          key={workspace.id}
          to="/workspaces/$workspace"
          params={{ workspace: workspace.id }}
          className={`nav-link ${active === workspace.id ? 'is-active' : ''}`}
          activeProps={{}}
          aria-current={active === workspace.id ? 'location' : undefined}
        >
          <Icon name={WORKSPACE_ICONS[workspace.id]} size={18} />
          <span>{t(workspace.label)}</span>
        </Link>
      ))}
      <FavoriteLinks catalog={catalog} />
      <RecentLinks catalog={catalog} />
      {meta.isPending ? <p className="nav-help">{t(S.loading)}</p> : null}
      <p className="nav-help">
        {t({ ja: '業務を選ぶと、操作画面やマスターを探せます。', en: 'Choose an area to find workflows and records.' })}
      </p>
    </>
  );
}

/** Modal behavior follows the CSS breakpoint; desktop navigation stays ordinary. */
function useDrawer(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const media = globalThis.matchMedia('(max-width: 760px)');
    if (!media.matches) {
      onClose();
      return;
    }
    const previous = document.querySelector<HTMLButtonElement>('button[aria-controls="app-navigation"]');
    const panel = ref.current;
    const focusable = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length > 0);
    const first = () => focusable()[0] ?? panel;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const start = items[0];
      const end = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === start || !panel.contains(document.activeElement))) {
        event.preventDefault();
        (end ?? panel).focus();
      } else if (!event.shiftKey && (document.activeElement === end || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first().focus();
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) first().focus();
    };
    const resize = () => {
      if (!media.matches) onClose();
    };
    // A just-opened drawer can still have the preceding hidden style until the next frame.
    const frame = globalThis.requestAnimationFrame(() => first().focus());
    document.addEventListener('keydown', keyboard);
    document.addEventListener('focusin', keepFocus);
    media.addEventListener('change', resize);
    return () => {
      globalThis.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('focusin', keepFocus);
      media.removeEventListener('change', resize);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, onClose]);
  return ref;
}

export function Sidebar({ userName, onLogout, open, onClose }: SidebarProps) {
  const { t } = useLocale();
  const ref = useDrawer(open, onClose);
  return (
    <>
      {open ? (
        <button type="button" className="nav-scrim" onClick={onClose} tabIndex={-1} aria-label={t(S.close)} />
      ) : null}
      <aside
        ref={ref}
        id="app-navigation"
        className={`app-sidebar ${open ? 'is-open' : ''}`}
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
        aria-label={t(S.menu)}
        tabIndex={-1}
      >
        <div className="brand-row">
          <Link to="/" className="brand" onClick={onClose}>
            <span className="brand-mark">大</span>
            <span>
              Daifuku<small>{t({ ja: '日々の仕事を、ひとつに。', en: 'Every day, connected.' })}</small>
            </span>
          </Link>
          <button type="button" className="mobile-close" onClick={onClose} aria-label={t(S.close)}>
            <Icon name="close" />
          </button>
        </div>
        <nav
          aria-label={t(S.menu)}
          className="sidebar-nav"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) onClose();
          }}
        >
          <Navigation />
        </nav>
        <footer className="sidebar-footer">
          <Link to="/account" className="nav-link" onClick={onClose}>
            <Icon name="settings" size={17} />
            {t({ ja: '自分のアカウント', en: 'My account' })}
          </Link>
          <div className="user-row">
            <span className="user-avatar">{(userName ?? 'D').slice(0, 1).toUpperCase()}</span>
            <span className="user-name">
              {userName}
              <small>{t({ ja: 'ログイン中', en: 'Signed in' })}</small>
            </span>
            <button type="button" onClick={onLogout} title={t(S.logout)} aria-label={t(S.logout)}>
              <Icon name="logout" size={17} />
            </button>
          </div>
          <div className="sidebar-meta">
            <span>DAIFUKU WORKSPACE</span>
            <LocaleToggle />
          </div>
        </footer>
      </aside>
    </>
  );
}
