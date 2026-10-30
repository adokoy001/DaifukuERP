// Store / site home view (docs/specs/role-home.md AC-10): today's sales from the chain operations board, unsubmitted
// daily reports from the shared inbox read, today's attendance from the analytics dataset and this week's shifts from
// the shift board. Only existing reads the caller can run; the store/site boundary is the server's (AC-8).
import { useQueries } from '@tanstack/react-query';
import type { AnalyticsCatalog, AnalyticsSnapshot } from '../api/analytics.ts';
import type { OperationsSnapshot } from '../api/operations.ts';
import { callHomeAction, HOME_READ_OPTIONS, homeQueryRoot, useHomeRead } from '../api/role-home.ts';
import { request } from '../api/client.ts';
import { useLocale } from '../i18n.tsx';
import type { InboxGroup } from '../lib/inbox.ts';
import { formatDecimal } from '../lib/format.ts';
import {
  ATTENDANCE_DATASET,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUSES,
  attendanceSummary,
  hasScreen,
  HOME_ACTIONS,
  missingReportsSummary,
  moreSites,
  SHIFT_SITE_LIMIT,
  shiftTodaySummary,
  type HomeSource,
  type ShiftBoardLike,
} from '../lib/role-home.ts';
import { Badge } from '../ui/index.ts';
import { InboxDropped, InboxItemLink } from './inbox-card.tsx';
import { Amount, cardStateOf, HomeCard, useHomeCardEnv, type CardState } from './role-home-card.tsx';

type Query<T> = ReturnType<typeof useHomeRead<T>>;

function SalesCard({ today }: { today: string }) {
  const { t, locale } = useLocale();
  const { enabled } = useHomeCardEnv();
  const input = { from: today, to: today };
  const read = useHomeRead<OperationsSnapshot>(
    [HOME_ACTIONS.operationsSnapshot, input],
    (signal) => callHomeAction(HOME_ACTIONS.operationsSnapshot, input, signal),
    enabled,
  );
  return (
    <HomeCard
      source="sales_today"
      title={{ ja: '今日の売上', en: "Today's sales" }}
      state={cardStateOf('sales_today', [read], enabled)}
      link={{ href: `/operations?from=${today}&to=${today}`, label: { ja: '運営ボードを開く', en: 'Open the board' } }}
    >
      {() => {
        const overview = read.data?.overview;
        if (!overview) return null;
        const stores = (count: number) => (locale === 'ja' ? `${count}店舗` : `${count}`);
        return (
          <>
            <dl className="role-home-figures">
              <div className="role-home-figure" data-testid="home-sales-gross">
                <dt>{t({ ja: '確定済みの売上', en: 'Posted sales' })}</dt>
                <dd>
                  <Amount value={overview.grossSales} />
                </dd>
              </div>
              <div className="role-home-figure" data-testid="home-sales-previous">
                <dt>{t({ ja: '前日', en: 'Previous day' })}</dt>
                <dd>
                  <Amount value={overview.previousGrossSales} />
                </dd>
              </div>
              <div className="role-home-figure" data-testid="home-sales-target">
                <dt>{t({ ja: '目標・達成率', en: 'Target and achievement' })}</dt>
                <dd>
                  <Amount value={overview.targetSales} />
                  <span className="role-home-ratio">
                    {overview.achievementPct === null ? '—' : `${formatDecimal(overview.achievementPct, 0)}%`}
                  </span>
                </dd>
              </div>
            </dl>
            <ul className="role-home-chips" data-testid="home-sales-stores">
              <li>
                {t({ ja: '営業予定', en: 'Planned open' })} {stores(overview.expectedOpenDays)}
              </li>
              <li>
                {t({ ja: '提出済み', en: 'Submitted' })} {stores(overview.submittedDays)}
              </li>
              <li>
                {t({ ja: '店長確認待ち', en: 'Awaiting review' })} {stores(overview.reviewPendingDays)}
              </li>
            </ul>
            <p className="role-home-caption">
              {t({
                ja: '売上は本部が日次報告を確定した後に反映されます。',
                en: 'Sales appear after headquarters posts the daily reports.',
              })}
            </p>
          </>
        );
      }}
    </HomeCard>
  );
}

