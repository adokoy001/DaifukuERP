// Code-based routes: /login, and the authenticated shell with /, /e/$entity, /e/$entity/new, /e/$entity/$id,
// /r/$action (reports, web-phase1 AC-3) and /settings (AC-5).
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect, useNavigate } from '@tanstack/react-router';
import { clearSession, getToken, getUser, isApiError } from './api/client.ts';
import { CompanyProvider } from './api/company.tsx';
import { useMeta } from './api/queries.ts';
import { Sidebar } from './components/sidebar.tsx';
import { Icon } from './components/icon.tsx';
import { CompanyName } from './components/company-name.tsx';
import { CompanyPicker } from './components/company-picker.tsx';
import { useState } from 'react';
import { useLocale } from './i18n.tsx';
import { parseListSearch } from './lib/query.ts';
import { EntityFormPage } from './pages/entity-form-page.tsx';
import { EntityListPage } from './pages/entity-list-page.tsx';
import { HomePage } from './pages/home-page.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { ReportPage } from './pages/report-page.tsx';
import { SettingsPage } from './pages/settings-page.tsx';
import { TemplatesPage } from './pages/templates-page.tsx';
import { ActionPage } from './pages/action-page.tsx';
import { ReadRefreshNotice } from './components/read-refresh-notice.tsx';
import { canRetainData } from './lib/read-recovery.ts';
import { MetaError, NotFoundView } from './pages/status-views.tsx';

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundView });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (raw: Record<string, unknown>): { reason?: 'expired' | 'password-changed' | 'signed-out-all' } => (raw.reason === 'expired' || raw.reason === 'password-changed' || raw.reason === 'signed-out-all' ? { reason: raw.reason } : {}),
  component: LoginPage,
});

function AppLayout() {
  const meta = useMeta();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [navOpen, setNavOpen] = useState(false);
  const logout = () => {
    void navigate({ to: '/login' }).then(() => {
      if (router.state.location.pathname !== '/login') return;
      clearSession();
      qc.clear();
    });
  };
  return (
    <CompanyProvider>
      <div className="app-layout">
        <Sidebar meta={meta.data} userName={getUser()?.name ?? getUser()?.email} onLogout={logout} open={navOpen} onClose={() => setNavOpen(false)} />
        <main className="app-main">
          <div className="app-topbar"><div className="topbar-title"><button type="button" className="mobile-toggle" aria-label={t({ ja: 'メニューを開く', en: 'Open menu' })} aria-expanded={navOpen} aria-controls="app-navigation" onClick={() => setNavOpen(true)}><Icon name="menu" /></button><Icon name="building" size={17} /><CompanyName /></div><Link to="/account" className="topbar-right" aria-label={t({ ja: '自分のアカウント', en: 'My account' })}><span>{getUser()?.name ?? getUser()?.email}</span><span className="user-avatar">{(getUser()?.name ?? 'D').slice(0, 1)}</span></Link></div>
          <div className="page-content">{meta.isError && !canRetainData(meta) ? isApiError(meta.error) && meta.error.status === 403 ? <div className="workspace-page"><p className="notice-strip" role="alert">{t({ ja: 'この会社へのアクセス権がありません。利用できる会社を選び直してください。会社がない場合は管理者へ所属の設定を依頼してください。', en: 'Access to this company is unavailable. Select a permitted company, or ask your administrator to assign a membership.' })}</p><CompanyPicker disabled={false} /></div> : <MetaError error={meta.error} retry={() => void meta.refetch()} /> : <><ReadRefreshNotice sources={[meta]} /><Outlet /></>}</div>
        </main>
      </div>
    </CompanyProvider>
  );
}

// AC-1: no token -> login page. (A stale token is handled by the 401 path in api/client.ts.)
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' });
  },
  component: AppLayout,
});

const indexRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomePage });

const listRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/e/$entity',
  validateSearch: (raw: Record<string, unknown>) => parseListSearch(raw),
  component: EntityListPage,
});

const newRoute = createRoute({ getParentRoute: () => appRoute, path: '/e/$entity/new', component: () => <EntityFormPage mode="new" /> });
const recordRoute = createRoute({ getParentRoute: () => appRoute, path: '/e/$entity/$id', component: () => <EntityFormPage mode="edit" /> });
const reportRoute = createRoute({ getParentRoute: () => appRoute, path: '/r/$action', component: ReportPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage });
const templatesRoute = createRoute({ getParentRoute: () => appRoute, path: '/templates', component: TemplatesPage });
const actionRoute = createRoute({ getParentRoute: () => appRoute, path: '/a/$action', component: ActionPage });

const operationsRoute = createRoute({ getParentRoute: () => appRoute, path: '/operations', validateSearch: (raw: Record<string, unknown>): { from?: string; to?: string; asOf?: string; storeId?: string } => Object.fromEntries(Object.entries(raw).filter(([key, value]) => ['from', 'to', 'asOf', 'storeId'].includes(key) && typeof value === 'string')), component: lazyRouteComponent(() => import('./pages/operations-page.tsx'), 'OperationsPage') });
const reportsRoute = createRoute({ getParentRoute: () => appRoute, path: '/reports', component: lazyRouteComponent(() => import('./pages/reports-page.tsx'), 'ReportsPage') });
const accessRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/users', component: lazyRouteComponent(() => import('./pages/access-page.tsx'), 'AccessPage') });
const employeeRoute = createRoute({ getParentRoute: () => appRoute, path: '/me', component: lazyRouteComponent(() => import('./pages/employee-page.tsx'), 'EmployeePage') });
const workforceRoute = createRoute({ getParentRoute: () => appRoute, path: '/workforce', component: lazyRouteComponent(() => import('./pages/workforce-page.tsx'), 'WorkforcePage') });

const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: '/account', beforeLoad: () => { if (!getToken()) throw redirect({ to: '/login' }); }, component: lazyRouteComponent(() => import('./pages/account-page.tsx'), 'AccountPage') });

const routeTree = rootRoute.addChildren([loginRoute, accountRoute, appRoute.addChildren([indexRoute, listRoute, newRoute, recordRoute, reportRoute, settingsRoute, templatesRoute, actionRoute, operationsRoute, reportsRoute, accessRoute, employeeRoute, workforceRoute])]);

export const router = createRouter({ routeTree, defaultPreload: false, scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
