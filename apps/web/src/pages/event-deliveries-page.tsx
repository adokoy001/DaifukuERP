// /admin/event-deliveries (docs/specs/event-delivery.md AC-25, AC-27), built with the UI kit: whether this API process
// runs the worker, the company's webhook endpoints with the state of each signing secret (issue / reissue after a kit
// Dialog confirmation, the new secret shown once in its own Dialog), and the deliveries by status in kit Tabs (kept in
// `?status=`) with a resend for failed rows. The issued secret lives only in this component's state: closing the Dialog
// drops it, and nothing writes it to the URL, storage, toasts or the console.
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { isApiError } from '../api/client.ts';
import { useDeliveries, useIssueSecret, useRetryDelivery, useWebhooks } from '../api/event-deliveries.ts';
import { useMeta } from '../api/queries.ts';
import { Icon } from '../components/icon.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import {
  DELIVERY_TABS,
  errorText,
  isCompanyAdmin,
  KIND_TEXT,
  SECRET_TONE,
  secretStateText,
  selectedTab,
  STATUS_TEXT,
  STATUS_TONE,
  tabLabel,
  TAB_TEXT,
  targetText,
  type DeliveryItem,
  type DeliveryTab,
  type IssuedSecret,
  type WebhookEndpointView,
} from '../lib/event-deliveries.ts';
import { formatTimestamp } from '../lib/format.ts';
import { S } from '../strings.ts';
import {
  Badge,
  Button,
  Card,
  DataTableShell,
  Dialog,
  EmptyState,
  FormSection,
  PageHeader,
  SkeletonCard,
  TabPanel,
  Tabs,
} from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const TABS_ID = 'deliveries';

function Forbidden() {
  const { t } = useLocale();
  return (
    <div className="workspace-page">
      <EmptyState
        titleAs="h1"
        testId="deliveries-forbidden"
        title={t({ ja: 'イベント配送を開く権限がありません', en: 'You cannot open event deliveries' })}
        description={t({
          ja: '会社の管理者（admin）の役割と、店舗・拠点に限定されない会社全体への所属が必要です。必要なら管理者に依頼してください。',
          en: 'The admin role of the company with company-wide access (not limited to stores or sites) is required. Ask your administrator if you need it.',
        })}
      />
    </div>
  );
}