function missingState(group: InboxGroup | undefined, retry: (action: string) => Promise<boolean | undefined>) {
  const summary = missingReportsSummary(group);
  if (summary.kind === 'failed')
    return {
      summary,
      state: {
        kind: 'failure',
        failure: 'failed',
        error: summary.error,
        retrying: summary.retrying,
        retry: () => retry(HOME_ACTIONS.restaurantTodo),
      } satisfies CardState as CardState,
    };
  return { summary, state: { kind: summary.kind === 'ok' ? 'ready' : 'loading' } satisfies CardState as CardState };
}

/** AC-10 / AC-14: the restaurant_chain.todo group of the home's single inbox read; this card sends no request. */
export function MissingReportsCard({
  group,
  retry,
}: {
  group: InboxGroup | undefined;
  retry: (action: string) => Promise<boolean | undefined>;
}) {
  const { t } = useLocale();
  const { catalog } = useHomeCardEnv();
  const { summary, state } = missingState(group, retry);
  return (
    <HomeCard
      source="missing_reports"
      title={{ ja: '未提出の日次報告', en: 'Missing daily reports' }}
      state={state}
      link={
        hasScreen(catalog, '/operations')
          ? { href: '/operations', label: { ja: '運営ボードを開く', en: 'Open the board' } }
          : undefined
      }
    >
      {() =>
        summary.kind === 'ok' ? (
          <>
            {summary.items.length ? (
              <ul className="inbox-list">
                {summary.items.map((item) => (
                  <li key={item.id}>
                    <InboxItemLink item={item} />
                  </li>
                ))}
              </ul>
            ) : null}
            {summary.missingListed ? null : (
              <p className="role-home-notice" data-testid="home-missing-none">
                {t({
                  ja: '受信箱に未提出の項目はありません（直近7日）。',
                  en: 'The inbox lists no missing reports (last 7 days).',
                })}
              </p>
            )}
            {summary.dropped ? <InboxDropped count={summary.dropped} /> : null}
          </>
        ) : null
      }
    </HomeCard>
  );
}

function AttendanceCard({ today, catalog }: { today: string; catalog: Query<AnalyticsCatalog> }) {
  const { t, locale } = useLocale();
  const { enabled } = useHomeCardEnv();
  const listed = catalog.data?.datasets.some((dataset) => dataset.id === ATTENDANCE_DATASET) === true;
  const input = { dataset: ATTENDANCE_DATASET, from: today, to: today, state: 'all' };
  const snapshot = useHomeRead<AnalyticsSnapshot>(
    ['analytics-snapshot', input],
    (signal) =>
      request<AnalyticsSnapshot>('/analytics/snapshot', { method: 'POST', body: input, signal, cache: 'no-store' }),
    enabled && listed,
  );
  const reads = listed ? [catalog, snapshot] : [catalog];
  return (
    <HomeCard
      source="attendance"
      title={{ ja: '今日の勤怠', en: "Today's attendance" }}
      state={cardStateOf('attendance', reads, enabled)}
      link={{ href: '/workforce', label: { ja: '勤怠管理を開く', en: 'Open attendance' } }}
    >
      {() => {
        const summary = attendanceSummary(snapshot.data);
        const people = (count: number) => (locale === 'ja' ? `${count}人` : `${count}`);
        return (
          <>
            <dl className="role-home-figures">
              <div className="role-home-figure" data-testid="home-attendance-total">
                <dt>{t({ ja: '打刻のある従業員', en: 'Employees with attendance' })}</dt>
                <dd>
                  <span className="role-home-amount">{people(summary.employees)}</span>
                </dd>
              </div>
            </dl>
            <ul className="role-home-chips" data-testid="home-attendance-status">
              {ATTENDANCE_STATUSES.map((status) => (
                <li key={status} data-status={status}>
                  {t(ATTENDANCE_STATUS_LABELS[status])} {people(summary.byStatus[status])}
                </li>
              ))}
            </ul>
          </>
        );
      }}
    </HomeCard>
  );
}

