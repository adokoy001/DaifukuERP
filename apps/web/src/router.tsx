// Code-based routes: /login, and the authenticated shell with /, /e/$entity, /e/$entity/new, /e/$entity/$id,
// /r/$action (reports, web-phase1 AC-3) and /settings (AC-5).
import { useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { clearSession, getToken, getUser, isApiError } from './api/client.ts';
import { CompanyProvider } from './api/company.tsx';
import { useMeta } from './api/queries.ts';
import { Sidebar } from './components/sidebar.tsx';
import { Icon } from './components/icon.tsx';
import { CompanyName } from './components/company-name.tsx';
import { CompanyPicker } from './components/company-picker.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from './i18n.tsx';
import { parseListSearch } from './lib/query.ts';
import { EntityFormPage } from './pages/entity-form-page.tsx';
import { EntityListPage } from './pages/entity-list-page.tsx';
import { HomePage } from './pages/home-page.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { ReportPage } from './pages/report-page.tsx';
import { parseSettingsSearch, SettingsPage } from './pages/settings-page.tsx';
import { parseSetupSearch } from './lib/setup-wizard.ts';
import { TemplatesPage } from './pages/templates-page.tsx';
import { ActionPage } from './pages/action-page.tsx';
import { ReadRefreshNotice } from './components/read-refresh-notice.tsx';
import { canRetainData } from './lib/read-recovery.ts';
import { MetaError, NotFoundView } from './pages/status-views.tsx';
import { ScreenTrail } from './components/screen-trail.tsx';
import { CommandPalette } from './components/command-palette.tsx';
import { forgetRecentNames } from './api/navigation-assist.ts';
import { parseDirectorySearch } from './lib/menu-search.ts';
import { parseCloseSearch } from './lib/close-guide.ts';
import { parseOpeningSearch } from './lib/opening-balances.ts';
import { parseEvidenceSearch } from './lib/evidence-search.ts';
import { parseEmployeeSearch, parseWorkforceSearch } from './lib/workforce.ts';

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundView });

const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
/** The platform's own modifier only: on macOS Ctrl+K stays "delete to end of line" in text fields. */
const PALETTE_SHORTCUT = MAC ? 'Meta+K' : 'Control+K';

/**
 * navigation-assist AC-1: Ctrl+K (⌘+K on macOS) opens the command palette anywhere in the shell, also from a form
 * field. While another modal (a confirmation dialog, the phone drawer) is open the browser keeps the key.
 */
function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const primary = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (event.isComposing || event.altKey || event.shiftKey || !primary) return;
      if (event.key.toLowerCase() !== 'k' && event.code !== 'KeyK') return;
      if (document.querySelector('dialog.command-palette[open]')) {
        event.preventDefault();
        return;
      }
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      event.preventDefault();
      open();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [open]);
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (raw: Record<string, unknown>): { reason?: 'expired' | 'password-changed' | 'signed-out-all' } =>
    raw.reason === 'expired' || raw.reason === 'password-changed' || raw.reason === 'signed-out-all'
      ? { reason: raw.reason }
      : {},
  component: LoginPage,
});

function AppLayout() {
  const meta = useMeta();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [navOpen, setNavOpen] = useState(false);
  const closeNavigation = useCallback(() => setNavOpen(false), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  usePaletteShortcut(openPalette);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const previousPath = useRef(pathname);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    content.current?.focus({ preventScroll: true });
  }, [pathname]);
  const logout = () => {
    void navigate({ to: '/login' }).then(() => {
      if (router.state.location.pathname !== '/login') return;
      forgetRecentNames();
      clearSession();
      qc.clear();
    });
  };
  return (
    <CompanyProvider>
      <div className="app-layout">
        <Sidebar
          userName={getUser()?.name ?? getUser()?.email}
          onLogout={logout}
          open={navOpen}
          onClose={closeNavigation}
        />
        <main className="app-main" inert={navOpen}>
          <a className="skip-navigation" href="#screen-content">
            {t({ ja: '本文へ移動', en: 'Skip to content' })}
          </a>
          <div className="app-topbar">
            <div className="topbar-title">
              <button
                type="button"
                className="mobile-toggle"
                aria-label={t({ ja: 'メニューを開く', en: 'Open menu' })}
                aria-expanded={navOpen}
                aria-controls="app-navigation"
                onClick={() => setNavOpen(true)}
              >
                <Icon name="menu" />
              </button>
              <Link
                to="/templates"
                className="topbar-company"
                aria-label={t({ ja: '会社を切り替え', en: 'Switch company' })}
              >
                <Icon name="building" size={17} />
                <CompanyName />
                <small>{t({ ja: '会社を切り替え', en: 'Switch company' })}</small>
              </Link>
            </div>
            <button
              type="button"
              className="topbar-search"
              aria-label={t({ ja: '画面と記録を検索', en: 'Search screens and records' })}
              aria-haspopup="dialog"
              aria-keyshortcuts={PALETTE_SHORTCUT}
              onClick={openPalette}
            >
              <Icon name="search" size={16} />
              <span>{t({ ja: '検索', en: 'Search' })}</span>
              <kbd>{MAC ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            <Link to="/account" className="topbar-right" aria-label={t({ ja: '自分のアカウント', en: 'My account' })}>
              <span>{getUser()?.name ?? getUser()?.email}</span>
              <span className="user-avatar">{(getUser()?.name ?? 'D').slice(0, 1)}</span>
            </Link>
          </div>
          <div className="page-content" id="screen-content" ref={content} tabIndex={-1}>
            {meta.isError && !canRetainData(meta) ? (
              isApiError(meta.error) && meta.error.status === 403 ? (
                <div className="workspace-page">
                  <p className="notice-strip" role="alert">
                    {t({
                      ja: 'この会社へのアクセス権がありません。利用できる会社を選び直してください。会社がない場合は管理者へ所属の設定を依頼してください。',
                      en: 'Access to this company is unavailable. Select a permitted company, or ask your administrator to assign a membership.',
                    })}
                  </p>
                  <CompanyPicker disabled={false} />
                </div>
              ) : (
                <MetaError error={meta.error} retry={() => void meta.refetch()} />
              )
            ) : (
              <>
                <ScreenTrail />
                <ReadRefreshNotice sources={[meta]} />
                <Outlet />
              </>
            )}
          </div>
        </main>
        {paletteOpen ? <CommandPalette onClose={closePalette} /> : null}
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
const workspaceDirectoryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workspaces',
  validateSearch: parseDirectorySearch,
  component: lazyRouteComponent(() => import('./pages/workspaces-page.tsx'), 'WorkspacesPage'),
});
const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workspaces/$workspace',
  validateSearch: parseDirectorySearch,
  component: lazyRouteComponent(() => import('./pages/workspaces-page.tsx'), 'WorkspacesPage'),
});
const analyticsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/analytics',
  component: lazyRouteComponent(() => import('./pages/analytics-page.tsx'), 'AnalyticsPage'),
});

const listRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/e/$entity',
  validateSearch: (raw: Record<string, unknown>) => parseListSearch(raw),
  component: EntityListPage,
});

const newRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/e/$entity/new',
  component: () => <EntityFormPage mode="new" />,
});
// csv-import AC-11: master CSV import (static segment wins over $id).
const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/e/$entity/import',
  component: lazyRouteComponent(() => import('./pages/entity-import-page.tsx'), 'EntityImportPage'),
});
const recordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/e/$entity/$id',
  component: () => <EntityFormPage mode="edit" />,
});
const reportRoute = createRoute({ getParentRoute: () => appRoute, path: '/r/$action', component: ReportPage });
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  validateSearch: parseSettingsSearch,
  component: SettingsPage,
});
const templatesRoute = createRoute({ getParentRoute: () => appRoute, path: '/templates', component: TemplatesPage });
const actionRoute = createRoute({ getParentRoute: () => appRoute, path: '/a/$action', component: ActionPage });

const operationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/operations',
  validateSearch: (raw: Record<string, unknown>): { from?: string; to?: string; asOf?: string; storeId?: string } =>
    Object.fromEntries(
      Object.entries(raw).filter(
        ([key, value]) => ['from', 'to', 'asOf', 'storeId'].includes(key) && typeof value === 'string',
      ),
    ),
  component: lazyRouteComponent(() => import('./pages/operations-page.tsx'), 'OperationsPage'),
});
const edgeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/operations/devices',
  component: lazyRouteComponent(() => import('./pages/edge-page.tsx'), 'EdgePage'),
});
const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reports',
  component: lazyRouteComponent(() => import('./pages/reports-page.tsx'), 'ReportsPage'),
});
const accessRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  component: lazyRouteComponent(() => import('./pages/access-page.tsx'), 'AccessPage'),
});
// company-admin AC-9: tenant administrators add and rename companies.
const companiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/companies',
  component: lazyRouteComponent(() => import('./pages/companies-page.tsx'), 'CompaniesPage'),
});
// machine-credentials AC-27..AC-31: tenant administrators issue and revoke API keys.
const tokensRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/tokens',
  component: lazyRouteComponent(() => import('./pages/tokens-page.tsx'), 'TokensPage'),
});
// setup-health AC-9/AC-10: the setup check for admin or settings.
const healthRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/health',
  component: lazyRouteComponent(() => import('./pages/health-page.tsx'), 'HealthPage'),
});
// setup-wizard AC-1/AC-8: the setup wizard for company admins; `?step=` keeps the open step (known ids only).
const setupRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup',
  validateSearch: parseSetupSearch,
  component: lazyRouteComponent(() => import('./pages/setup-page.tsx'), 'SetupPage'),
});
// access-insight AC-6/AC-19: the permission matrix and the audit search for admins. validateSearch keeps the known keys
// with their raw values, whatever their type: the default search parser turns `?user=123` into a number, and the pages
// must see it to report it as an unreadable URL condition rather than drop it silently.
const knownSearch = (keys: readonly string[]) => (raw: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(raw).filter(([key]) => keys.includes(key))) as Record<string, unknown>;
const permissionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/permissions',
  validateSearch: knownSearch(['tab', 'module', 'role', 'q', 'packs']),
  component: lazyRouteComponent(() => import('./pages/permissions-page.tsx'), 'PermissionsPage'),
});
const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/audit',
  validateSearch: knownSearch(['from', 'to', 'user', 'entity', 'op', 'record', 'scope', 'cursor']),
  component: lazyRouteComponent(() => import('./pages/audit-page.tsx'), 'AuditPage'),
});
const employeeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/me',
  validateSearch: parseEmployeeSearch,
  component: lazyRouteComponent(() => import('./pages/employee-page.tsx'), 'EmployeePage'),
});
const workforceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workforce',
  validateSearch: parseWorkforceSearch,
  component: lazyRouteComponent(() => import('./pages/workforce-page.tsx'), 'WorkforcePage'),
});
const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/inbox',
  component: lazyRouteComponent(() => import('./pages/inbox-page.tsx'), 'InboxPage'),
});

const shiftRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workforce/shifts',
  component: lazyRouteComponent(() => import('./pages/shift-page.tsx'), 'ShiftPage'),
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' });
  },
  component: lazyRouteComponent(() => import('./pages/account-page.tsx'), 'AccountPage'),
});

const fiscalRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workforce/payroll',
  component: lazyRouteComponent(() => import('./pages/fiscal-page.tsx'), 'FiscalPage'),
});
const workSystemRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workforce/systems',
  component: lazyRouteComponent(() => import('./pages/work-system-page.tsx'), 'WorkSystemPage'),
});
const commercePosRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/commerce/pos',
  component: lazyRouteComponent(() => import('./pages/commerce-pos-page.tsx'), 'CommercePosPage'),
});
const commerceGroupRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/commerce/group',
  component: lazyRouteComponent(() => import('./pages/commerce-group-page.tsx'), 'CommerceGroupPage'),
});
const commerceFranchiseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/commerce/franchise',
  component: lazyRouteComponent(() => import('./pages/commerce-franchise-page.tsx'), 'CommerceFranchisePage'),
});
const tradeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/commerce/trade',
  component: lazyRouteComponent(() => import('./pages/trade-page.tsx'), 'TradePage'),
});
const bankingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/finance/banking',
  component: lazyRouteComponent(() => import('./pages/banking-page.tsx'), 'BankingPage'),
});
const closeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/finance/close',
  validateSearch: parseCloseSearch,
  component: lazyRouteComponent(() => import('./pages/close-page.tsx'), 'ClosePage'),
});
// docs/specs/opening-balances.md AC-31 / AC-32: the opening balance import; the chosen year stays in ?fiscalYearId=.
const openingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/finance/opening',
  validateSearch: parseOpeningSearch,
  component: lazyRouteComponent(() => import('./pages/opening-balances-page.tsx'), 'OpeningBalancesPage'),
});
const recurringRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/finance/recurring',
  component: lazyRouteComponent(() => import('./pages/recurring-page.tsx'), 'RecurringPage'),
});
// docs/specs/evidence-search.md AC-12/AC-13: the evidence search keeps its criteria in the URL.
const evidenceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/finance/evidence',
  validateSearch: parseEvidenceSearch,
  component: lazyRouteComponent(() => import('./pages/evidence-page.tsx'), 'EvidencePage'),
});
const taxFilingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/finance/filing',
  component: lazyRouteComponent(() => import('./pages/tax-filing-page.tsx'), 'TaxFilingPage'),
});

const publicIdentityRoutes = [
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: lazyRouteComponent(() => import('./pages/identity-public-pages.tsx'), 'ForgotPasswordPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/reset-password',
    component: lazyRouteComponent(() => import('./pages/identity-public-pages.tsx'), 'MailPasswordPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/accept-invitation',
    component: lazyRouteComponent(() => import('./pages/identity-public-pages.tsx'), 'InvitationPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/oidc/callback',
    component: lazyRouteComponent(() => import('./pages/identity-public-pages.tsx'), 'SsoCallbackPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/recovery-codes',
    component: lazyRouteComponent(() => import('./pages/identity-public-pages.tsx'), 'RecoveryCodesPage'),
  }),
];

const routeTree = rootRoute.addChildren([
  loginRoute,
  accountRoute,
  ...publicIdentityRoutes,
  appRoute.addChildren([
    indexRoute,
    workspaceDirectoryRoute,
    workspaceRoute,
    analyticsRoute,
    listRoute,
    newRoute,
    importRoute,
    recordRoute,
    reportRoute,
    settingsRoute,
    templatesRoute,
    actionRoute,
    operationsRoute,
    edgeRoute,
    reportsRoute,
    accessRoute,
    companiesRoute,
    tokensRoute,
    healthRoute,
    setupRoute,
    permissionsRoute,
    auditRoute,
    employeeRoute,
    workforceRoute,
    inboxRoute,
    shiftRoute,
    fiscalRoute,
    workSystemRoute,
    commercePosRoute,
    commerceGroupRoute,
    commerceFranchiseRoute,
    tradeRoute,
    bankingRoute,
    closeRoute,
    openingRoute,
    recurringRoute,
    evidenceRoute,
    taxFilingRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: false, scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
