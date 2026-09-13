import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useNavigation } from '../api/navigation.ts';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { findNavigationEntry, findNavigationWorkspace } from '../lib/navigation.ts';

interface Crumb { label: Label; href?: string }

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
    if (pathname !== entry.href) crumbs.push({ label: pathname.endsWith('/new') ? { ja: '新規作成', en: 'New record' } : { ja: '詳細', en: 'Record details' } });
  } else if (pathname !== '/' && !workspace) crumbs.push({ label: { ja: '現在の画面', en: 'Current screen' } });
  const title = t(crumbs[crumbs.length - 1]?.label);
  useEffect(() => { document.title = `${title} | Daifuku`; }, [title]);
  if (pathname === '/') return null;
  return <nav className="screen-trail" aria-label={t({ ja: '現在位置', en: 'Breadcrumb' })}><ol>
    {crumbs.map((crumb, index) => <li key={crumb.href ?? index}>{index < crumbs.length - 1 && crumb.href
      ? <Link to={crumb.href} activeOptions={{ exact: true }}>{t(crumb.label)}</Link>
      : <span aria-current="page">{t(crumb.label)}</span>}</li>)}
  </ol></nav>;
}
