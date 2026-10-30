// web-phase1 AC-5 / settings-console AC-8..AC-14: /settings — company settings declared by modules (GET /meta/settings),
// one kit Tab per category that has settings (selected tab kept in `?tab=`), cards ordered by `order` then label.
// Admin or the `settings` role only (the API enforces the same). Each card is a SettingCard.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { canEditSettings, useSettings } from '../api/settings.ts';
import type { AppMeta } from '../api/types.ts';
import { SettingCard } from '../components/setting-card.tsx';
import { useLocale } from '../i18n.tsx';
import { resolveTab, SC, settingsInTab, settingTabs } from '../lib/settings-console.ts';
import { S } from '../strings.ts';
import { EmptyState, PageHeader, TabPanel, Tabs } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';
import { useMeta } from '../api/queries.ts';

const TAB_PREFIX = 'settings';

/** `?tab=` of /settings (router validateSearch); anything else is dropped. */
export function parseSettingsSearch(raw: Record<string, unknown>): { tab?: string } {
  return typeof raw.tab === 'string' && /^[a-z][a-z0-9_-]{0,40}$/.test(raw.tab) ? { tab: raw.tab } : {};
}

function SettingsView({ meta }: { meta: AppMeta }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const search = parseSettingsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const allowed = canEditSettings(meta.roles);
  const settings = useSettings(allowed);
  if (!allowed) {
    return (
      <div role="alert" className="ui-notice ui-notice-warning m-4">
        {t(S.settingsForbidden)}
      </div>
    );
  }
  if (settings.isError) return <MetaError error={settings.error} retry={() => void settings.refetch()} />;
  if (settings.isPending) return <LoadingView />;
  const tabs = settingTabs(settings.data);
  const selected = resolveTab(search.tab, tabs);
  if (!selected) return <EmptyState title={t(S.settingsEmpty)} />;
  const select = (tab: string) => void navigate({ to: '/settings', search: { tab }, replace: true });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Tabs
        idPrefix={TAB_PREFIX}
        label={t(SC.tabs)}
        selected={selected}
        onSelect={select}
        items={tabs.map((tab) => ({ id: tab.id, label: t(tab.label) }))}
      />
      {tabs.map((tab) => (
        <TabPanel key={tab.id} idPrefix={TAB_PREFIX} id={tab.id} selected={tab.id === selected}>
          <div className="flex min-w-0 flex-col gap-3">
            {settingsInTab(settings.data, tab.id, locale).map((s) => (
              <SettingCard key={s.key} setting={s} meta={meta} />
            ))}
          </div>
        </TabPanel>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (meta.isPending) return <LoadingView />;
  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <PageHeader title={t(S.settings)} subtitle={t(SC.subtitle)} />
      <SettingsView meta={meta.data} />
    </div>
  );
}