function IssueConfirm({
  endpoint,
  busy,
  onConfirm,
  onClose,
}: {
  endpoint: WebhookEndpointView;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const reissue = endpoint.secret.state !== 'none';
  return (
    <Dialog
      title={
        reissue
          ? t({
              ja: `「${endpoint.label}」の署名鍵を再発行しますか？`,
              en: `Reissue the signing secret of “${endpoint.label}”?`,
            })
          : t({
              ja: `「${endpoint.label}」の署名鍵を発行しますか？`,
              en: `Issue a signing secret for “${endpoint.label}”?`,
            })
      }
      description={
        reissue
          ? t({
              ja: '新しい鍵を発行すると、これまでの鍵では署名を検証できなくなります。受信側の設定を新しい鍵に替えてください。',
              en: 'After a new secret is issued, signatures can no longer be verified with the old one. Update the receiver to the new secret.',
            })
          : t({
              ja: '発行すると、この送信先へイベントの送信を始めます（発行より前に起きたイベントは送りません）。鍵は 1 度だけ表示されます。',
              en: 'Issuing starts sending events to this destination (events from before the issue are not sent). The secret is shown only once.',
            })
      }
      onClose={onClose}
      closeLabel={t(S.close)}
      actions={
        <>
          <Button variant="default" onClick={onClose} data-autofocus>
            {t({ ja: '戻る', en: 'Go back' })}
          </Button>
          <Button onClick={onConfirm} disabled={busy} data-testid="secret-confirm">
            {busy
              ? t({ ja: '発行中…', en: 'Issuing…' })
              : reissue
                ? t({ ja: '再発行する', en: 'Reissue' })
                : t({ ja: '発行する', en: 'Issue' })}
          </Button>
        </>
      }
    />
  );
}

function SecretDialog({ issued, label, onClose }: { issued: IssuedSecret; label: string; onClose: () => void }) {
  const { t } = useLocale();
  const field = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try {
      if (!globalThis.navigator?.clipboard) throw new Error('no clipboard');
      await globalThis.navigator.clipboard.writeText(issued.secret);
      setCopied(t({ ja: 'コピーしました。', en: 'Copied.' }));
    } catch {
      field.current?.select();
      setCopied(
        t({
          ja: 'クリップボードを使えません。鍵を選択したので Ctrl+C（Mac は ⌘+C）でコピーしてください。',
          en: 'The clipboard is not available. The secret is selected: press Ctrl+C (⌘+C on a Mac) to copy it.',
        }),
      );
    }
  };
  return (
    <Dialog
      title={t({ ja: `「${label}」の署名鍵`, en: `Signing secret of “${label}”` })}
      description={t({
        ja: '閉じると再表示できません。いま受信側に設定してください。鍵はこの画面・URL・ブラウザに保存されません。',
        en: 'It cannot be shown again after you close this. Set it on the receiver now. The secret is not stored in this screen, the URL or the browser.',
      })}
      onClose={onClose}
      closeLabel={t(S.close)}
      actions={
        <Button onClick={onClose} data-testid="secret-close">
          {t({ ja: '設定したので閉じる', en: 'Done, close' })}
        </Button>
      }
    >
      <label htmlFor={inputId} className="text-sm font-semibold text-text-secondary">
        {t({ ja: '署名鍵', en: 'Signing secret' })}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={field}
          id={inputId}
          className="input min-w-0 flex-1 font-mono text-xs"
          value={issued.secret}
          readOnly
          autoComplete="off"
          spellCheck={false}
          data-testid="secret-value"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button variant="default" onClick={() => void copy()} data-autofocus data-testid="secret-copy">
          {t({ ja: 'コピー', en: 'Copy' })}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-text-secondary" data-testid="secret-copy-status">
        {copied}
      </p>
    </Dialog>
  );
}

