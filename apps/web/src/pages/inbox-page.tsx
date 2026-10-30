// /inbox (docs/specs/inbox.md AC-4..AC-9): every runnable provider as its own group with its items, or its failure and
// a retry that reloads that provider only. Refreshing is manual; the page never polls.
import { useState } from 'react';
import { useInbox } from '../api/inbox.ts';
import { InboxDropped, InboxFailure, InboxItemLink, countLabel } from '../components/inbox-card.tsx';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import type { InboxGroup } from '../lib/inbox.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { S } from '../strings.ts';
import { Badge, Button, Card, EmptyState, PageHeader, SkeletonCard } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

function GroupBody({ group, retry }: { group: InboxGroup; retry: (group: InboxGroup) => void }) {
  const { t } = useLocale();
  if (group.status === 'loading')
    return (
      <div aria-busy="true">
        <SkeletonCard lines={2} />
      </div>
    );
  if (group.status === 'error')
    return (
      <InboxFailure
        name={t(group.provider.label)}
        error={group.error}
        retrying={group.retrying === true}
        onRetry={() => retry(group)}
      />
    );
  if (!group.items.length)
    return group.dropped ? (
      <InboxDropped count={group.dropped} />
    ) : (
      <p className="inbox-none">{t({ ja: '処理待ちはありません。', en: 'Nothing is waiting here.' })}</p>
    );
  return (
    <>
      <ul className="inbox-list">
        {group.items.map((item) => (
          <li key={item.id}>
            <InboxItemLink item={item} />
          </li>
        ))}
      </ul>
      {group.dropped ? <InboxDropped count={group.dropped} /> : null}
    </>
  );
}

const headingId = (group: InboxGroup) => `inbox-${group.provider.module}`;

export function InboxPage() {
  const { t, locale } = useLocale();
  const { meta, providers, groups, summary, refreshing, refresh, retry } = useInbox();
  const [announcement, setAnnouncement] = useState('');
  // A retry that loads moves focus to the group's heading (the failure and its button are replaced by the items); a
  // retry that fails again keeps focus on the same retry button. Either way the result is announced politely.
  const retryGroup = (group: InboxGroup) => {
    const name = t(group.provider.label);
    setAnnouncement('');
    void retry(group.provider.action).then((ok) => {
      if (ok === undefined) return;
      setAnnouncement(
        ok
          ? t({ ja: `${name}: 取得しました`, en: `${name}: loaded` })
          : t({ ja: `${name}: 再試行しましたが取得できませんでした`, en: `${name}: still could not be loaded` }),
      );
      if (ok) requestAnimationFrame(() => document.getElementById(headingId(group))?.focus());
    });
  };
  if (meta.isError && !canRetainData(meta)) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  const busy = refreshing || summary.loading;
  return (
    <div className="workspace-page inbox-page" data-testid="inbox-page">
      <PageHeader
        eyebrow="TO-DO INBOX"
        title={t({ ja: 'やること', en: 'To-do inbox' })}
        subtitle={t({
          ja: '承認・確認・照合を待っている仕事です。件数は各業務の権限と担当範囲で数えています。',
          en: 'Work waiting for your approval, review or matching, counted within your role and assigned scope.',
        })}
        icon={
          <span className="inbox-page-icon" aria-hidden="true">
            <Icon name="check" size={24} />
          </span>
        }
        actions={
          providers.length ? (
            <Button onClick={refresh} disabled={refreshing} data-testid="inbox-refresh">
              {refreshing ? t({ ja: '更新中…', en: 'Refreshing…' }) : t({ ja: '最新の状態に更新', en: 'Refresh' })}
            </Button>
          ) : null
        }
      />
      <p className="sr-only" aria-live="polite" data-testid="inbox-live">
        {busy ? t(S.loading) : announcement}
      </p>
      {!providers.length ? (
        <EmptyState
          titleAs="h2"
          title={t({ ja: 'この会社で確認できる業務はありません', en: 'No inbox sources for this company' })}
          description={t({
            ja: '受信箱は、承認・確認の権限がある業務の件数を集めます。必要な場合は管理者に権限を確認してください。',
            en: 'The inbox collects counts from areas where you approve or review work. Ask an administrator if you need access.',
          })}
        />
      ) : (
        <>
          {summary.loaded ? (
            <p className="inbox-summary" data-testid="inbox-summary">
              {t({ ja: '合計', en: 'Total' })} <strong>{countLabel(summary.total, locale)}</strong>
              {summary.failed.length
                ? t({
                    ja: `（${summary.failed.length}業務は取得できませんでした）`,
                    en: ` (${summary.failed.length} source(s) could not be loaded)`,
                  })
                : null}
              {summary.loading ? t({ ja: '（取得中あり）', en: ' (some still loading)' }) : null}
            </p>
          ) : null}
          <div className="inbox-groups" aria-busy={refreshing || undefined}>
            {groups.map((group) => (
              <Card
                key={group.provider.action}
                className="inbox-group"
                aria-labelledby={headingId(group)}
                data-testid="inbox-group"
                data-provider={group.provider.action}
              >
                <div className="inbox-card-head">
                  <h2 id={headingId(group)} tabIndex={-1}>
                    {t(group.provider.label)}
                  </h2>
                  {group.status === 'ok' ? (
                    <Badge tone={group.total ? 'accent' : 'neutral'}>{countLabel(group.total, locale)}</Badge>
                  ) : null}
                </div>
                <GroupBody group={group} retry={retryGroup} />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
