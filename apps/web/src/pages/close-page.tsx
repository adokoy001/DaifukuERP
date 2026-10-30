// /finance/close — the month-end close guide (docs/specs/close-guide.md AC-8..AC-13), built with the UI kit.
// It only orders existing operations: accounting.close_readiness counts what is left (through the caller's
// permissions), the links open the lists and reports, and closing / reopening call the existing
// accounting.close_period / reopen_period after a kit Dialog confirmation. No new read or write path.
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { fetchCloseReadiness, useClosePeriods, useCloseReadiness } from '../api/close.ts';
import { financeIdentity, useFinanceCommand } from '../api/finance.ts';
import { useMeta } from '../api/queries.ts';
import type { AppMeta, Label } from '../api/types.ts';
import { Icon } from '../components/icon.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import {
  blockingSummary,
  CLOSE_PERIOD_ACTION,
  CLOSE_READINESS_ACTION,
  closeState,
  countText,
  groupItems,
  itemScope,
  periodOption,
  periodRange,
  REOPEN_PERIOD_ACTION,
  splitHref,
  type CloseItem,
  type CloseReadiness,
  type CloseState,
} from '../lib/close-guide.ts';
import { S } from '../strings.ts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  Dialog,
  EmptyState,
  FormSection,
  PageHeader,
  SkeletonCard,
} from '../ui/index.ts';
import type { BadgeTone } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const TITLE: Label = { ja: '月次締め', en: 'Month-end close' };
const STATE_BADGE: Record<CloseState, { tone: BadgeTone; label: Label }> = {
  closed: { tone: 'success', label: { ja: '締め済み', en: 'Closed' } },
  ready: { tone: 'accent', label: { ja: '締められます', en: 'Ready to close' } },
  blocked: { tone: 'danger', label: { ja: '締める前の作業があります', en: 'Work left before closing' } },
};

export function ClosePage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (!meta.data) return <LoadingView />;
  // AC-12: the navigation hides the screen without the action; a direct URL explains instead of failing.
  if (!meta.data.actions.some((action) => action.name === CLOSE_READINESS_ACTION))
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          title={t({ ja: '月次締めを使う権限がありません', en: 'You cannot use the month-end close' })}
          description={t({
            ja: '経理または管理者の役割が必要です。必要なら管理者に役割の追加を依頼してください。',
            en: 'The accounting or admin role is required. Ask your administrator to add it if you need it.',
          })}
          action={
            <Link to="/" className={buttonClass()}>
              {t({ ja: 'ホームへ戻る', en: 'Back to home' })}
            </Link>
          }
        />
      </div>
    );
  return <CloseGuide key={financeIdentity()} meta={meta.data} />;
}