function EndpointCard({
  endpoint,
  secretsAvailable,
  onIssue,
}: {
  endpoint: WebhookEndpointView;
  secretsAvailable: boolean;
  onIssue: () => void;
}) {
  const { t, locale } = useLocale();
  const reasonId = useId();
  const state = secretStateText(endpoint.secret, (iso) => formatTimestamp(iso, locale));
  return (
    <li
      className="flex flex-col gap-2 border-b border-border-subtle py-3 last:border-b-0"
      data-testid={`endpoint-${endpoint.id}`}
      data-secret={endpoint.secret.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text">{endpoint.label}</span>
        <Badge tone={endpoint.enabled ? 'success' : 'neutral'}>
          {endpoint.enabled ? t({ ja: '有効', en: 'Enabled' }) : t({ ja: '無効', en: 'Disabled' })}
        </Badge>
        <Badge tone={SECRET_TONE[endpoint.secret.state]} data-testid="endpoint-secret-state">
          {t(state)}
        </Badge>
      </div>
      <span className="break-all font-mono text-xs text-text-secondary">{endpoint.url}</span>
      <ul className="flex flex-wrap gap-1" aria-label={t({ ja: '購読する topic', en: 'Subscribed topics' })}>
        {endpoint.topics.map((topic) => (
          <li key={topic}>
            <code className="ui-badge ui-badge-neutral">{topic}</code>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={endpoint.secret.state === 'active' ? 'default' : 'primary'}
          onClick={onIssue}
          disabled={!secretsAvailable}
          aria-describedby={secretsAvailable ? undefined : reasonId}
          data-testid={`issue-${endpoint.id}`}
        >
          {endpoint.secret.state === 'none'
            ? t({ ja: '署名鍵を発行', en: 'Issue secret' })
            : t({ ja: '署名鍵を再発行', en: 'Reissue secret' })}
        </Button>
        {secretsAvailable ? null : (
          <span id={reasonId} className="text-sm text-text-secondary" data-testid="issue-unavailable">
            {t({
              ja: 'このサーバーには認証設定の暗号鍵（IDENTITY_ENCRYPTION_KEY）が無いため発行できません。',
              en: 'This server has no identity encryption key (IDENTITY_ENCRYPTION_KEY), so secrets cannot be issued.',
            })}
          </span>
        )}
      </div>
    </li>
  );
}

function DeliveryRow({
  item,
  busy,
  onRetry,
}: {
  item: DeliveryItem;
  busy: boolean;
  onRetry: (item: DeliveryItem) => void;
}) {
  const { t, locale } = useLocale();
  const error = errorText(item);
  return (
    <tr data-testid="delivery-row" data-id={item.id} data-status={item.status}>
      <td>
        <Badge tone={STATUS_TONE[item.status]}>{t(STATUS_TEXT[item.status])}</Badge>
      </td>
      <td>{t(KIND_TEXT[item.kind])}</td>
      <td>{t(targetText(item))}</td>
      <td>
        <code className="text-xs">{item.topic}</code>
      </td>
      <td className="whitespace-nowrap">{formatTimestamp(item.createdAt, locale)}</td>
      <td className="ui-cell-num">{item.attempts}</td>
      <td className="min-w-48" data-testid="delivery-error">
        {error ? t(error) : '—'}
      </td>
      <td className="whitespace-nowrap">{item.nextAttemptAt ? formatTimestamp(item.nextAttemptAt, locale) : '—'}</td>
      <td>
        {item.status === 'dead' ? (
          <Button
            size="sm"
            variant="default"
            onClick={() => onRetry(item)}
            disabled={busy}
            aria-label={t({ ja: `再送: ${item.topic}`, en: `Resend: ${item.topic}` })}
            data-testid="delivery-retry"
          >
            {t({ ja: '再送', en: 'Resend' })}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

const EMPTY_TEXT: Record<DeliveryTab, { ja: string; en: string }> = {
  dead: { ja: '配送に失敗したものはありません。', en: 'No failed deliveries.' },
  pending: { ja: '送信待ちはありません。', en: 'Nothing is waiting to be sent.' },
  cancelled: {
    ja: '取り消した配送はありません（30 日で削除）。',
    en: 'No cancelled deliveries (removed after 30 days).',
  },
  delivered: { ja: '送信済みはありません（30 日で削除）。', en: 'No delivered rows (removed after 30 days).' },
};

function DeliveriesPanel({ tab }: { tab: DeliveryTab }) {
  const { t } = useLocale();
  const toast = useToast();
  const deliveries = useDeliveries(tab, true);
  const retry = useRetryDelivery();
  const panel = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const items = deliveries.data?.pages.flatMap((page) => page.items) ?? [];
  const onRetry = (item: DeliveryItem) => {
    setAnnouncement('');
    retry.mutate(item.id, {
      onSuccess: () => {
        const message = t({
          ja: '再送を予約しました。「送信待ち」に移りました。',
          en: 'Resend scheduled. The row moved to “Waiting”.',
        });
        toast.success(message);
        setAnnouncement(message);
        // The resent row leaves this list: keep focus in the panel instead of losing it to <body>.
        requestAnimationFrame(() => panel.current?.focus());
      },
      onError: (error) => toast.error(error, t({ ja: '再送できませんでした', en: 'Could not resend' })),
    });
  };
  if (deliveries.isError && !deliveries.data)
    return <MetaError error={deliveries.error} retry={() => void deliveries.refetch()} />;
  return (
    <div ref={panel} tabIndex={-1} className="flex flex-col gap-3 outline-none" data-testid={`deliveries-${tab}`}>
      <p className="sr-only" aria-live="polite" data-testid="deliveries-live">
        {announcement}
      </p>
      <DataTableShell
        label={t({ ja: `配送（${TAB_TEXT[tab].ja}）`, en: `Deliveries (${TAB_TEXT[tab].en})` })}
        columnCount={9}
        skeleton={!deliveries.data}
        loadingLabel={t(S.loading)}
        busy={deliveries.isFetching}
        isEmpty={items.length === 0}
        empty={<EmptyState title={t(EMPTY_TEXT[tab])} testId="deliveries-empty" />}
        testId="deliveries-table"
        frameFocusable={!items.some((item) => item.status === 'dead')}
        head={
          <tr>
            <th scope="col">{t({ ja: '状態', en: 'Status' })}</th>
            <th scope="col">{t({ ja: '種別', en: 'Kind' })}</th>
            <th scope="col">{t({ ja: '送信先・宛先', en: 'Destination' })}</th>
            <th scope="col">topic</th>
            <th scope="col">{t({ ja: '作成日時', en: 'Created' })}</th>
            <th scope="col" className="ui-cell-num">
              {t({ ja: '試行', en: 'Attempts' })}
            </th>
            <th scope="col">{t({ ja: '最終エラー', en: 'Last error' })}</th>
            <th scope="col">{t({ ja: '次の試行', en: 'Next attempt' })}</th>
            <th scope="col">
              <span className="sr-only">{t({ ja: '操作', en: 'Actions' })}</span>
            </th>
          </tr>
        }
      >
        {items.map((item) => (
          <DeliveryRow key={item.id} item={item} busy={retry.isPending} onRetry={onRetry} />
        ))}
      </DataTableShell>
      {deliveries.hasNextPage ? (
        <div>
          <Button
            variant="default"
            onClick={() => void deliveries.fetchNextPage()}
            disabled={deliveries.isFetchingNextPage}
            data-testid="deliveries-more"
          >
            {t({ ja: 'さらに表示', en: 'Show more' })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function EventDeliveriesPage() {
  const { t } = useLocale();
  const search = useSearch({ from: '/app/admin/event-deliveries' });
  const navigate = useNavigate();
  const toast = useToast();
  const meta = useMeta();
  const allowed = isCompanyAdmin(meta.data?.roles);
  const webhooks = useWebhooks(allowed);
  const counts = useDeliveries(selectedTab(search), allowed).data?.pages[0]?.counts;
  const issue = useIssueSecret();
  const [confirming, setConfirming] = useState<WebhookEndpointView | null>(null);
  const [issued, setIssued] = useState<{ secret: IssuedSecret; label: string } | null>(null);
  const tab = selectedTab(search);
  if (meta.isError && !meta.data) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  // AC-27: the navigation shows this screen to admins only; a direct URL explains instead of failing. A store- or
  // site-scoped admin has the role, but the API refuses (403): the same explanation.
  const refused = webhooks.isError && isApiError(webhooks.error) && webhooks.error.status === 403;
  if (!allowed || refused) return <Forbidden />;
  const select = (next: string) =>
    void navigate({ to: '/admin/event-deliveries', search: { status: next as DeliveryTab }, replace: true });
  const confirmIssue = () => {
    const endpoint = confirming;
    if (!endpoint) return;
    issue.mutate(endpoint.id, {
      onSuccess: (secret) => {
        setConfirming(null);
        setIssued({ secret, label: endpoint.label });
      },
      onError: (error) => {
        setConfirming(null);
        toast.error(error, t({ ja: '署名鍵を発行できませんでした', en: 'Could not issue the secret' }));
      },
    });
  };
  const view = webhooks.data;
  return (
    <div className="workspace-page flex flex-col gap-4" data-testid="event-deliveries-page">
      <PageHeader
        eyebrow="EVENT DELIVERY"
        title={t({ ja: 'イベント配送', en: 'Event deliveries' })}
        subtitle={t({
          ja: '確定した伝票などの業務イベントを外部の送信先（Webhook）と受信箱のメール通知へ配送します。失敗したものは原因を直してから再送してください。',
          en: 'Delivers business events such as submitted documents to external destinations (webhooks) and inbox mail. Fix the cause of a failure, then resend it.',
        })}
        icon={<Icon name="arrow" size={24} />}
      />
      {view && !view.worker.enabledHere ? (
        <div className="ui-notice ui-notice-info text-sm" data-testid="worker-disabled">
          <p className="font-semibold">
            {t({
              ja: 'この API サーバーでは配送 worker が動いていません。',
              en: 'The delivery worker is not running on this API server.',
            })}
          </p>
          <p>
            {t({
              ja: '運用者が EVENT_WORKER_ENABLED=true で起動するか、スケジューラで events:deliver を実行するまで、イベントは送信待ちのまま溜まります（別のサーバーで動いている場合もあります）。',
              en: 'Until an operator starts it with EVENT_WORKER_ENABLED=true or runs events:deliver from a scheduler, events wait here (another server may be running it).',
            })}
          </p>
        </div>
      ) : null}
      <Card>
        <FormSection
          landmark
          title={t({ ja: '送信先（Webhook）', en: 'Destinations (webhooks)' })}
          description={t({
            ja: '送信先の追加・変更は会社設定の「外部連携」タブで行います。署名鍵の発行はここで管理者が行い、発行より前のイベントは送りません。',
            en: 'Add or change destinations on the Integrations tab of the company settings. An administrator issues each signing secret here; events from before the issue are not sent.',
          })}
        >
          <Link
            to="/settings"
            search={{ tab: 'integration' }}
            className="ui-link self-start text-sm"
            data-testid="endpoints-settings-link"
          >
            {t({ ja: '会社設定の「外部連携」を開く', en: 'Open the Integrations settings' })}
          </Link>
          {webhooks.isError && !view ? (
            <MetaError error={webhooks.error} retry={() => void webhooks.refetch()} />
          ) : !view ? (
            <div aria-busy="true">
              <SkeletonCard lines={3} />
            </div>
          ) : view.endpoints.length === 0 ? (
            <EmptyState
              testId="endpoints-empty"
              title={t({ ja: '送信先はまだありません', en: 'No destinations yet' })}
              description={t({
                ja: '会社設定の「外部連携」で送信先（URL と topic）を登録してから、ここで署名鍵を発行します。',
                en: 'Register a destination (URL and topics) on the Integrations settings tab, then issue its signing secret here.',
              })}
            />
          ) : (
            <ul className="flex flex-col" data-testid="endpoints">
              {view.endpoints.map((endpoint) => (
                <EndpointCard
                  key={endpoint.id}
                  endpoint={endpoint}
                  secretsAvailable={view.secretsAvailable}
                  onIssue={() => setConfirming(endpoint)}
                />
              ))}
            </ul>
          )}
        </FormSection>
      </Card>
      <Card>
        <FormSection
          title={t({ ja: '配送の状況', en: 'Deliveries' })}
          description={t({
            ja: '失敗は 8 回の試行（約 2 時間）の後に止まった配送です。送信済みと取消は 30 日後に削除します。',
            en: 'Failed rows stopped after 8 attempts (about 2 hours). Delivered and cancelled rows are removed after 30 days.',
          })}
        >
          <Tabs
            idPrefix={TABS_ID}
            label={t({ ja: '配送の状態', en: 'Delivery status' })}
            selected={tab}
            onSelect={select}
            items={DELIVERY_TABS.map((id) => ({ id, label: t(tabLabel(id, counts)) }))}
          />
          {DELIVERY_TABS.map((id) => (
            <TabPanel key={id} idPrefix={TABS_ID} id={id} selected={id === tab}>
              <DeliveriesPanel tab={id} />
            </TabPanel>
          ))}
        </FormSection>
      </Card>
      {confirming ? (
        <IssueConfirm
          endpoint={confirming}
          busy={issue.isPending}
          onConfirm={confirmIssue}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {issued ? (
        <SecretDialog
          issued={issued.secret}
          label={issued.label}
          onClose={() => {
            setIssued(null);
            issue.reset();
          }}
        />
      ) : null}
    </div>
  );
}
