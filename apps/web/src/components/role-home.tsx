// Role-based home views and their switcher (docs/specs/role-home.md AC-1..AC-6, AC-14..AC-19). The views come from
// /meta, the screen catalog and tenantAdmin only; the chosen one is remembered per tenant, user and company; only the
// selected view is rendered and read, a view picked in the switcher starts reading once the choice settles, and a
// 403 re-reads /meta once. The inbox read is the home's single one, passed in (AC-14).
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AnalyticsCatalog } from '../api/analytics.ts';
import { request } from '../api/client.ts';
import type { useInbox } from '../api/inbox.ts';
import { keys } from '../api/queries.ts';
import { homeQueryRoot, SWITCH_SETTLE_MS, useHomeLayout, useHomeRead, useHomeRefresh } from '../api/role-home.ts';
import type { AppMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import type { NavigationCatalog } from '../lib/navigation.ts';
import { businessToday } from '../lib/operations.ts';
import {
  ATTENDANCE_DATASET,
  availableHomeLayouts,
  emptyViewLinks,
  HOME_ACTIONS,
  HOME_LAYOUT_LABELS,
  homeSwitcher,
  metaRecheckOnce,
  plannedHomeReads,
  visibleHomeCards,
  type HomeLayout,
} from '../lib/role-home.ts';
import { shiftMonday } from '../lib/shift.ts';
import { Button, EmptyState, TabPanel, Tabs } from '../ui/index.ts';
import { Icon } from './icon.tsx';
import { AccountingCards } from './role-home-accounting.tsx';
import { AdminHome } from './role-home-admin.tsx';
import { HomeCardProvider, useHomeCardEnv, type HomeCardEnv } from './role-home-card.tsx';
import { EmployeeHome } from './role-home-employee.tsx';
import { StoreCards } from './role-home-store.tsx';

type Inbox = ReturnType<typeof useInbox>;
const ID_PREFIX = 'home-view';

const VIEW_TITLES: Record<'accounting' | 'store' | 'employee', { ja: string; en: string }> = {
  accounting: { ja: '経理の今日', en: 'Accounting today' },
  store: { ja: '店舗・拠点の今日', en: 'Stores and sites today' },
  employee: { ja: '自分の仕事', en: 'Your work' },
};

/**
 * AC-15: the view heading with the manual refresh of its cards and the inbox (previous values stay meanwhile).
 * `beforeRefresh` lets the store view move "today" to the current business date first (a home left open overnight).
 */
function ViewHead({
  layout,
  inbox,
  beforeRefresh,
}: {
  layout: 'accounting' | 'store';
  inbox: Inbox;
  beforeRefresh?: () => void;
}) {
  const { t } = useLocale();
  const refreshCards = useHomeRefresh();
  const refreshing = useIsFetching({ queryKey: homeQueryRoot() }) > 0 || inbox.refreshing;
  return (
    <div className="role-home-view-head">
      <h2>{t(VIEW_TITLES[layout])}</h2>
      <Button
        size="sm"
        onClick={() => {
          beforeRefresh?.();
          void refreshCards();
          if (inbox.providers.length) inbox.refresh();
        }}
        disabled={refreshing}
        data-testid="home-refresh"
      >
        {refreshing ? t({ ja: '更新中…', en: 'Refreshing…' }) : t({ ja: '更新', en: 'Refresh' })}
      </Button>
    </div>
  );
}

/**
 * AC-19: no card can be shown in this view; point to its screens and to the tab with the business areas: 全体, or
 * 導入・管理 for a user who holds admin as well (they get no separate 全体 tab).
 */
function EmptyView({ layout, catalog }: { layout: HomeLayout; catalog: NavigationCatalog }) {
  const { t } = useLocale();
  const { available } = useHomeCardEnv();
  const links = emptyViewLinks(layout, catalog);
  const areas = available.includes('general') ? 'general' : available.includes('admin') ? 'admin' : undefined;
  const tab = areas ? HOME_LAYOUT_LABELS[areas] : undefined;
  return (
    <EmptyState
      testId="home-empty-view"
      title={t({ ja: 'このビューに表示できる情報がありません', en: 'Nothing can be shown in this view' })}
      description={t(
        tab
          ? {
              ja: `関係する画面で確認するか、「${tab.ja}」タブで業務分野を選んでください。`,
              en: `Check the related screens, or pick a business area on the ${tab.en} tab.`,
            }
          : { ja: '関係する画面で確認してください。', en: 'Check the related screens.' },
      )}
      action={
        links.length ? (
          <ul className="role-home-links">
            {links.map((link) => (
              <li key={link.href}>
                <Link to={link.href as never} className="role-home-link">
                  {t(link.label)}
                  <Icon name="arrow" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}

function AccountingView({ meta, inbox }: { meta: AppMeta; inbox: Inbox }) {
  const { catalog } = useHomeCardEnv();
  const cards = plannedHomeReads('accounting', meta);
  return (
    <>
      <ViewHead layout="accounting" inbox={inbox} />
      {cards.length ? <AccountingCards cards={cards} /> : <EmptyView layout="accounting" catalog={catalog} />}
    </>
  );
}

function StoreView({ meta, inbox }: { meta: AppMeta; inbox: Inbox }) {
  const { catalog, enabled } = useHomeCardEnv();
  // "Today" is fixed while the view is shown and moves on with "Refresh" (new keys then read the new day).
  const [today, setToday] = useState(() => businessToday());
  const planned = plannedHomeReads('store', meta);
  // The analytics catalog decides whether the attendance card exists (AC-10/AC-19), so it is read at the view level.
  const analytics = useHomeRead<AnalyticsCatalog>(
    ['analytics-catalog'],
    (signal) => request<AnalyticsCatalog>('/analytics/catalog', { signal, cache: 'no-store' }),
    enabled && planned.includes('attendance'),
  );
  const listed = analytics.isSuccess
    ? analytics.data.datasets.some((dataset) => dataset.id === ATTENDANCE_DATASET)
    : undefined;
  const cards = visibleHomeCards(planned, listed);
  const group = inbox.groups.find((item) => item.provider.action === HOME_ACTIONS.restaurantTodo);
  return (
    <>
      <ViewHead layout="store" inbox={inbox} beforeRefresh={() => setToday(businessToday())} />
      {cards.length ? (
        <StoreCards
          cards={cards}
          today={today}
          monday={shiftMonday(today)}
          catalog={analytics}
          missingGroup={group}
          retryInbox={inbox.retry}
        />
      ) : (
        <EmptyView layout="store" catalog={catalog} />
      )}
    </>
  );
}

function EmployeeView() {
  const { t } = useLocale();
  return (
    <>
      <div className="role-home-view-head">
        <h2>{t(VIEW_TITLES.employee)}</h2>
      </div>
      <EmployeeHome />
    </>
  );
}

function HomeView({
  layout,
  meta,
  inbox,
  general,
}: {
  layout: HomeLayout;
  meta: AppMeta;
  inbox: Inbox;
  general: ReactNode;
}) {
  return (
    <div className="role-home-view" data-testid="role-home-view" data-layout={layout}>
      {layout === 'accounting' ? <AccountingView meta={meta} inbox={inbox} /> : null}
      {layout === 'store' ? <StoreView meta={meta} inbox={inbox} /> : null}
      {layout === 'employee' ? <EmployeeView /> : null}
      {layout === 'admin' ? <AdminHome general={general} /> : null}
      {layout === 'general' ? general : null}
    </div>
  );
}

export function RoleHome({
  meta,
  catalog,
  tenantAdmin,
  accessScope,
  inbox,
  general,
}: {
  meta: AppMeta;
  catalog: NavigationCatalog;
  tenantAdmin: boolean;
  accessScope: unknown;
  inbox: Inbox;
  general: ReactNode;
}) {
  const { t } = useLocale();
  const available = useMemo(() => availableHomeLayouts(meta, catalog, tenantAdmin), [meta, catalog, tenantAdmin]);
  const { layout, select } = useHomeLayout(available);
  // AC-15: the first view reads at once; a view picked in the switcher reads once the choice holds for a moment.
  const [armed, setArmed] = useState(layout);
  useEffect(() => {
    if (armed === layout) return;
    const timer = setTimeout(() => setArmed(layout), SWITCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [armed, layout]);
  const [announcement, setAnnouncement] = useState('');
  const qc = useQueryClient();
  // AC-17: a 403 re-reads /meta once while the home is open; the views and cards are then decided again.
  const [onDenied] = useState(() => metaRecheckOnce(() => void qc.invalidateQueries({ queryKey: keys.meta })));
  const env = useMemo<HomeCardEnv>(
    () => ({
      enabled: armed === layout,
      catalog,
      available,
      accessScope: layout === 'store' ? accessScope : undefined,
      announce: setAnnouncement,
      onDenied,
    }),
    [armed, layout, catalog, available, accessScope, onDenied],
  );
  const view = <HomeView key={layout} layout={layout} meta={meta} inbox={inbox} general={general} />;
  const tabs = homeSwitcher(available);
  return (
    <HomeCardProvider value={env}>
      <p className="sr-only" aria-live="polite" data-testid="role-home-live">
        {announcement}
      </p>
      {tabs.length ? (
        <div className="role-home-switch">
          <Tabs
            items={tabs.map((id) => ({ id, label: t(HOME_LAYOUT_LABELS[id]) }))}
            selected={layout}
            onSelect={(id) => select(id as HomeLayout)}
            label={t({ ja: 'ホームの表示', en: 'Home view' })}
            idPrefix={ID_PREFIX}
          />
          {tabs.map((id) => (
            <TabPanel key={id} idPrefix={ID_PREFIX} id={id} selected={id === layout} className="role-home-panel">
              {id === layout ? view : null}
            </TabPanel>
          ))}
        </div>
      ) : (
        view
      )}
    </HomeCardProvider>
  );
}
