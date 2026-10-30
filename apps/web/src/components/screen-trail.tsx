import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useFavorites } from '../api/navigation-assist.ts';
import { useNavigation } from '../api/navigation.ts';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { helpTopicFor, helpUrl, manualBaseUrl } from '../lib/help.ts';
import { findNavigationEntry, findNavigationWorkspace } from '../lib/navigation.ts';
import type { NavigationCatalog, NavigationEntry } from '../lib/navigation-types.ts';
import { Icon } from './icon.tsx';
import { useToast } from './toast.tsx';
import './navigation-assist.css';

interface Crumb {
  label: Label;
  href?: string;
}

/** navigation-assist AC-6: VITE_MANUAL_URL, else the public repository's docs/manual/. */
const MANUAL_BASE = manualBaseUrl(import.meta.env.VITE_MANUAL_URL);

/** navigation-assist AC-4: a toggle button (aria-pressed); hidden when the browser storage cannot be used (AC-7). */
function FavoriteToggle({ entry, catalog }: { entry: NavigationEntry; catalog: NavigationCatalog }) {
  const { t } = useLocale();
  const toast = useToast();
  const favorites = useFavorites(catalog);
  if (!favorites.available) return null;
  const pressed = favorites.hrefs.includes(entry.href);
  const toggle = () => {
    const change = favorites.toggle(entry.href);
    if (change === 'full')
      toast.push({
        kind: 'info',
        title: t({
          ja: `お気に入りは ${favorites.max} 画面までです`,
          en: `Up to ${favorites.max} favourite screens`,
        }),
        message: t({ ja: '使わない画面のお気に入りを外してください。', en: 'Remove a favourite you no longer use.' }),
      });
    else if (change === 'failed')
      toast.push({
        kind: 'info',
        title: t({ ja: 'お気に入りを保存できませんでした', en: 'The favourite was not saved' }),
        message: t({
          ja: 'このブラウザの保存領域を使えません。ほかの操作はそのまま続けられます。',
          en: 'Browser storage is unavailable. Everything else keeps working.',
        }),
      });
  };
  return (
    <button type="button" className="screen-favorite" aria-pressed={pressed} onClick={toggle}>
      <Icon name="star" size={14} />
      {t({ ja: 'お気に入り', en: 'Favourite' })}
    </button>
  );
}

export function ScreenTrail() {
  const { t } = useLocale();
  const { catalog } = useNavigation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const entry = findNavigationEntry(catalog, pathname);
  const workspace = findNavigationWorkspace(catalog, pathname);
  const crumbs: Crumb[] = [{ label: { ja: 'ホーム', en: 'Home' }, href: '/' }];
  if (workspace) crumbs.push({ label: workspace.label, href: `/workspaces/${workspace.id}` });
  if (pathname === '/workspaces') crumbs.push({ label: { ja: 'すべての画面', en: 'All screens' } });
  else if (entry) {
    crumbs.push({ label: entry.label, href: entry.href });
    if (pathname !== entry.href)
      crumbs.push({
        label: pathname.endsWith('/new')
          ? { ja: '新規作成', en: 'New record' }
          : pathname.endsWith('/import')
            ? { ja: '取込', en: 'Import' }
            : { ja: '詳細', en: 'Record details' },
      });
  } else if (pathname !== '/' && !workspace) crumbs.push({ label: { ja: '現在の画面', en: 'Current screen' } });
  const title = t(crumbs[crumbs.length - 1]?.label);
  useEffect(() => {
    document.title = `${title} | Daifuku`;
  }, [title]);
  if (pathname === '/') return null;
  // Favourites are whole screens: offered on the catalog screen itself, not on its new/detail pages.
  const favorite = entry && entry.href === pathname ? entry : undefined;
  const help = helpTopicFor(pathname);
  return (
    <div className="screen-trail">
      <nav aria-label={t({ ja: '現在位置', en: 'Breadcrumb' })}>
        <ol>
          {crumbs.map((crumb, index) => (
            <li key={crumb.href ?? index}>
              {index < crumbs.length - 1 && crumb.href ? (
                <Link to={crumb.href} activeOptions={{ exact: true }}>
                  {t(crumb.label)}
                </Link>
              ) : (
                <span aria-current="page">{t(crumb.label)}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {favorite || help ? (
        <div className="screen-tools">
          {favorite ? <FavoriteToggle entry={favorite} catalog={catalog} /> : null}
          {help ? (
            <a className="screen-help" href={helpUrl(help, MANUAL_BASE)} target="_blank" rel="noreferrer">
              <Icon name="help" size={14} />
              {t({ ja: 'この画面の説明', en: 'Help for this screen' })}
              <span className="sr-only">{t({ ja: '（新しいタブで開きます）', en: ' (opens in a new tab)' })}</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