function ItemList({ items, tone, testId }: { items: readonly CloseItem[]; tone: BadgeTone; testId: string }) {
  const { t, locale } = useLocale();
  return (
    <ul className="flex flex-col" data-testid={testId}>
      {items.map((item) => {
        const scope = itemScope(item, locale);
        const target = item.href ? splitHref(item.href) : undefined;
        return (
          <li
            key={item.id}
            data-testid={`close-item-${item.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1 basis-48">
              <span className="block text-sm text-text">{t(item.label)}</span>
              {scope ? <span className="block text-xs text-text-muted">{scope}</span> : null}
            </span>
            <Badge tone={item.count > 0 ? tone : 'success'} data-testid="close-item-count">
              {countText(item.count, locale)}
            </Badge>
            {target ? (
              <Link
                to={target.to}
                search={target.search}
                className="ui-link"
                aria-label={t({ ja: `一覧を開く（${item.label.ja}）`, en: `Open list (${item.label.en})` })}
              >
                {t({ ja: '一覧を開く', en: 'Open list' })}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PeriodPicker({
  readiness,
  loading,
  disabled,
}: {
  readiness: CloseReadiness | undefined;
  loading: boolean;
  disabled: boolean;
}) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const periods = useClosePeriods(true);
  const id = useId();
  const options = periods.data ?? (readiness ? [readiness.period] : []);
  return (
    <Card>
      <FormSection
        title={t({ ja: '締める会計期間', en: 'Period to close' })}
        description={t({
          ja: '最初は、終了日が今日より前で締めていない最も古い期間を選んでいます（無ければ今日を含む期間）。',
          en: 'Starts at the oldest open period that ended before today (or the period containing today).',
        })}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-sm font-semibold text-text-secondary">
            {t({ ja: '会計期間', en: 'Fiscal period' })}
          </label>
          <select
            id={id}
            className="input w-full sm:max-w-md"
            value={readiness?.period.id ?? ''}
            disabled={disabled || options.length === 0}
            onChange={(event) => void navigate({ to: '/finance/close', search: { periodId: event.target.value } })}
          >
            {readiness ? null : (
              <option value="">
                {loading ? t(S.loading) : t({ ja: '期間を選んでください', en: 'Choose a period' })}
              </option>
            )}
            {options.map((period) => (
              <option key={period.id} value={period.id}>
                {periodOption(period, locale)}
              </option>
            ))}
          </select>
          {periods.isError ? (
            <p className="ui-field-error">
              {t({ ja: '期間の一覧を読み込めませんでした。', en: 'The period list could not be loaded.' })}
            </p>
          ) : null}
        </div>
      </FormSection>
    </Card>
  );
}

function CloseGuide({ meta }: { meta: AppMeta }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const search = useSearch({ from: '/app/finance/close' });
  const readiness = useCloseReadiness(search.periodId, true);
  const command = useFinanceCommand();
  const [confirm, setConfirm] = useState<'close' | 'reopen'>();
  const [checking, setChecking] = useState(false);
  const [focusStatus, setFocusStatus] = useState(false);
  const status = useRef<HTMLHeadingElement>(null);
  const reasonId = useId();
  const data = readiness.data;
  const canClose = meta.actions.some((action) => action.name === CLOSE_PERIOD_ACTION);
  const canReopen = meta.actions.some((action) => action.name === REOPEN_PERIOD_ACTION);
  const busy = command.isPending || checking;

  // After close / reopen the confirming button is gone; once the re-check settles, focus the period status.
  useEffect(() => {
    if (!focusStatus || readiness.isFetching) return;
    status.current?.focus();
    setFocusStatus(false);
  }, [focusStatus, readiness.isFetching]);

  const run = async (kind: 'close' | 'reopen') => {
    if (!data || busy) return;
    const periodId = data.period.id;
    if (kind === 'close') {
      // AC-10: count again right before closing, in case a draft appeared after the screen was loaded.
      setChecking(true);
      try {
        const fresh = await fetchCloseReadiness(periodId);
        if (!fresh.ready) {
          setConfirm(undefined);
          toast.push({
            kind: 'error',
            title: t({ ja: '締められない状態に変わりました', en: 'The period can no longer be closed' }),
            message: blockingSummary(fresh.items, locale),
          });
          await readiness.refetch();
          return;
        }
      } catch (error) {
        setConfirm(undefined);
        toast.error(error);
        return;
      } finally {
        setChecking(false);
      }
    }
    command.mutate(
      { action: kind === 'close' ? CLOSE_PERIOD_ACTION : REOPEN_PERIOD_ACTION, input: { periodId } },
      {
        onSuccess: () => {
          setConfirm(undefined);
          setFocusStatus(true);
          toast.success(
            kind === 'close'
              ? t({ ja: `${data.period.code} を締めました`, en: `Closed ${data.period.code}` })
              : t({ ja: `${data.period.code} を再開しました`, en: `Reopened ${data.period.code}` }),
          );
        },
        onError: (error) => {
          setConfirm(undefined);
          toast.error(error);
        },
      },
    );
  };

  const groups = data ? groupItems(data.items) : undefined;
  const state = data ? closeState(data) : undefined;
  const reason = data ? blockingSummary(data.items, locale) : '';
  return (
    <div className="workspace-page" data-testid="close-guide">
      <PageHeader
        eyebrow="MONTH-END CLOSE"
        title={t(TITLE)}
        titleTestId="close-title"
        subtitle={t({
          ja: '期間内に残っている下書きや未照合を件数で確かめ、一覧で片付けてから期間を締めます。締めた期間の日付では、仕訳も請求書・入出金の確定もできなくなります。',
          en: 'Count the drafts and unmatched items left in the period, clear them from their lists, then close it. Nothing dated in a closed period can be submitted or posted.',
        })}
        icon={
          <span className="icon-tile">
            <Icon name="calendar" />
          </span>
        }
        actions={
          <Button onClick={() => void readiness.refetch()} disabled={readiness.isFetching || busy}>
            {t({ ja: '再点検', en: 'Check again' })}
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <PeriodPicker readiness={data} loading={readiness.isFetching} disabled={busy} />
        {readiness.isError && !data ? (
          <MetaError error={readiness.error} retry={() => void readiness.refetch()} />
        ) : !data || !groups || !state ? (
          <>
            <p className="sr-only" aria-live="polite">
              {t(S.loading)}
            </p>
            <div aria-busy="true" className="flex flex-col gap-4">
              <SkeletonCard lines={3} />
              <SkeletonCard lines={4} />
            </div>
          </>
        ) : (
          <>
            <Card data-testid="close-status">
              <div className="flex flex-col gap-3 p-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 ref={status} tabIndex={-1} className="text-lg font-bold text-text-heading">
                    {data.period.code}
                  </h2>
                  <Badge tone={STATE_BADGE[state].tone} data-testid="close-state">
                    {t(STATE_BADGE[state].label)}
                  </Badge>
                </div>
                <p className="text-sm text-text-secondary">
                  {periodRange(data.period, locale)} · {data.fiscalYear.code}
                  {data.fiscalYear.isClosed ? t({ ja: '（年度締め済み）', en: ' (year closed)' }) : ''}
                </p>
                {state === 'closed' ? (
                  <div className="ui-notice ui-notice-success" data-testid="close-closed-notice">
                    <p>
                      {t({
                        ja: 'この期間は締め済みです。この期間の日付の仕訳、請求書・入出金の確定はできません。',
                        en: 'This period is closed. Nothing dated in it can be submitted or posted.',
                      })}
                    </p>
                    <p>
                      {t({
                        ja: '確定済みの伝票を訂正するときは、伝票の「取消」で開いている期間の訂正日を指定します（元の期間は締めたまま）。期間に戻って直す必要があるときだけ、期間を再開してください。再開と締めは監査ログに残ります。',
                        en: 'To correct a submitted document, cancel it with a correction date in an open period (the original period stays closed). Reopen the period only when the fix must be dated in it. Reopening and closing are audited.',
                      })}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  {state === 'closed' ? (
                    canReopen ? (
                      <Button onClick={() => setConfirm('reopen')} disabled={busy}>
                        {t({ ja: 'この期間を再開', en: 'Reopen this period' })}
                      </Button>
                    ) : null
                  ) : canClose ? (
                    <Button
                      variant="primary"
                      onClick={() => setConfirm('close')}
                      disabled={!data.ready || busy || readiness.isFetching}
                      aria-describedby={reason ? reasonId : undefined}
                    >
                      {t({ ja: 'この期間を締める', en: 'Close this period' })}
                    </Button>
                  ) : null}
                  {state === 'blocked' ? (
                    <p id={reasonId} className="text-sm text-danger-text" data-testid="close-blocked-reason">
                      {reason}
                    </p>
                  ) : null}
                  {state === 'ready' ? (
                    <p className="text-sm text-text-secondary">
                      {t({
                        ja: '締めを止める項目はありません。確認事項とレポートを見てから締めてください。',
                        en: 'Nothing blocks the close. Review the checks and reports before closing.',
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
            </Card>
            <Card>
              <FormSection
                landmark
                title={t({ ja: '締めを止める項目', en: 'Blocking the close' })}
                description={t({
                  ja: '仕訳と、確定すると仕訳を作る伝票（請求書・入出金など）の下書きです。期間を締めると確定できなくなるため、先に確定するか削除します。',
                  en: 'Drafts of journal entries and of documents that post one (invoices, payments). They cannot be submitted after the close, so submit or delete them first.',
                })}
              >
                {groups.blocking.length ? (
                  <ItemList items={groups.blocking} tone="danger" testId="close-blocking" />
                ) : (
                  <p className="text-sm text-text-secondary" data-testid="close-blocking-none">
                    {t({ ja: '残っている項目はありません。', en: 'Nothing left.' })}
                  </p>
                )}
              </FormSection>
            </Card>
            <Card>
              <FormSection
                landmark
                title={t({ ja: '確認事項（締めは止めません）', en: 'Checks (they do not block the close)' })}
                description={t({
                  ja: '前の期間の締め、仕訳を作らない伝票の下書き、未配分の入出金、未照合の銀行明細です。',
                  en: 'The previous period, drafts that post nothing, unallocated payments and unmatched bank lines.',
                })}
              >
                {groups.warnings.length ? (
                  <ItemList items={groups.warnings} tone="warning" testId="close-warnings" />
                ) : (
                  <p className="text-sm text-text-secondary">
                    {t({ ja: '確認事項はありません。', en: 'Nothing to check.' })}
                  </p>
                )}
                {groups.clear.length ? (
                  <details className="mt-2" data-testid="close-clear">
                    <summary className="cursor-pointer text-sm text-text-secondary">
                      {t({
                        ja: `問題のない項目（${groups.clear.length}）`,
                        en: `Clear items (${groups.clear.length})`,
                      })}
                    </summary>
                    <ItemList items={groups.clear} tone="success" testId="close-clear-list" />
                  </details>
                ) : null}
              </FormSection>
            </Card>
            <Card>
              <FormSection
                landmark
                title={t({ ja: '締めの前に見るレポート', en: 'Reports to review' })}
                description={t({
                  ja: '期間（年齢表と在庫評価は期間の末日）を入れた状態で開きます。「実行」で表を出してください。',
                  en: 'They open with the period (aging and valuation with its last day) filled in; run them to see the figures.',
                })}
              >
                {data.reports.length ? (
                  <ul className="flex flex-wrap gap-2" data-testid="close-reports">
                    {data.reports.map((report) => (
                      <li key={report.action}>
                        <Link
                          to="/r/$action"
                          params={{ action: report.action }}
                          search={report.input}
                          className={buttonClass('default', 'sm')}
                        >
                          <Icon name="chart" size={14} />
                          {t(report.label)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-secondary">
                    {t({ ja: '開けるレポートがありません。', en: 'No reports are available to you.' })}
                  </p>
                )}
              </FormSection>
            </Card>
          </>
        )}
      </div>
      {confirm && data ? (
        <Dialog
          title={
            confirm === 'close'
              ? t({ ja: `${data.period.code} を締めますか`, en: `Close ${data.period.code}?` })
              : t({ ja: `${data.period.code} を再開しますか`, en: `Reopen ${data.period.code}?` })
          }
          description={
            confirm === 'close'
              ? t({
                  ja: `${periodRange(data.period, locale)} の日付では、仕訳も請求書・入出金の確定もできなくなります。締める直前にもう一度点検します。再開はこの画面からできます（監査ログに記録）。`,
                  en: `Nothing dated ${periodRange(data.period, locale)} can be submitted or posted afterwards. The period is checked once more right before closing. You can reopen it here (audited).`,
                })
              : t({
                  ja: `${periodRange(data.period, locale)} の日付で再び確定・転記できるようになります。訂正が済んだら締め直してください（監査ログに記録）。`,
                  en: `Documents dated ${periodRange(data.period, locale)} can be submitted and posted again. Close it again after the correction (audited).`,
                })
          }
          closeLabel={t(S.close)}
          onClose={() => {
            if (!busy) setConfirm(undefined);
          }}
          icon={
            <span className="icon-tile">
              <Icon name={confirm === 'close' ? 'check' : 'clock'} />
            </span>
          }
          actions={
            <>
              <Button onClick={() => setConfirm(undefined)} disabled={busy} data-autofocus>
                {t({ ja: '戻る', en: 'Go back' })}
              </Button>
              <Button
                variant={confirm === 'close' ? 'primary' : 'danger'}
                onClick={() => void run(confirm)}
                disabled={busy}
              >
                {confirm === 'close'
                  ? t({ ja: '締める', en: 'Close period' })
                  : t({ ja: '再開する', en: 'Reopen period' })}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