const PLAN_STATE = {
  published: { ja: '公開済み', en: 'Published' },
  draft: { ja: '下書きのみ', en: 'Draft only' },
  none: { ja: '未作成', en: 'Not created' },
} as const;

function ShiftCard({ today, monday }: { today: string; monday: string }) {
  const { t, locale } = useLocale();
  const { enabled } = useHomeCardEnv();
  const siteInput = { limit: SHIFT_SITE_LIMIT, where: { active: true }, orderBy: [{ field: 'code', dir: 'asc' }] };
  const sites = useHomeRead<{ items: { id: string; code: string; name: string }[]; total: number }>(
    [HOME_ACTIONS.siteList, siteInput],
    (signal) => callHomeAction(HOME_ACTIONS.siteList, siteInput, signal),
    enabled,
  );
  const items = (sites.data?.items ?? []).slice(0, SHIFT_SITE_LIMIT);
  const boards = useQueries({
    queries: items.map((site) => {
      const input = { siteId: site.id, weekStart: monday };
      return {
        queryKey: [...homeQueryRoot(), HOME_ACTIONS.shiftBoard, input],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          callHomeAction<ShiftBoardLike>(HOME_ACTIONS.shiftBoard, input, signal),
        enabled,
        ...HOME_READ_OPTIONS,
      };
    }),
  });
  const people = (count: number) => (locale === 'ja' ? `${count}人` : `${count}`);
  return (
    <HomeCard
      source="shift"
      title={{ ja: '今週のシフト', en: "This week's shifts" }}
      state={cardStateOf('shift', [sites, ...boards], enabled)}
      link={{ href: '/workforce/shifts', label: { ja: 'シフトを開く', en: 'Open shifts' } }}
    >
      {() => (
        <>
          {items.length ? (
            <ul className="role-home-sites" data-testid="home-shift-sites">
              {items.map((site, index) => {
                const summary = shiftTodaySummary(boards[index]?.data, today);
                return (
                  <li key={site.id} data-testid="home-shift-site" data-state={summary.state}>
                    <span className="role-home-site-name">{site.name}</span>
                    <Badge
                      tone={
                        summary.state === 'published' ? 'success' : summary.state === 'draft' ? 'warning' : 'neutral'
                      }
                    >
                      {t(PLAN_STATE[summary.state])}
                    </Badge>
                    {summary.state === 'published' ? (
                      <span className="role-home-site-detail">
                        {t({
                          ja: `今日 ${summary.slots}枠・必要 ${people(summary.required)}・割当 ${people(summary.assigned)}`,
                          en: `Today ${summary.slots} slot(s), ${summary.required} needed, ${summary.assigned} assigned`,
                        })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="role-home-notice">
              {t({ ja: '有効な拠点がありません。', en: 'There are no active sites.' })}
            </p>
          )}
          {moreSites(sites.data) ? (
            <p className="role-home-caption" data-testid="home-shift-more">
              {t({
                ja: 'ほかの拠点はシフト画面で確認してください。',
                en: 'Check the other sites on the shift screen.',
              })}
            </p>
          ) : null}
        </>
      )}
    </HomeCard>
  );
}

export function StoreCards({
  cards,
  today,
  monday,
  catalog,
  missingGroup,
  retryInbox,
}: {
  cards: readonly HomeSource[];
  today: string;
  monday: string;
  catalog: Query<AnalyticsCatalog>;
  missingGroup: InboxGroup | undefined;
  retryInbox: (action: string) => Promise<boolean | undefined>;
}) {
  return (
    <div className="role-home-grid">
      {cards.map((source) => {
        if (source === 'sales_today') return <SalesCard key={source} today={today} />;
        if (source === 'missing_reports')
          return <MissingReportsCard key={source} group={missingGroup} retry={retryInbox} />;
        if (source === 'attendance') return <AttendanceCard key={source} today={today} catalog={catalog} />;
        if (source === 'shift') return <ShiftCard key={source} today={today} monday={monday} />;
        return null;
      })}
    </div>
  );
}
