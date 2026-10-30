// /admin/health (docs/specs/setup-health.md AC-9, AC-10), built with the UI kit: the setup health items of the current
// company ordered fail, warn, ok, each status as a coloured badge with a word, a link to the screen that fixes it, and
// "Check again". It only reads GET /meta/health; fixing happens on the linked screens.
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { isApiError } from '../api/client.ts';
import { useHealth } from '../api/health.ts';
import { useMeta } from '../api/queries.ts';
import { canEditSettings } from '../api/settings.ts';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { formatTimestamp } from '../lib/format.ts';
import { helpUrl, manualBaseUrl } from '../lib/help.ts';
import {
  healthLink,
  linkText,
  sortHealthItems,
  STATUS_TEXT,
  STATUS_TONE,
  summaryText,
  type HealthItem,
} from '../lib/health.ts';
import { S } from '../strings.ts';
import { Badge, Button, buttonClass, Card, EmptyState, FormSection, PageHeader, SkeletonCard } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const MANUAL_BASE = manualBaseUrl(import.meta.env.VITE_MANUAL_URL);

function HealthRow({ item }: { item: HealthItem }) {
  const { t } = useLocale();
  const target = healthLink(item.href);
  return (
    <li
      data-testid={`health-item-${item.id}`}
      data-status={item.status}
      className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border-subtle py-3 last:border-b-0"
    >
      <Badge tone={STATUS_TONE[item.status]} className="min-w-16 shrink-0 justify-center" data-testid="health-status">
        {t(STATUS_TEXT[item.status])}
      </Badge>
      <span className="min-w-0 flex-1 basis-56">
        <span className="block text-sm font-semibold text-text">{t(item.label)}</span>
        <span className="block text-sm text-text-secondary">{t(item.detail)}</span>
      </span>
      {target ? (
        <Link
          to={target.to}
          search={target.search}
          className="ui-link"
          aria-label={t({
            ja: `${linkText(item.status).ja}（${item.label.ja}）`,
            en: `${linkText(item.status).en} (${item.label.en})`,
          })}
        >
          {t(linkText(item.status))}
        </Link>
      ) : null}
    </li>
  );
}

export function HealthPage() {
  const { t, locale } = useLocale();
  const meta = useMeta();
  const allowed = canEditSettings(meta.data?.roles);
  const health = useHealth(allowed);
  const [announcement, setAnnouncement] = useState('');
  if (!meta.data) return <LoadingView />;
  // AC-10: the navigation hides the screen; a direct URL explains instead of failing. A store- or site-scoped
  // membership has the role but the API refuses it (403): the same explanation.
  const refused = health.isError && isApiError(health.error) && health.error.status === 403;
  if (!allowed || refused)
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          testId="health-forbidden"
          title={t({ ja: '導入チェックを開く権限がありません', en: 'You cannot open the setup check' })}
          description={t({
            ja: '管理者か設定管理（settings）の役割と、店舗・拠点に限定されない会社全体への所属が必要です。必要なら管理者に依頼してください。',
            en: 'The admin or settings role with company-wide access (not limited to stores or sites) is required. Ask your administrator if you need it.',
          })}
        />
      </div>
    );
  if (health.isError && !health.data) return <MetaError error={health.error} retry={() => void health.refetch()} />;
  const items = health.data ? sortHealthItems(health.data.items) : [];
  const recheck = () => {
    setAnnouncement('');
    void health.refetch().then((result) => {
      if (result.data) setAnnouncement(t(summaryText(result.data.items)));
    });
  };
  return (
    <div className="workspace-page flex flex-col gap-4" data-testid="health-page">
      <PageHeader
        eyebrow="SETUP CHECK"
        title={t({ ja: '導入チェック', en: 'Setup check' })}
        subtitle={t({
          ja: 'この会社の設定と運用状態を点検します。要対応・注意の項目は、リンク先の画面で直してから再点検してください。',
          en: 'Checks the settings and operating state of this company. Fix items that need action on the linked screens, then check again.',
        })}
        icon={<Icon name="check" size={24} />}
        actions={
          <Button onClick={recheck} disabled={health.isFetching} data-testid="health-recheck">
            {health.isFetching ? t({ ja: '点検中…', en: 'Checking…' }) : t({ ja: '再点検', en: 'Check again' })}
          </Button>
        }
      />
      <p className="sr-only" aria-live="polite" data-testid="health-live">
        {health.isFetching ? t(S.loading) : announcement}
      </p>
      <Card>
        <FormSection
          landmark
          title={t({ ja: '点検結果', en: 'Results' })}
          description={
            health.data
              ? `${t(summaryText(health.data.items))} ／ ${t({ ja: '点検日時', en: 'Checked at' })} ${formatTimestamp(health.data.checkedAt, locale)}`
              : undefined
          }
        >
          {health.data ? (
            <ul className="flex flex-col" data-testid="health-items" aria-busy={health.isFetching || undefined}>
              {items.map((item) => (
                <HealthRow key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <div aria-busy="true">
              <SkeletonCard lines={4} />
            </div>
          )}
        </FormSection>
      </Card>
      <Card>
        <FormSection
          title={t({ ja: 'バックアップ', en: 'Backups' })}
          description={t({
            ja: 'バックアップの最終時刻は画面では点検しません。運用者が導入・更新の手順でバックアップと別 DB への復元確認を行ってください。',
            en: 'This screen does not check the time of the last backup. Operators back up and verify a restore to a separate database as part of setup and upgrades.',
          })}
        >
          <a
            className={buttonClass('ghost', 'sm')}
            href={helpUrl({ chapter: '08-admin.md', section: '添付とバックアップ' }, MANUAL_BASE)}
            hrefLang="ja"
            target="_blank"
            rel="noreferrer"
          >
            {t({ ja: 'マニュアル: 添付とバックアップ', en: 'Manual: attachments and backups (Japanese)' })}
          </a>
        </FormSection>
      </Card>
    </div>
  );
}
