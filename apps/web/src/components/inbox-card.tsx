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
import { ErrorDetails } from './error-details.tsx';
import { Icon } from './icon.tsx';
import '../inbox.css';

export function countLabel(count: number, locale: 'ja' | 'en'): string {
  return locale === 'ja' ? `${count.toLocaleString('ja-JP')}件` : `${count.toLocaleString('en-US')}`;
}

/** Visible marker and wording of an urgent (`warn`) item, so urgency is not carried by colour alone. */
const URGENT: Label = { ja: '急ぎ', en: 'Urgent' };

export function InboxItemLink({ item, source }: { item: InboxItem; source?: Label | undefined }) {
  const { t, locale } = useLocale();
  const urgent = item.severity === 'warn';
  return (
    <Link
      to={item.target.pathname}
      search={item.target.search as never}
      className="inbox-item"
      data-testid="inbox-item"
      data-inbox-item={item.id}
      data-severity={item.severity}
    >
      <span className="inbox-item-text">
        <span className="inbox-item-label">{t(item.label)}</span>
        {/* Hidden punctuation keeps the label, the business area and the count apart in the link's spoken name. */}
        {source ? (
          <small>
            <span className="sr-only">（</span>
            {t(source)}
            <span className="sr-only">）</span>
          </small>
        ) : (
          <span className="sr-only">：</span>
        )}
      </span>
      <Badge tone={urgent ? 'warning' : 'accent'} data-testid="inbox-item-count">
        {urgent ? <span className="inbox-urgent">{t(URGENT)}</span> : null}
        {countLabel(item.count, locale)}
      </Badge>
      <Icon name="arrow" size={16} />
    </Link>
  );
}

/** Note shown instead of "nothing waiting" when items came back but none has a screen this user can open. */
export function InboxDropped({ count }: { count: number }) {
  const { t } = useLocale();
  return (
    <p className="inbox-dropped" data-testid="inbox-dropped">
      {t({
        ja: `開ける画面がない項目が ${count} 件あります（権限を管理者に確認してください）。`,
        en: `${count} item(s) have no screen you can open (ask an administrator to check your access).`,
      })}
    </p>
  );
}

/**
 * One provider could not be read: say so in plain words, then the server message, with the code, HTTP status and hint
 * in closed technical details, and a retry for that provider alone. While the retry runs the button stays mounted
 * (aria-disabled), so keyboard focus is not lost.
 */
export function InboxFailure({
  name,
  error,
  onRetry,
  retrying = false,
}: {
  name: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { t } = useLocale();
  const view = describeError(error);
  return (
    <div className="ui-notice ui-notice-danger inbox-failure" data-testid="inbox-failure">
      <p className="inbox-failure-title">{t({ ja: '取得できませんでした', en: 'Could not be loaded' })}</p>
      {view.explanation ? <p className="ui-error-message">{t(view.explanation)}</p> : null}
      {view.message ? <p className="ui-error-message">{view.message}</p> : null}
      <ErrorDetails view={view} />
      <Button
        size="sm"
        onClick={() => {
          if (!retrying) onRetry();
        }}
        aria-disabled={retrying || undefined}
        aria-label={
          retrying
            ? t({ ja: `${name}を再試行中`, en: `Retrying ${name}` })
            : t({ ja: `${name}を再試行`, en: `Retry ${name}` })
        }
      >
        {retrying ? t({ ja: '再試行中…', en: 'Retrying…' }) : t(S.retry)}
      </Button>
    </div>
  );
}

/** What the home card needs of one `useInbox()` read; the home passes its single read (role-home AC-14). */
export type InboxCardState = Pick<ReturnType<typeof useInbox>, 'providers' | 'groups' | 'summary'>;

/** Home card: the total, the most urgent items, and a pointer to /inbox when a provider failed. */
export function InboxCard() {
  return <InboxCardView inbox={useInbox()} />;
}

/**
 * The home card drawn from a read made elsewhere. The role-based home calls `useInbox()` once and shares the result
 * with this card, the store view's missing-report card and its Refresh button, so no second observer reads again.
 */
export function InboxCardView({ inbox }: { inbox: InboxCardState }) {
  const { t, locale } = useLocale();
  const { providers, groups, summary } = inbox;
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
        summary.dropped ? (
          <InboxDropped count={summary.dropped} />
        ) : (
          <p className="inbox-none">
            {t({ ja: '処理を待っている仕事はありません。', en: 'Nothing is waiting for you.' })}
          </p>
        )
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
