// To-do inbox presentation shared by the home card and /inbox (docs/specs/inbox.md AC-4/AC-5/AC-9). Items link only
// to targets that lib/inbox.ts already resolved against the screen catalog; failures stay per provider.
import { Link } from '@tanstack/react-router';
import { useInbox } from '../api/inbox.ts';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import type { InboxItem } from '../lib/inbox.ts';
import { S } from '../strings.ts';
import { Badge, Button, buttonClass, Card, SkeletonCard } from '../ui/index.ts';
import { Icon } from './icon.tsx';
import '../inbox.css';

export function countLabel(count: number, locale: 'ja' | 'en'): string {
  return locale === 'ja' ? `${count.toLocaleString('ja-JP')}件` : `${count.toLocaleString('en-US')}`;
}

export function InboxItemLink({ item, source }: { item: InboxItem; source?: Label | undefined }) {
  const { t, locale } = useLocale();
  return (
    <Link
      to={item.target.pathname}
      search={item.target.search as never}
      className="inbox-item"
      data-testid="inbox-item"
      data-inbox-item={item.id}
    >
      <span className="inbox-item-text">
        <span className="inbox-item-label">{t(item.label)}</span>
        {source ? <small>{t(source)}</small> : null}
      </span>
      <Badge tone={item.severity === 'warn' ? 'warning' : 'accent'} data-testid="inbox-item-count">
        {countLabel(item.count, locale)}
      </Badge>
      <Icon name="arrow" size={16} />
    </Link>
  );
}

/** One provider could not be read: say so in plain words, keep the technical code, offer a retry for it alone. */
export function InboxFailure({ name, error, onRetry }: { name: string; error: unknown; onRetry: () => void }) {
  const { t } = useLocale();
  const view = describeError(error);
  return (
    <div className="ui-notice ui-notice-danger inbox-failure" data-testid="inbox-failure">
      <p className="inbox-failure-title">{t({ ja: '取得できませんでした', en: 'Could not be loaded' })}</p>
      {view.explanation ? <p className="ui-error-message">{t(view.explanation)}</p> : null}
      {view.code ? <p className="ui-error-message ui-code">{view.code}</p> : null}
      <Button size="sm" onClick={onRetry} aria-label={t({ ja: `${name}を再試行`, en: `Retry ${name}` })}>
        {t(S.retry)}
      </Button>
    </div>
  );
}

/** Home card: the total, the most urgent items, and a pointer to /inbox when a provider failed. */
export function InboxCard() {
  const { t, locale } = useLocale();
  const { providers, groups, summary } = useInbox();
  if (!providers.length) return null;
  const labels = new Map(groups.map((group) => [group.provider.action, group.provider.label]));
  const loadingOnly = summary.loading && !summary.top.length;
  return (
    <Card className="inbox-card" aria-labelledby="inbox-card-title" data-testid="inbox-card">
      <div className="inbox-card-head">
        <h2 id="inbox-card-title">
          <Icon name="check" size={18} />
          {t({ ja: 'やること', en: 'To-do' })}
        </h2>
        {summary.loading ? null : (
          <Badge tone={summary.total ? 'accent' : 'neutral'} data-testid="inbox-total">
            {t({ ja: '合計', en: 'Total' })} {countLabel(summary.total, locale)}
          </Badge>
        )}
        <Link to="/inbox" className={buttonClass('ghost', 'sm', 'inbox-card-all')}>
          {t({ ja: 'すべて見る', en: 'View all' })}
          <Icon name="arrow" size={14} />
        </Link>
      </div>
      {loadingOnly ? (
        <>
          <p className="sr-only" aria-live="polite">
            {t(S.loading)}
          </p>
          <div aria-busy="true">
            <SkeletonCard lines={3} />
          </div>
        </>
      ) : null}
      {summary.top.length ? (
        <ul className="inbox-list">
          {summary.top.map((item) => (
            <li key={item.id}>
              <InboxItemLink item={item} source={labels.get(item.provider)} />
            </li>
          ))}
        </ul>
      ) : null}
      {!summary.loading && !summary.total && !summary.failed.length ? (
        <p className="inbox-none">
          {t({ ja: '処理を待っている仕事はありません。', en: 'Nothing is waiting for you.' })}
        </p>
      ) : null}
      {summary.failed.length ? (
        <p className="inbox-card-failed" data-testid="inbox-card-failed">
          {t({
            ja: `${summary.failed.map((provider) => provider.label.ja).join('・')}の件数を取得できませんでした。`,
            en: `Counts from ${summary.failed.map((provider) => provider.label.en).join(', ')} could not be loaded.`,
          })}{' '}
          <Link to="/inbox" className="ui-link">
            {t({ ja: '受信箱で再試行', en: 'Retry in the inbox' })}
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
